// src/screens/ForecastScreen.js
import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import axios from 'axios';
import { pm25ToAQI } from '../utils/aqi';
import { simpleForecast } from '../services/forecast';

const SERVER = 'http://10.47.36.61:4000';
const OW_API_KEY = '7ae46e371c039b4fad94c993654ab521';
const TEMPO_ALLOWED = new Set(['US', 'CA', 'MX']);

function hourLabelFromISO(iso) {
  try {
    const d = new Date(iso);
    const hh = d.getUTCHours();
    return `${String(hh).padStart(2, '0')}:00`;
  } catch {
    return iso;
  }
}

function aggregateOWHistoryToHourly(list) {
  const buckets = {};
  for (const ent of (list || [])) {
    if (!ent || !ent.dt || !ent.components) continue;
    const dtms = ent.dt * 1000;
    const d = new Date(dtms);
    const hourStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0));
    const key = hourStart.toISOString();
    const pm = ent.components.pm2_5;
    if (pm == null) continue;
    if (!buckets[key]) buckets[key] = { sum: 0, count: 0, ts: hourStart.getTime() / 1000 };
    buckets[key].sum += Number(pm);
    buckets[key].count += 1;
  }
  const out = Object.keys(buckets).map(k => {
    const b = buckets[k];
    return { time: k, PM25: b.sum / b.count, sampleCount: b.count, ts: b.ts };
  });
  out.sort((a, b) => new Date(a.time) - new Date(b.time));
  return out;
}

function sparsifyLabels(labels, maxLabels = 6) {
  if (!Array.isArray(labels) || labels.length === 0) return labels || [];
  const n = labels.length;
  if (n <= maxLabels) return labels.slice();
  const step = Math.max(1, Math.floor(n / maxLabels));
  const out = labels.map((lab, i) => ((i % step) === 0 ? lab : ''));
  const nonEmpty = out.reduce((c, v) => c + (v ? 1 : 0), 0);
  if (nonEmpty > maxLabels) {
    let toRemove = nonEmpty - maxLabels;
    for (let i = out.length - 1; i >= 0 && toRemove > 0; i--) {
      if (out[i]) {
        out[i] = '';
        toRemove--;
      }
    }
  } else if (nonEmpty < maxLabels) {
    for (let i = 0; i < out.length && nonEmpty < maxLabels; i++) {
      const idx = Math.floor((i + 1) * (n / maxLabels)) - 1;
      if (idx >= 0 && idx < out.length && !out[idx]) {
        out[idx] = labels[idx];
      }
    }
  }
  return out;
}

function interpValueAt(tsTarget, srcEntries, key = 'PM25') {
  if (!Array.isArray(srcEntries) || srcEntries.length === 0) return null;
  for (const s of srcEntries) {
    if (s.ts === tsTarget) return (s[key] != null ? s[key] : null);
  }
  let left = null, right = null;
  for (let i = 0; i < srcEntries.length; i++) {
    const s = srcEntries[i];
    if (s.ts < tsTarget) left = s;
    if (s.ts > tsTarget) { right = s; break; }
  }
  if (left && right && left[key] != null && right[key] != null) {
    const t = (tsTarget - left.ts) / (right.ts - left.ts);
    return left[key] + t * (right[key] - left[key]);
  }
  if (left && left[key] != null) return left[key];
  if (right && right[key] != null) return right[key];
  return null;
}

export default function ForecastScreen({ route }) {
  const incomingAqData = route?.params?.aqData; // keep available but don't use tempo until allowed
  const routeLoc = route?.params?.loc;

  const [tempoResp, setTempoResp] = useState(null);
  const [owHourly, setOwHourly] = useState([]);
  const [countryCode, setCountryCode] = useState(null);
  const [showTempo, setShowTempo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  const coords = {
    latitude:
      routeLoc?.latitude ??
      incomingAqData?.tempo?.site?.lat ??
      incomingAqData?.site?.lat ??
      incomingAqData?.weather?.coord?.lat ??
      null,
    longitude:
      routeLoc?.longitude ??
      incomingAqData?.tempo?.site?.lon ??
      incomingAqData?.site?.lon ??
      incomingAqData?.weather?.coord?.lon ??
      null,
  };
  const canFetch = coords.latitude != null && coords.longitude != null;

  // country detection using OpenWeather "weather" endpoint
  const fetchOpenWeatherCountry = useCallback(async (lat, lon) => {
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OW_API_KEY}`;
      const resp = await axios.get(url, { timeout: 8000 });
      const cc = resp?.data?.sys?.country;
      return cc ? String(cc).toUpperCase() : null;
    } catch (e) {
      console.warn('country detect failed:', e?.message ?? e);
      return null;
    }
  }, []);

  const fetchTempo = useCallback(async (lat, lon) => {
    const url = `${SERVER}/api/aq?lat=${lat}&lon=${lon}`;
    const resp = await axios.get(url, { timeout: 20000 });
    return resp.data;
  }, []);

  const fetchOWHistory = useCallback(async (lat, lon) => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 24 * 3600;
    const url = `https://api.openweathermap.org/data/2.5/air_pollution/history?lat=${lat}&lon=${lon}&start=${start}&end=${now}&appid=${OW_API_KEY}`;
    try {
      const resp = await axios.get(url, { timeout: 20000 });
      if (resp?.data?.list && resp.data.list.length > 0) return resp.data.list;
    } catch (e) {
      console.warn('OW history fetch failed:', e?.message ?? e);
    }
    const curUrl = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${OW_API_KEY}`;
    const curResp = await axios.get(curUrl, { timeout: 15000 });
    return curResp?.data?.list || [];
  }, []);

  // central fetch: detect country -> decide on Tempo -> fetch OW and optionally Tempo
  const doFetchAll = useCallback(async () => {
    if (!canFetch) {
      setError('No coordinates available to fetch forecast.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const lat = coords.latitude;
      const lon = coords.longitude;
      console.log(`ForecastScreen: resolving country for ${lat},${lon}`);

      const cc = await fetchOpenWeatherCountry(lat, lon);
      setCountryCode(cc);
      const allowTempo = cc && TEMPO_ALLOWED.has(cc);
      setShowTempo(allowTempo);
      console.log('ForecastScreen: detected country=', cc, 'tempoAllowed=', allowTempo);

      // always fetch OW
      const owPromise = fetchOWHistory(lat, lon);
      // only call Tempo server when allowed
      const tempoPromise = allowTempo ? fetchTempo(lat, lon) : Promise.resolve(null);

      const [tempoRes, owList] = await Promise.allSettled([tempoPromise, owPromise]);

      if (allowTempo) {
        if (tempoRes.status === 'fulfilled' && tempoRes.value) {
          setTempoResp(tempoRes.value);
          console.log('ForecastScreen: Tempo server fetch succeeded; using server response');
        } else {
          console.warn('ForecastScreen: Tempo server fetch failed:', tempoRes.reason);
          // fallback: accept incomingAqData.tempo only if coordinates match and allowTempo true
          if (incomingAqData && incomingAqData.tempo && incomingAqData.tempo.hourly) {
            const incomingLat = incomingAqData.tempo.site?.lat ?? incomingAqData.site?.lat ?? incomingAqData.weather?.coord?.lat;
            const incomingLon = incomingAqData.tempo.site?.lon ?? incomingAqData.site?.lon ?? incomingAqData.weather?.coord?.lon;
            if (incomingLat && incomingLon && Math.abs(incomingLat - lat) < 0.005 && Math.abs(incomingLon - lon) < 0.005) {
              setTempoResp(incomingAqData);
              console.log('ForecastScreen: using incomingAqData tempo (coords matched).');
            } else {
              setTempoResp(null);
            }
          } else {
            setTempoResp(null);
          }
        }
      } else {
        setTempoResp(null); // explicitly disable tempo
      }

      if (owList.status === 'fulfilled' && Array.isArray(owList.value)) {
        const aggregated = aggregateOWHistoryToHourly(owList.value);
        setOwHourly(aggregated);
        console.log(`ForecastScreen: OpenWeather aggregated ${aggregated.length} hourly points`);
      } else {
        console.warn('ForecastScreen: OpenWeather history fetch failed:', owList.reason);
        setOwHourly([]);
      }

      setLastFetched(new Date());
    } catch (err) {
      console.error('doFetchAll error:', err);
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }, [canFetch, coords.latitude, coords.longitude, fetchOpenWeatherCountry, fetchOWHistory, fetchTempo, incomingAqData]);

  useEffect(() => {
    doFetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doFetchAll]);

  function buildTempoHourlyFromResp(resp) {
    if (!resp) return [];
    const arr = resp?.tempo?.hourly ?? resp?.tempo ?? resp?.hourly ?? null;
    if (!Array.isArray(arr)) return [];
    const out = arr.map(h => {
      let timeIso = null;
      let ts = null;
      if (typeof h.time === 'string') {
        timeIso = h.time;
        ts = Math.floor(new Date(timeIso).getTime() / 1000);
      } else if (typeof h.dt === 'number') {
        ts = Math.floor(h.dt);
        timeIso = new Date(ts * 1000).toISOString();
      } else if (typeof h.ts === 'number') {
        ts = Math.floor(h.ts);
        timeIso = new Date(ts * 1000).toISOString();
      } else if (typeof h.timestamp === 'number') {
        ts = Math.floor(h.timestamp);
        timeIso = new Date(ts * 1000).toISOString();
      } else {
        for (const k of Object.keys(h)) {
          const v = h[k];
          if (typeof v === 'string' && v.includes('T') && v.includes(':')) {
            timeIso = v;
            ts = Math.floor(new Date(timeIso).getTime() / 1000);
            break;
          }
        }
      }
      let pm25 = null;
      if (h.PM25 != null) pm25 = Number(h.PM25);
      else if (h.pm25 != null) pm25 = Number(h.pm25);
      else if (h.PM2_5 != null) pm25 = Number(h.PM2_5);
      else if (h.pm2_5 != null) pm25 = Number(h.pm2_5);
      else if (h.components && (h.components.pm2_5 != null)) pm25 = Number(h.components.pm2_5);
      return { time: timeIso, PM25: (Number.isFinite(pm25) ? pm25 : null), ts };
    }).filter(x => x.time || x.ts);
    out.sort((a,b) => (a.ts || new Date(a.time).getTime()/1000) - (b.ts || new Date(b.time).getTime()/1000));
    return out;
  }

  const tempoHourly = buildTempoHourlyFromResp(tempoResp);

  // Build target timeline (prefer OW timeline)
  let targetTs = [];
  if (owHourly && owHourly.length >= 2) {
    targetTs = owHourly.map(h => Math.floor(h.ts || new Date(h.time).getTime() / 1000));
  } else if (tempoHourly && tempoHourly.length >= 2) {
    targetTs = tempoHourly.map(h => Math.floor(h.ts || new Date(h.time).getTime() / 1000));
  } else {
    const now = Math.floor(Date.now() / 1000);
    const hourStart = Math.floor(now / 3600) * 3600;
    const count = 12;
    for (let i = 0; i < count; i++) targetTs.push(hourStart + i * 3600);
  }

  // Align / interpolate tempo onto targetTs
  let tempoPM25Aligned = [];
  if (tempoHourly.length >= 2) {
    const src = tempoHourly.map(h => ({ ts: h.ts || Math.floor(new Date(h.time).getTime()/1000), PM25: h.PM25 }));
    tempoPM25Aligned = targetTs.map(ts => {
      const v = interpValueAt(ts, src, 'PM25');
      return (v == null ? null : Number(v));
    });
    console.log('ForecastScreen: tempo interpolated to target timeline');
  } else if (tempoHourly.length === 1 && targetTs.length > 1 && owHourly.length > 1) {
    const tempoVal = tempoHourly[0].PM25;
    const owVals = owHourly.map(h => (h.PM25 != null ? Number(h.PM25) : null));
    const valid = owVals.filter(v => v != null);
    const owMean = valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
    if (owMean && owMean > 0 && tempoVal != null) {
      const ratio = tempoVal / owMean;
      tempoPM25Aligned = owVals.map(v => (v != null ? Number(v) * ratio : null));
      console.log('ForecastScreen: tempo single sample scaled across OW shape (ratio=', ratio.toFixed(3), ')');
    } else {
      tempoPM25Aligned = targetTs.map(() => tempoVal);
      console.log('ForecastScreen: tempo single sample padded across timeline');
    }
  } else if (tempoHourly.length === 1) {
    const tempoVal = tempoHourly[0].PM25;
    tempoPM25Aligned = targetTs.map(() => tempoVal);
    console.log('ForecastScreen: tempo single sample padded (no OW present)');
  } else {
    tempoPM25Aligned = targetTs.map(() => null);
    console.log('ForecastScreen: no tempo samples available to align');
  }

  const tempoAQI_raw = tempoPM25Aligned.map(v => (v != null ? pm25ToAQI(v) : null));
  const owPM25 = owHourly.map(h => (h.PM25 != null ? Number(h.PM25) : null));
  const owAQI_raw = owPM25.map(v => (v != null ? pm25ToAQI(v) : null));
  const targetLabelsRaw = targetTs.map(ts => {
    const iso = new Date(ts * 1000).toISOString();
    return hourLabelFromISO(iso);
  });

  function prepareChartSeries(labelsRaw, aqiRaw) {
    const labels = [...labelsRaw];
    const data = [...aqiRaw];
    const dataForPlot = data.map(v => (v == null || Number.isNaN(v) ? 0 : v));
    if (dataForPlot.length === 1) {
      dataForPlot.push(dataForPlot[0]);
      labels.push(labels[0] + ' ');
      console.log('prepareChartSeries: padded single-point series so line-chart renders a visible point');
    }
    return { labels, data: dataForPlot, rawCount: data.filter(v => v != null).length };
  }

  const tempoSeries = prepareChartSeries(targetLabelsRaw, tempoAQI_raw);
  let owSeries;
  if (owHourly.length >= 2 && owHourly.length === targetTs.length) {
    owSeries = prepareChartSeries(targetLabelsRaw, owAQI_raw);
  } else if (owHourly.length >= 2) {
    const srcOw = owHourly.map(h => ({ ts: Math.floor(h.ts || new Date(h.time).getTime()/1000), PM25: h.PM25 }));
    const owAlignedPM25 = targetTs.map(ts => interpValueAt(ts, srcOw, 'PM25'));
    const owAlignedAQI = owAlignedPM25.map(v => (v != null ? pm25ToAQI(v) : null));
    owSeries = prepareChartSeries(targetLabelsRaw, owAlignedAQI);
  } else {
    const labels = (owHourly.length ? owHourly.map(h => hourLabelFromISO(h.time)) : []);
    const data = (owAQI_raw.length ? owAQI_raw.map(v => (v == null ? 0 : v)) : []);
    owSeries = { labels, data, rawCount: owAQI_raw.length };
  }

  const MAX_TICKS = 6;
  tempoSeries.labels = sparsifyLabels(tempoSeries.labels, MAX_TICKS);
  owSeries.labels = sparsifyLabels(owSeries.labels, MAX_TICKS);

  const safeSeries = (arr) => arr.map(v => (v == null || Number.isNaN(v) ? 0 : v));

  let forecastValueText = 'No data';
  try {
    const groundVals = (tempoResp?.ground?.results?.[0]?.measurements || [])
      .filter(m => m.parameter === 'pm25')
      .map(m => m.value)
      .slice(0, 6);
    const satVals = tempoPM25Aligned.filter(v => v != null);
    const weather = tempoResp?.weather ? { wind_speed: tempoResp.weather.wind?.speed, rain: tempoResp.weather.rain } : {};
    if ((groundVals && groundVals.length > 0) || (satVals && satVals.length > 0)) {
      const fc = simpleForecast({ groundVals: groundVals.length ? groundVals : [0], satVals, weather });
      forecastValueText = `${Math.round(fc)} µg/m³`;
    }
  } catch (e) {
    // ignore
  }

  useEffect(() => {
    console.log('ForecastScreen debug:', {
      coords,
      countryCode,
      showTempo,
      tempoRespPresent: !!tempoResp,
      tempoHourlyCount: tempoHourly.length,
      owHourlyCount: owHourly.length,
      targetPoints: targetTs.length,
      tempoSamplePreview: tempoPM25Aligned.slice(0, 6),
      owSamplePreview: owPM25.slice(0, 6),
    });
  }, [coords, countryCode, showTempo, tempoResp, tempoHourly.length, owHourly.length]);

  return (
    <ScrollView style={{ flex: 1, padding: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>AQI — Tempo vs OpenWeather</Text>
        <TouchableOpacity
          onPress={() => {
            if (!canFetch) { Alert.alert('No coordinates', 'Cannot refresh: coordinates are missing.'); return; }
            doFetchAll();
          }}
          style={styles.refreshBtn}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={{ marginVertical: 12 }}>
          <ActivityIndicator size="small" />
          <Text style={{ marginTop: 6 }}>Fetching data from Tempo.js and OpenWeather…</Text>
        </View>
      )}

      {error ? <Text style={{ color: 'red', marginVertical: 8 }}>{error}</Text> : null}

      <View style={{ marginTop: 8 }}>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>Tempo.js — AQI (from PM2.5)</Text>
        {!showTempo ? (
          <Text style={{ marginTop: 6, color: '#666' }}>
            Tempo is not available for this location{countryCode ? ` (detected country: ${countryCode})` : ''}.
          </Text>
        ) : tempoSeries.data.length === 0 ? (
          <Text style={{ marginTop: 6, color: '#666' }}>No Tempo hourly data available.</Text>
        ) : (
          <LineChart
            data={{
              labels: tempoSeries.labels,
              datasets: [{ data: safeSeries(tempoSeries.data) }],
            }}
            width={Dimensions.get('window').width - 24}
            height={220}
            withDots={true}
            withInnerLines={true}
            fromZero={true}
            yAxisSuffix=""
            yAxisLabel=""
            chartConfig={{
              backgroundColor: '#fff',
              backgroundGradientFrom: '#fff',
              backgroundGradientTo: '#fff',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(0,0,0,${opacity})`,
            }}
            bezier
            style={{ borderRadius: 8, marginTop: 8 }}
          />
        )}
      </View>

      <View style={{ marginTop: 18 }}>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>OpenWeather — AQI (history / current)</Text>
        {owSeries.data.length === 0 ? (
          <Text style={{ marginTop: 6, color: '#666' }}>No OpenWeather hourly data available.</Text>
        ) : (
          <LineChart
            data={{
              labels: owSeries.labels,
              datasets: [{ data: safeSeries(owSeries.data) }],
            }}
            width={Dimensions.get('window').width - 24}
            height={220}
            withDots={true}
            withInnerLines={true}
            fromZero={true}
            yAxisSuffix=""
            yAxisLabel=""
            chartConfig={{
              backgroundColor: '#fff',
              backgroundGradientFrom: '#fff',
              backgroundGradientTo: '#fff',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(0,0,0,${opacity})`,
            }}
            bezier
            style={{ borderRadius: 8, marginTop: 8 }}
          />
        )}
      </View>

      <View style={{ height: 20 }} />

      <Text style={{ fontSize: 16, fontWeight: '500' }}>Simple forecast (one-step):</Text>
      <Text style={{ marginTop: 8 }}>
        {(() => {
          try {
            const groundVals = (tempoResp?.ground?.results?.[0]?.measurements || [])
              .filter(m => m.parameter === 'pm25')
              .map(m => m.value)
              .slice(0, 6);
            const owPM25Flat = owPM25 || [];
            if ((groundVals && groundVals.length > 0) || (owPM25Flat && owPM25Flat.length > 0)) {
              return `Forecast value (PM2.5 proxy): ${forecastValueText}`;
            }
            return 'No data';
          } catch {
            return 'No data';
          }
        })()}
      </Text>
      <Text style={{ marginTop: 6, color: '#6b7280' }}>Last fetched: {lastFetched ? lastFetched.toLocaleString() : '—'}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#2d6cdf',
    borderRadius: 8,
  },
});
