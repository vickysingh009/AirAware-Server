#!/usr/bin/env node
/**
 * Tempo.js (hourly series)
 *
 * Produces a 24-hour hourly series (every hour). Strategy:
 *  - try OpenWeather air_pollution/forecast -> use matching hourly dt entries
 *  - else try OpenWeather history (last 48h) -> aggregate to hourly buckets -> interpolate missing hours
 *  - else fallback to single-sample (original behavior)
 *
 * Also attempts to enrich with NASA POWER (daily) weather when in US/CA/MX.
 */

const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 4000;

// ----------------- CONFIG -----------------
const NASA_API_KEY = process.env.NASA_API_KEY || 'mWrSbdTKdT3BVbprtIJvXB1JVvT6hqvzM8zbO3wH';
const OW_API_KEY = process.env.OPENWEATHER_API_KEY || 'f93455a804ee994a672e83422cacc578';
const ALLOWED_COUNTRY_CODES = new Set(['US', 'CA', 'MX']);
const HOUR_SECONDS = 3600;
const SERIES_HOURS = 24; // length of series returned

// optional tempo mock fallback (place tempo-mock.json next to this file if desired)
let tempoMock = null;
try {
  tempoMock = require('./tempo-mock.json');
} catch (e) {
  tempoMock = null;
}

// ----------------- helpers -----------------
async function safeFetch(url, opts = {}) {
  try {
    const resp = await axios.get(url, { timeout: 20000, ...opts });
    return { ok: true, data: resp.data };
  } catch (err) {
    const status = err.response?.status;
    const statusText = err.response?.statusText;
    const bodySnippet = err.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : null;
    console.error(`safeFetch error for ${url} — status: ${status} ${statusText} — message: ${err.message}`);
    if (bodySnippet) console.error(`response body (truncated): ${bodySnippet}`);
    return { ok: false, error: { status, statusText, message: err.message } };
  }
}

function floorToHourSec(tsSec) {
  return Math.floor(tsSec / HOUR_SECONDS) * HOUR_SECONDS;
}
function isoFromSec(tsSec) {
  return new Date(tsSec * 1000).toISOString();
}
function nowHourStartSec() {
  return floorToHourSec(Math.floor(Date.now() / 1000));
}

// ----------------- NASA POWER fetcher (unchanged logic for daily params) -----------------
class NASAPowerFetcher {
  constructor(apiKey = null, community = 'AG', timeout = 30000) {
    this.apiKey = apiKey;
    this.community = community;
    this.timeout = timeout;
    this.baseUrl = 'https://power.larc.nasa.gov/api/temporal/daily/point';
  }

  today_yyyymmdd() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
  yyyymmdd_days_before(end_yyyymmdd, days) {
    const year = Number(end_yyyymmdd.slice(0, 4));
    const month = Number(end_yyyymmdd.slice(4, 6)) - 1;
    const day = Number(end_yyyymmdd.slice(6, 8));
    const dt = new Date(Date.UTC(year, month, day));
    dt.setUTCDate(dt.getUTCDate() - days);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  async fetch_point_daily(latitude, longitude, parameters = "T2M,RH2M,WS10M,PS,PRECTOTCORR", start = null, end = null) {
    if (!end) end = this.today_yyyymmdd();
    if (!start) start = this.yyyymmdd_days_before(end, 7);

    const q = {
      parameters,
      community: this.community,
      longitude,
      latitude,
      start,
      end,
      format: 'JSON'
    };
    if (this.apiKey) q.apikey = this.apiKey;

    const resp = await safeFetch(this.baseUrl, { params: q, timeout: this.timeout });
    if (!resp.ok) throw new Error(`NASA POWER fetch failed: ${JSON.stringify(resp.error)}`);
    return resp.data;
  }

  static normalize_parameters(response_json) {
    const props = (response_json && response_json.properties) || {};
    const params = props.parameter || {};
    const out = {};
    for (const [k, ts] of Object.entries(params || {})) {
      const mapped = {};
      for (const [d, v] of Object.entries(ts || {})) {
        mapped[d] = (v === -999 || v === -999.0) ? null : v;
      }
      out[k] = mapped;
    }
    return out;
  }

  static compute_most_recent_date_across_params(params_dict) {
    const dates = [];
    for (const ts of Object.values(params_dict || {})) {
      for (const [d, v] of Object.entries(ts || {})) {
        if (v !== null && v !== undefined) dates.push(d);
      }
    }
    if (dates.length === 0) return null;
    dates.sort();
    return dates[dates.length - 1];
  }
}

// ----------------- OpenWeather helpers (forecast/history/current) -----------------
async function fetch_openweather_forecast_series(lat, lon, api_key) {
  try {
    const url = 'https://api.openweathermap.org/data/2.5/air_pollution/forecast';
    const params = { lat, lon, appid: api_key };
    const resp = await safeFetch(url, { params, timeout: 20000 });
    if (!resp.ok) return [];
    const list = resp.data && Array.isArray(resp.data.list) ? resp.data.list : [];
    return list; // items { dt, components }
  } catch (err) {
    console.error('fetch_openweather_forecast_series error:', err.message || err);
    return [];
  }
}

async function fetch_openweather_history_series(lat, lon, start_ts, end_ts, api_key) {
  try {
    const url = 'https://api.openweathermap.org/data/2.5/air_pollution/history';
    const params = { lat, lon, start: Math.floor(start_ts), end: Math.floor(end_ts), appid: api_key };
    const resp = await safeFetch(url, { params, timeout: 20000 });
    if (!resp.ok) return [];
    const list = resp.data && Array.isArray(resp.data.list) ? resp.data.list : [];
    return list;
  } catch (err) {
    console.error('fetch_openweather_history_series error:', err.message || err);
    return [];
  }
}

async function fetch_openweather_current(lat, lon, api_key) {
  try {
    const url = 'https://api.openweathermap.org/data/2.5/air_pollution';
    const params = { lat, lon, appid: api_key };
    const resp = await safeFetch(url, { params, timeout: 15000 });
    if (!resp.ok) return null;
    const lst = resp.data && Array.isArray(resp.data.list) ? resp.data.list : [];
    return lst[0] || null;
  } catch (err) {
    console.error('fetch_openweather_current error:', err.message || err);
    return null;
  }
}

async function fetch_openweather_weather(lat, lon, api_key) {
  try {
    const url = 'https://api.openweathermap.org/data/2.5/weather';
    const params = { lat, lon, appid: api_key, units: 'metric' };
    const resp = await safeFetch(url, { params, timeout: 15000 });
    if (!resp.ok) return null;
    return resp.data;
  } catch (err) {
    console.error('fetch_openweather_weather error:', err.message || err);
    return null;
  }
}

// ----------------- reverse geocode helper -----------------
async function getCountryCode(lat, lon) {
  try {
    const resp = await safeFetch('https://api.openweathermap.org/data/2.5/weather', { params: { lat, lon, appid: OW_API_KEY } });
    if (resp.ok && resp.data && resp.data.sys && resp.data.sys.country) return resp.data.sys.country;
  } catch (e) { /* fallthrough */ }

  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const resp2 = await safeFetch(url);
    if (resp2.ok && resp2.data && resp2.data.countryCode) return resp2.data.countryCode;
  } catch (e) { /* ignore */ }

  return null;
}

// ----------------- series helpers -----------------
function aggregateSamplesToHourly(samples) {
  // samples: array of { dt (sec), components: { pm2_5, ... } }
  const buckets = {};
  for (const s of samples || []) {
    if (!s || typeof s.dt !== 'number' || !s.components) continue;
    const hourStartSec = floorToHourSec(s.dt);
    if (!buckets[hourStartSec]) buckets[hourStartSec] = { sum: {}, count: 0 };
    for (const [k, v] of Object.entries(s.components || {})) {
      if (v == null) continue;
      buckets[hourStartSec].sum[k] = (buckets[hourStartSec].sum[k] || 0) + Number(v);
    }
    buckets[hourStartSec].count += 1;
  }
  const out = [];
  for (const [hourSecStr, val] of Object.entries(buckets)) {
    const hourSec = Number(hourSecStr);
    const avg = {};
    for (const [k, ssum] of Object.entries(val.sum)) avg[k] = ssum / val.count;
    out.push({ ts: hourSec, time: isoFromSec(hourSec), components: avg, samples: val.count });
  }
  out.sort((a,b) => a.ts - b.ts);
  return out;
}

function interpolateValue(targetTs, left, right, key) {
  // left and right are objects { ts, components } where components is a dict
  if (left && left.components && left.components[key] != null && right && right.components && right.components[key] != null) {
    const t = (targetTs - left.ts) / (right.ts - left.ts);
    return left.components[key] + t * (right.components[key] - left.components[key]);
  }
  if (left && left.components && left.components[key] != null) return left.components[key];
  if (right && right.components && right.components[key] != null) return right.components[key];
  return null;
}

function buildHourlySeriesFromAggregated(aggregatedMap, startHourSec, hours) {
  // aggregatedMap: Map of hourSec -> { ts, components, samples }
  // produce hours count entries starting at startHourSec
  const out = [];
  // precompute sorted keys
  const keys = Array.from(aggregatedMap.keys()).sort((a,b)=>a-b);
  for (let i = 0; i < hours; i++) {
    const targetTs = startHourSec + i * HOUR_SECONDS;
    const entry = { time: isoFromSec(targetTs) };
    const agg = aggregatedMap.get(targetTs);
    if (agg && agg.components) {
      const c = agg.components;
      if (c.pm2_5 != null) entry.PM25 = Number(c.pm2_5);
      if (c.pm10 != null) entry.PM10 = Number(c.pm10);
      if (c.no2 != null) entry.NO2 = Number(c.no2);
      if (c.o3 != null) entry.O3 = Number(c.o3);
      if (c.co != null) entry.CO = Number(c.co);
      entry.sample_count = agg.samples;
      out.push(entry);
      continue;
    }

    // No direct agg - try interpolation between nearest aggregated hours
    // find left and right nearest keys
    let leftKey = null, rightKey = null;
    for (const k of keys) {
      if (k <= targetTs) leftKey = k;
      if (k > targetTs) { rightKey = k; break; }
    }
    const left = leftKey != null ? aggregatedMap.get(leftKey) : null;
    const right = rightKey != null ? aggregatedMap.get(rightKey) : null;

    const pm25 = interpolateValue(targetTs, left, right, 'pm2_5');
    const pm10 = interpolateValue(targetTs, left, right, 'pm10');
    const no2 = interpolateValue(targetTs, left, right, 'no2');
    const o3 = interpolateValue(targetTs, left, right, 'o3');
    const co = interpolateValue(targetTs, left, right, 'co');

    if (pm25 != null) entry.PM25 = Number(pm25);
    if (pm10 != null) entry.PM10 = Number(pm10);
    if (no2 != null) entry.NO2 = Number(no2);
    if (o3 != null) entry.O3 = Number(o3);
    if (co != null) entry.CO = Number(co);

    entry.sample_count = 0;
    out.push(entry);
  }
  return out;
}

// ----------------- Express setup -----------------
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/api/aq', async (req, res) => {
  const { lat, lon } = req.query;

  // Immediate log
  try {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    console.log(`Tempo.js request from ${clientIp} — coords: ${lat || 'n/a'},${lon || 'n/a'}`);
  } catch (e) {
    console.log('Tempo.js request — (could not determine client IP)');
  }

  if (!lat || !lon) {
    return res.status(400).json({
      error: 'lat and lon query parameters required',
      example: '/api/aq?lat=34.0522&lon=-118.2437'
    });
  }

  const warnings = [];
  let weather = null;
  const tempo = {
    site: {
      lat: Number(lat),
      lon: Number(lon),
      name: `Selected location (${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)})`
    }
  };

  // detect country to decide NASA usage
  let countryCode = null;
  try {
    countryCode = await getCountryCode(Number(lat), Number(lon));
  } catch (e) {
    console.error('country detection failed:', e);
    warnings.push({ source: 'geocode', detail: 'country detection failed' });
  }

  if (!countryCode) {
    warnings.push({ source: 'geocode', detail: 'could not determine country code' });
  } else if (!ALLOWED_COUNTRY_CODES.has(countryCode)) {
    warnings.push({ source: 'region', detail: `location outside US/CA/MX (detected ${countryCode}) — NASA will be skipped for hourly enrichment` });
  }

  try {
    // fetch basic weather object for name / fallback weather values
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OW_API_KEY}&units=metric`;
    const weatherResp = await safeFetch(weatherUrl);
    if (weatherResp.ok) {
      weather = weatherResp.data;
      if (weather && weather.name) tempo.site.name = weather.name;
    } else {
      warnings.push({ source: 'openweather_weather', detail: weatherResp.error });
    }

    // Build target series: start at current hour and make next 24 hours (you can change to past hours if you prefer)
    // We'll prefer forecast (future) but will also include recent history for interpolation if needed.
    const startHour = nowHourStartSec(); // current hour start
    const targetHours = SERIES_HOURS;

    // 1) Try forecast series
    let forecastSamples = [];
    try {
      const fc = await fetch_openweather_forecast_series(Number(lat), Number(lon), OW_API_KEY);
      if (fc && fc.length > 0) {
        forecastSamples = fc.map(it => ({ ts: it.dt, components: it.components || {} }));
        console.log(`Tempo.js: OpenWeather forecast returned ${forecastSamples.length} samples`);
      } else {
        console.log('Tempo.js: OpenWeather forecast returned no samples');
      }
    } catch (e) {
      console.warn('Tempo.js: forecast fetch failed:', e?.message ?? e);
    }

    // 2) Fetch last 48h history as fallback / interpolation source
    let historySamples = [];
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const histStart = nowSec - (48 * 3600); // last 48 hours
      const hist = await fetch_openweather_history_series(Number(lat), Number(lon), histStart, nowSec, OW_API_KEY);
      if (hist && hist.length > 0) {
        historySamples = hist.map(it => ({ ts: it.dt, components: it.components || {} }));
        console.log(`Tempo.js: OpenWeather history returned ${historySamples.length} samples`);
      } else {
        console.log('Tempo.js: OpenWeather history returned no samples');
      }
    } catch (e) {
      console.warn('Tempo.js: history fetch failed:', e?.message ?? e);
    }

    // Compose combined samples for aggregation/interpolation
    const combinedSamples = [...(forecastSamples || []), ...(historySamples || [])];
    // Also fetch current single sample as final fallback
    let currentSample = null;
    try {
      const cur = await fetch_openweather_current(Number(lat), Number(lon), OW_API_KEY);
      if (cur) currentSample = { ts: cur.dt, components: cur.components || {} };
    } catch (e) {
      // ignore
    }

    // If we have combinedSamples, aggregate into hourly buckets
    let hourlyEntries = [];
    if ((combinedSamples || []).length > 0) {
      // convert to expected format for aggregator: { dt, components }
      const rawSamples = combinedSamples.map(s => ({ dt: s.ts, components: s.components }));
      const aggregated = aggregateSamplesToHourly(rawSamples); // returns array sorted
      // map aggregated to Map for lookup
      const aggMap = new Map();
      for (const a of aggregated) aggMap.set(a.ts, { ts: a.ts, components: a.components, samples: a.samples });

      // build hourly series startHour..startHour + (targetHours-1)*3600
      const built = buildHourlySeriesFromAggregated(aggMap, startHour, targetHours);
      // If built has many null values (no data at all), we'll handle below
      // else use built
      const nonEmptyCount = built.reduce((s, e) => s + (e.PM25 != null ? 1 : 0), 0);
      if (nonEmptyCount >= 2) {
        hourlyEntries = built;
        console.log(`Tempo.js: built hourly series of length ${built.length} with ${nonEmptyCount} populated PM2.5 points`);
      } else {
        // if not enough populated points, try to build by mapping forecast direct matches (if forecast had direct hourly dt for targets)
        if ((forecastSamples || []).length > 0) {
          const fcMap = new Map();
          forecastSamples.forEach(s => fcMap.set(floorToHourSec(s.ts), s.components));
          const direct = [];
          for (let i = 0; i < targetHours; i++) {
            const ts = startHour + i * HOUR_SECONDS;
            const c = fcMap.get(ts);
            const e = { time: isoFromSec(ts) };
            if (c) {
              if (c.pm2_5 != null) e.PM25 = Number(c.pm2_5);
              if (c.pm10 != null) e.PM10 = Number(c.pm10);
              if (c.no2 != null) e.NO2 = Number(c.no2);
              if (c.o3 != null) e.O3 = Number(c.o3);
              if (c.co != null) e.CO = Number(c.co);
            }
            direct.push(e);
          }
          const directCount = direct.reduce((s, e) => s + (e.PM25 != null ? 1 : 0), 0);
          if (directCount >= 2) {
            hourlyEntries = direct;
            console.log(`Tempo.js: used direct forecast matches for ${directCount} target hours`);
          }
        }
      }
    }

    // If still no good hourlyEntries, attempt to construct series using interpolation from historySamples
    if (!hourlyEntries || hourlyEntries.length === 0) {
      if ((historySamples || []).length > 0) {
        // aggregate history to hourly map
        const rawHist = historySamples.map(s => ({ dt: s.ts, components: s.components }));
        const aggregated = aggregateSamplesToHourly(rawHist);
        const aggMap = new Map();
        aggregated.forEach(a => aggMap.set(a.ts, { ts: a.ts, components: a.components, samples: a.samples }));
        const built = buildHourlySeriesFromAggregated(aggMap, startHour - (12 * HOUR_SECONDS), targetHours + 24); // create larger window to allow interpolation
        // slice to our target window (startHour .. )
        const sliceStartIndex = Math.max(0, built.findIndex(e => e.time === isoFromSec(startHour)));
        if (sliceStartIndex !== -1) {
          const candidate = built.slice(sliceStartIndex, sliceStartIndex + targetHours);
          const countPop = candidate.reduce((s, e) => s + (e.PM25 != null ? 1 : 0), 0);
          if (countPop >= 2) {
            hourlyEntries = candidate;
            console.log(`Tempo.js: built hourly series from history interpolation; populated ${countPop} hours`);
          }
        }
      }
    }

    // If still none, use fallback: create series by repeating currentSample or single aggregated value
    if (!hourlyEntries || hourlyEntries.length === 0) {
      console.log('Tempo.js: falling back to single-sample strategy to produce hourly series');
      let base = {};
      // try aggregated today average
      try {
        const today = (new NASAPowerFetcher()).today_yyyymmdd();
        const histToday = await fetch_openweather_history_avg(Number(lat), Number(lon), today, OW_API_KEY);
        if (histToday && histToday.avg) {
          base = histToday.avg;
          warnings.push({ source: 'openweather_history', detail: 'used today history average for fallback series' });
        }
      } catch (e) {
        /* ignore */
      }
      if (Object.keys(base).length === 0 && currentSample && currentSample.components) base = currentSample.components;
      if (Object.keys(base).length === 0 && tempoMock && tempoMock.hourly && tempoMock.hourly[0]) base = tempoMock.hourly[0];

      // replicate same value across the 24-hour series
      const arr = [];
      for (let i = 0; i < targetHours; i++) {
        const ts = startHour + i * HOUR_SECONDS;
        const e = { time: isoFromSec(ts) };
        if (base.pm2_5 != null) e.PM25 = Number(base.pm2_5);
        if (base.pm10 != null) e.PM10 = Number(base.pm10);
        if (base.no2 != null) e.NO2 = Number(base.no2);
        if (base.o3 != null) e.O3 = Number(base.o3);
        if (base.co != null) e.CO = Number(base.co);
        e.sample_count = 0;
        arr.push(e);
      }
      hourlyEntries = arr;
    }

    // Enrich hourlyEntries with weather: prefer NASA POWER (daily) then OpenWeather weather for missing weather fields
    let nasaResult = null;
    if (countryCode && ALLOWED_COUNTRY_CODES.has(countryCode)) {
      try {
        const pf = new NASAPowerFetcher(NASA_API_KEY);
        const today = pf.today_yyyymmdd();
        const windows = [0,1,6,29];
        for (const w of windows) {
          const start = pf.yyyymmdd_days_before(today, w);
          try {
            const resp = await pf.fetch_point_daily(Number(lat), Number(lon), undefined, start, today);
            const params_norm = NASAPowerFetcher.normalize_parameters(resp);
            const mr_date = NASAPowerFetcher.compute_most_recent_date_across_params(params_norm);
            if (mr_date) {
              const subset = {};
              for (const [paramName, tsObj] of Object.entries(params_norm || {})) {
                subset[paramName] = (tsObj && tsObj[mr_date] !== undefined) ? tsObj[mr_date] : null;
              }
              nasaResult = { date: mr_date, parameters: subset };
              break;
            }
          } catch (e) {
            // ignore and continue windows
          }
        }
      } catch (e) {
        // ignore NASA errors
      }
    }

    // Fetch OpenWeather current weather once (already attempted above, stored in `weather`)
    // Fill hourly weather fields
    for (const he of hourlyEntries) {
      if (nasaResult && nasaResult.parameters) {
        const p = nasaResult.parameters;
        if (p.T2M != null) he.Temperature = Number(p.T2M);
        if (p.RH2M != null) he.Humidity = Number(p.RH2M);
        if (p.WS10M != null) he.Wind_Speed = Number(p.WS10M);
        if (p.PS != null) {
          he.Pressure = Number(p.PS);
          he.Pressure_hPa = Math.round(Number(p.PS) / 100);
        }
        he._nasa_date = nasaResult.date;
      }
      // fallback to weather
      if ((he.Temperature == null || he.Humidity == null || he.Wind_Speed == null) && weather) {
        if (he.Temperature == null && weather.main?.temp != null) he.Temperature = weather.main.temp;
        if (he.Humidity == null && weather.main?.humidity != null) he.Humidity = weather.main.humidity;
        if (he.Wind_Speed == null && weather.wind?.speed != null) he.Wind_Speed = weather.wind.speed;
        if (he.Pressure_hPa == null && weather.main?.pressure != null) {
          he.Pressure_hPa = weather.main.pressure;
          he.Pressure = he.Pressure ? he.Pressure : Math.round(weather.main.pressure * 100);
        }
      }
    }

    // assign tempo.hourly
    tempo.hourly = hourlyEntries;

    // Log concise server message
    try {
      const cityName = (weather && weather.name) ? weather.name : `(${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)})`;
      const sampleNotes = tempo.hourly.slice(0,5).map(h => {
        const pm = h.PM25 != null ? `${Number(h.PM25).toFixed(1)}µg` : 'N/A';
        return `${h.time.replace('T',' ').replace('Z','')} ${pm}`;
      }).join(' | ');
      const mode = (forecastSamples.length > 0) ? 'forecast' : ((historySamples.length>0) ? 'history_interp' : 'fallback_single');
      console.log(`${cityName} — returned ${tempo.hourly.length} hourly pts (mode=${mode}) — sample preview: ${sampleNotes}`);
    } catch (e) {
      // ignore
    }

    const out = { ground: null, weather, tempo, warnings };
    if (nasaResult) out.nasa = nasaResult;
    return res.json(out);

  } catch (err) {
    console.error('Unexpected server error in /api/aq:', err);
    if (tempoMock) {
      return res.json({
        ground: null,
        weather: null,
        tempo: tempoMock,
        warnings: [{ source: 'server', detail: 'error; returned tempo mock' }]
      });
    }
    return res.status(500).json({ error: 'server error', details: String(err) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Tempo server running on port ${PORT} — reachable at http://<server-ip>:${PORT}`);
  console.log('Example: http://10.47.36.61:4000 (ensure machine IP matches)');
});
