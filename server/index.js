const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 4000;

// ---------- HARDCODED OpenWeather API KEY (for local testing only) ----------
const OW_API_KEY = 'f93455a804ee994a672e83422cacc578';
// -------------------------------------------------------------------------

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  next();
});

// Optional: tempo-mock fallback file if OpenWeather fails (place it in same folder)
let tempoMock = null;
try {
  tempoMock = require('./tempo-mock.json');
} catch (e) {
  // tempoMock optional; we will still proceed without it
  tempoMock = null;
}

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

app.get('/api/aq', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({
      error: 'lat and lon query parameters required',
      example: '/api/aq?lat=26.196537&lon=73.0117655'
    });
  }

  const warnings = [];
  let weather = null;

  try {
    // 1) Fetch OpenWeather current weather (gives name + coords + main data)
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OW_API_KEY}&units=metric`;
    const weatherResp = await safeFetch(weatherUrl);
    if (weatherResp.ok) {
      weather = weatherResp.data;
    } else {
      warnings.push({ source: 'openweather_weather', detail: weatherResp.error });
    }

    // 2) Fetch OpenWeather Air Pollution (per-point pollutant components)
    const airUrl = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${OW_API_KEY}`;
    const airResp = await safeFetch(airUrl);
    let airComponents = null;
    let airDt = null;
    if (airResp.ok && Array.isArray(airResp.data.list) && airResp.data.list[0]) {
      airComponents = airResp.data.list[0].components;
      airDt = airResp.data.list[0].dt;
    } else {
      warnings.push({ source: 'openweather_air', detail: airResp.error || 'no air data' });
    }

    // 3) Build a 'tempo'-like object (so UI remains unchanged)
    const tempo = {};
    tempo.site = {
      lat: Number(lat),
      lon: Number(lon),
      name:
        (weather && weather.name) ||
        `Selected location (${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)})`,
    };

    // Compose hourly[0] with pollutant data
    const hourEntry = {
      time: airDt ? new Date(airDt * 1000).toISOString() : new Date().toISOString(),
    };

    if (airComponents) {
      if (airComponents.pm2_5 != null) hourEntry.PM25 = Number(airComponents.pm2_5);
      if (airComponents.no2 != null) hourEntry.NO2 = Number(airComponents.no2);
      if (airComponents.o3 != null) hourEntry.O3 = Number(airComponents.o3);
      if (airComponents.pm10 != null) hourEntry.PM10 = Number(airComponents.pm10);
      if (airComponents.co != null) hourEntry.CO = Number(airComponents.co);
    } else if (tempoMock && tempoMock.hourly && tempoMock.hourly[0]) {
      Object.assign(hourEntry, tempoMock.hourly[0]);
      warnings.push({ source: 'tempo_mock_used', detail: 'air data missing; using mock values' });
    }

    // --- CHANGE: Add weather data to the hourEntry object ---
    // This makes it available under `tempo.hourly[0]` for the AQICard component.
    if (weather) {
      if (weather.main?.temp != null) hourEntry.Temperature = weather.main.temp;
      if (weather.main?.humidity != null) hourEntry.Humidity = weather.main.humidity;
      if (weather.wind?.speed != null) hourEntry.Wind_Speed = weather.wind.speed; // This is in m/s
    }
    // --- END CHANGE ---

    tempo.hourly = [hourEntry];

    // 4) Response shape: keep ground=null, include weather (for other uses), and enriched tempo
    res.json({
      ground: null,
      weather, // Keep the original weather object in case it's needed elsewhere
      tempo,
      warnings
    });

  } catch (err) {
    console.error('Unexpected server error in /api/aq:', err);
    // Final fallback: return mock if present
    if (tempoMock) {
      return res.json({
        ground: null,
        weather: null,
        tempo: tempoMock,
        warnings: [{ source: 'server', detail: 'error; returned tempo mock' }]
      });
    }
    res.status(500).json({ error: 'server error', details: String(err) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Aggregator server running on port ${PORT}`);
});
