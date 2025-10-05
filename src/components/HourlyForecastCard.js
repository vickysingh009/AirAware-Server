// src/components/HourlyForecastCard.js
import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Image,
  TouchableOpacity,
} from 'react-native';
import axios from 'axios';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { pm25ToAQI } from '../utils/aqi'; // <-- use your existing converter

// NOTE: Move to secure storage for production
const DEFAULT_OPENWEATHER_KEY = 'f93455a804ee994a672e83422cacc578';

// --- AQI Helper (OpenWeather 1..5 scale -> labels/colors) ---
const getAqiInfo = (aqi) => {
  if (!aqi && aqi !== 0) return { label: '-', color: '#9ca3af' };
  switch (aqi) {
    case 1: return { label: 'Good', color: '#22c55e' };
    case 2: return { label: 'Fair', color: '#84cc16' };
    case 3: return { label: 'Moderate', color: '#facc15' };
    case 4: return { label: 'Poor', color: '#f97316' };
    case 5: return { label: 'Very Poor', color: '#ef4444' };
    default: return { label: `AQI ${aqi}`, color: '#6b7280' };
  }
};

// --- Daily Forecast Item Component ---
const DayForecastItem = ({ item, aqi }) => {
  const dt = new Date(item.dt * 1000);
  const dayName = dt.toLocaleDateString([], { weekday: 'long' });
  const icon = item.weather?.[0]?.icon ?? '01d';
  const iconUrl = `https://openweathermap.org/img/wn/${icon}@2x.png`;
  const maxTemp = item.temp?.max ?? item.temp_max ?? 'N/A';
  const minTemp = item.temp?.min ?? item.temp_min ?? 'N/A';
  const pop = item.pop ?? 0;
  const aqiInfo = getAqiInfo(aqi);

  return (
    <View style={styles.dayRow}>
      <View style={styles.dayInfo}>
        <Text style={styles.dayName}>{dayName}</Text>
        <View style={styles.dayMetrics}>
          <Icon name="water-percent" size={14} color={theme.primary} />
          <Text style={styles.dayMetricText}>{Math.round(pop * 100)}%</Text>
          <Icon name="leaf" size={14} color={aqiInfo.color} style={{ marginLeft: 12 }}/>
          <Text style={[styles.dayMetricText, { color: aqiInfo.color }]}>{aqiInfo.label}</Text>
        </View>
      </View>
      <Image source={{ uri: iconUrl }} style={styles.dayIcon} />
      <Text style={styles.dayTemp}>{Math.round(maxTemp)}° / {Math.round(minTemp)}°</Text>
    </View>
  );
};

export default function HourlyForecastCard({
  data,
  loc,
  server,
  apiKey,
  dailyAqiMode = 'average' /* 'average' or 'max' */
}) {
  const [forecastType, setForecastType] = useState('hourly');
  const [hourly, setHourly] = useState([]);
  const [daily, setDaily] = useState([]);
  const [openAqiRaw, setOpenAqiRaw] = useState([]); // raw OpenWeather AQI samples
  const [tempoHourly, setTempoHourly] = useState([]); // tempo.hourly from your server (if returned)
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState(null);

  // --- Mock fallbacks ---
  const MOCK_HOURLY = Array.from({ length: 12 }).map((_, i) => ({ dt: Math.floor(Date.now() / 1000) + i * 3600, temp: 22, pop: 0, weather: [{ icon: '01d' }] }));
  const MOCK_DAILY = Array.from({ length: 5 }).map((_, i) => ({ dt: Math.floor(Date.now() / 1000) + i * 86400, temp: { min: 15, max: 25 }, pop: 0, weather: [{ icon: '01d' }] }));

  // --- Normalizers & helpers ---
  function normalizeHourlyArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 12).map(it => ({ dt: it.dt, temp: it.temp ?? it.main?.temp ?? it.temp?.day ?? null, pop: typeof it.pop === 'number' ? it.pop : (it.rain ? 1 : 0), weather: it.weather ?? [{ icon: '01d' }], }));
  }
  function normalizeDailyArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 5).map(it => ({ dt: it.dt, temp: it.temp ?? { min: it.temp_min ?? it.main?.temp_min, max: it.temp_max ?? it.main?.temp_max }, pop: it.pop ?? 0, weather: it.weather ?? [{ icon: '01d' }], }));
  }

  function aggregateThreeHourlyToDaily(list3h) {
    if (!Array.isArray(list3h)) return [];
    const days = {};
    list3h.forEach(item => {
      const date = new Date(item.dt * 1000).toISOString().split('T')[0];
      if (!days[date]) { days[date] = { dt: item.dt, temps: [], pops: [], weathers: [] }; }
      const temp = (item.main && item.main.temp) ?? (item.temp ?? null);
      if (temp != null) days[date].temps.push(temp);
      days[date].pops.push(item.pop ?? 0);
      days[date].weathers.push(item.weather ?? [{ icon: '01d' }]);
    });
    return Object.values(days).map(day => ({ dt: day.dt, temp: { min: Math.min(...day.temps), max: Math.max(...day.temps) }, pop: Math.max(...day.pops), weather: day.weathers[Math.floor(day.weathers.length/2)] })).slice(0,5);
  }

  function expandThreeHourlyToHourly(list3h) {
    // produce up to 12 hourly items by linear interpolation between 3-hour points
    if (!Array.isArray(list3h) || list3h.length === 0) return [];
    const out = [];
    for (let i = 0; i < list3h.length - 1 && out.length < 12; i++) {
      const a = list3h[i];
      const b = list3h[i+1];
      const steps = 3; // 3 hours between points
      for (let s = 0; s < steps && out.length < 12; s++) {
        const t = s/steps;
        const dt = Math.floor(a.dt + s*3600);
        const tempA = (a.main && a.main.temp) ?? a.temp ?? 0;
        const tempB = (b.main && b.main.temp) ?? b.temp ?? tempA;
        const popA = a.pop ?? 0;
        const popB = b.pop ?? 0;
        out.push({ dt, temp: tempA + (tempB-tempA)*t, pop: popA + (popB-popA)*t, weather: a.weather ?? b.weather });
      }
    }
    // ensure at least 12 entries (repeat last if needed)
    while (out.length < 12 && out.length > 0) out.push({ ...out[out.length-1], dt: out[out.length-1].dt + 3600 });
    return out.slice(0,12);
  }

  // --- API Callers ---
  async function tryOpenWeather(lat, lon, key) {
    try {
      const r3 = await axios.get(`https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,current&units=metric&appid=${key}`);
      if (r3?.data?.hourly && r3?.data?.daily) {
        return { hourly: normalizeHourlyArray(r3.data.hourly), daily: normalizeDailyArray(r3.data.daily) };
      }
    } catch (e) {}
    try {
      const rf = await axios.get(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${key}`);
      if (rf?.data?.list) {
        return { hourly: normalizeHourlyArray(expandThreeHourlyToHourly(rf.data.list)), daily: aggregateThreeHourlyToDaily(rf.data.list) };
      }
    } catch (e) {}
    return null;
  }

  async function tryOpenWeatherAQI(lat, lon, key) {
    try {
      // we request forecast (hourly) if available
      const { data } = await axios.get(`https://api.openweathermap.org/data/2.5/air_pollution/forecast?lat=${lat}&lon=${lon}&appid=${key}`);
      return Array.isArray(data.list) ? data.list : [];
    } catch (e) {
      // try current / historical as fallback
      try {
        const { data } = await axios.get(`https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${key}`);
        return data?.list ? data.list : [];
      } catch (e2) {
        return [];
      }
    }
  }

  // Fetch tempo hourly from your server if available (server should return tempo.hourly)
  async function tryServerTempo(serverUrl, lat, lon) {
    if (!serverUrl) return [];
    try {
      const resp = await axios.get(`${serverUrl}/api/aq?lat=${lat}&lon=${lon}`, { timeout: 20000 });
      const tempo = resp.data?.tempo;
      if (tempo && Array.isArray(tempo.hourly)) {
        // tempo.hourly entries often have time as ISO string; convert to { dt, PM25, ... }
        return tempo.hourly.map(h => {
          const dt = (typeof h.time === 'string') ? Math.floor(new Date(h.time).getTime() / 1000) : (h.dt ?? null);
          return { dt, PM25: (h.PM25 != null ? Number(h.PM25) : (h.pm25 != null ? Number(h.pm25) : null)), raw: h };
        }).filter(x => x.dt != null);
      }
    } catch (e) {
      console.warn('tryServerTempo failed:', e?.message ?? e);
    }
    return [];
  }

  // --- Core: merge AQI samples to hourly slots ---
  // prefer OpenWeather AQI sample (item.main.aqi), otherwise use Tempo.pm25 -> convert to AQI
  // matching is done by nearest timestamp within tolerance (seconds)
  function buildHourlyAqiMap(weatherHourly, openAqiList, tempoList, matchToleranceSec = 90 * 60) {
    // openAqiList: array of { dt, main: { aqi } } (OpenWeather format)
    // tempoList: array of { dt, PM25 }
    const map = new Map();
    if (!weatherHourly || weatherHourly.length === 0) return map;

    // index open weather samples by dt
    const openByDt = (openAqiList && openAqiList.length) ? openAqiList.slice() : [];
    const tempoByDt = (tempoList && tempoList.length) ? tempoList.slice() : [];

    for (const h of weatherHourly) {
      const targetDt = h.dt;
      let chosen = null;

      // 1) try nearest OpenWeather sample
      if (openByDt.length) {
        let best = null;
        let bestDiff = Infinity;
        for (const s of openByDt) {
          if (s == null || s.dt == null) continue;
          const diff = Math.abs(s.dt - targetDt);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = s;
          }
        }
        if (best && bestDiff <= matchToleranceSec) {
          const aqiVal = best?.main?.aqi;
          if (aqiVal != null) chosen = aqiVal;
        }
      }

      // 2) fallback to tempo samples (pm25 -> convert to AQI)
      if (chosen == null && tempoByDt.length) {
        let best = null;
        let bestDiff = Infinity;
        for (const s of tempoByDt) {
          if (s == null || s.dt == null) continue;
          const diff = Math.abs(s.dt - targetDt);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = s;
          }
        }
        if (best && bestDiff <= matchToleranceSec && best.PM25 != null) {
          const aqiFromPm25 = pm25ToAQI(Number(best.PM25));
          if (aqiFromPm25 != null && !Number.isNaN(aqiFromPm25)) {
            // pm25ToAQI returns numeric (EPA scale) — convert to 1..5 OpenWeather-like scale?
            // We will map EPA AQI ranges into discrete 1..5 categories (approx):
            // 1 Good: 0-50, 2 Fair:51-100, 3 Moderate:101-150, 4 Poor:151-200, 5 Very Poor:201+
            const epa = aqiFromPm25;
            let mapped = null;
            if (epa <= 50) mapped = 1;
            else if (epa <= 100) mapped = 2;
            else if (epa <= 150) mapped = 3;
            else if (epa <= 200) mapped = 4;
            else mapped = 5;
            chosen = mapped;
          }
        }
      }

      map.set(targetDt, chosen);
    }

    return map;
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!loc) {
        setErrMsg('Location not available.');
        return;
      }
      setLoading(true);
      setErrMsg(null);
      const key = apiKey || DEFAULT_OPENWEATHER_KEY;

      // Parallel: weather + openweather AQ + server tempo (optional)
      const pWeather = tryOpenWeather(loc.latitude, loc.longitude, key);
      const pOpenAqi = tryOpenWeatherAQI(loc.latitude, loc.longitude, key);
      const pTempo = server ? tryServerTempo(server, loc.latitude, loc.longitude) : Promise.resolve([]);

      const [weatherResult, openAqiResult, tempoResult] = await Promise.all([pWeather, pOpenAqi, pTempo]);

      if (cancelled) return;

      if (weatherResult) {
        const h = weatherResult.hourly || [];
        const d = weatherResult.daily || [];
        setHourly(h);
        setDaily(d);
      } else {
        setHourly(MOCK_HOURLY);
        setDaily(MOCK_DAILY);
      }

      setOpenAqiRaw(openAqiResult || []);
      setTempoHourly(tempoResult || []);

      // if both weatherResult and any AQ data exist, we'll compute mappings in useMemo below
      if (!weatherResult && (!openAqiResult || !openAqiResult.length) && (!tempoResult || !tempoResult.length)) {
        setErrMsg('Could not fetch forecast or AQ data.');
      }

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [loc, apiKey, server]);

  // --- Memoized maps for efficient AQI lookup ---
  const hourlyAqiMap = useMemo(() => {
    // build a map dt -> aqi (1..5 scale) for each hourly dt in `hourly[]`
    if (!hourly || hourly.length === 0) return new Map();
    return buildHourlyAqiMap(hourly, openAqiRaw, tempoHourly);
  }, [hourly, openAqiRaw, tempoHourly]);

  // daily map uses mapped hourly values to compute average or max per day
  const dailyAqiMap = useMemo(() => {
    if (!hourly || hourly.length === 0) return new Map();
    const groups = {}; // dateStr -> array of aqi (filtered non-null)
    for (const h of hourly) {
      const aqiVal = hourlyAqiMap.get(h.dt);
      const dateStr = new Date(h.dt * 1000).toISOString().split('T')[0];
      if (!groups[dateStr]) groups[dateStr] = [];
      if (aqiVal != null) groups[dateStr].push(aqiVal);
    }
    const out = new Map();
    Object.entries(groups).forEach(([dateStr, arr]) => {
      if (!arr.length) return;
      if (dailyAqiMode === 'max') out.set(dateStr, Math.max(...arr));
      else {
        const avg = Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
        out.set(dateStr, avg);
      }
    });
    return out;
  }, [hourlyAqiMap, hourly, dailyAqiMode]);

  // --- UI Rendering ---
  const renderContent = () => {
    if (loading) { return <ActivityIndicator color={theme.primary} style={{ height: 150 }}/>; }
    if (forecastType === 'hourly') {
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {hourly.map((h, idx) => {
            const dt = new Date(h.dt * 1000);
            const aqi = hourlyAqiMap.get(h.dt);
            const aqiInfo = getAqiInfo(aqi);
            return (
              <View key={idx} style={[styles.card, idx === 0 && styles.cardActive]}>
                <Text style={[styles.time, idx === 0 && styles.textActive]}>{idx === 0 ? 'Now' : dt.toLocaleTimeString([], { hour: 'numeric' })}</Text>
                <Image source={{ uri: `https://openweathermap.org/img/wn/${h.weather?.[0]?.icon}@2x.png` }} style={styles.icon}/>
                <Text style={[styles.temp, idx === 0 && styles.textActive]}>{h.temp != null ? `${Math.round(h.temp)}°` : '—'}</Text>
                <View style={styles.cardMetrics}>
                  <Icon name="water-percent" size={14} color={idx === 0 ? '#fff' : theme.primary} />
                  <Text style={[styles.cardMetricText, idx === 0 && styles.textActive]}>{Math.round(h.pop * 100)}%</Text>
                  <Text style={[styles.cardMetricText, { color: aqiInfo.color, marginLeft: 4 }]}>AQI {aqi ?? '-'}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      );
    }
    if (forecastType === 'daily') {
      return (
        <View style={styles.dailyContainer}>
          {daily.map((item, idx) => {
            const dateStr = new Date(item.dt * 1000).toISOString().split('T')[0];
            const avgAqi = dailyAqiMap.get(dateStr);
            return <DayForecastItem key={idx} item={item} aqi={avgAqi} />;
          })}
        </View>
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Forecast</Text>
        <View style={styles.toggleContainer}>
          <TouchableOpacity onPress={() => setForecastType('hourly')} style={[styles.toggleButton, forecastType === 'hourly' && styles.toggleActive]}><Text style={[styles.toggleText, forecastType === 'hourly' && styles.toggleTextActive]}>Hourly</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setForecastType('daily')} style={[styles.toggleButton, forecastType === 'daily' && styles.toggleActive]}><Text style={[styles.toggleText, forecastType === 'daily' && styles.toggleTextActive]}>5-Day</Text></TouchableOpacity>
        </View>
      </View>
      {errMsg && <Text style={styles.err}>{errMsg}</Text>}
      {renderContent()}
    </View>
  );
}

// --- Styles ---
const theme = { background: '#f0f5f9', cardBg: '#ffffff', cardActiveBg: '#3a86ff', primary: '#3a86ff', textPrimary: '#1e293b', textSecondary: '#64748b', textActive: '#ffffff', error: '#ef4444', border: '#e2e8f0', };
const styles = StyleSheet.create({
  container: { backgroundColor: theme.cardBg, borderRadius: 16, paddingVertical: 16, marginTop: 20, marginHorizontal: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12, },
  title: { fontSize: 18, fontWeight: '700', color: theme.textPrimary, },
  err: { color: theme.error, fontSize: 12, marginBottom: 8, textAlign: 'center', paddingHorizontal: 16, },
  scroll: { paddingVertical: 4, paddingHorizontal: 16, },
  card: { backgroundColor: theme.background, borderRadius: 12, padding: 8, alignItems: 'center', justifyContent: 'space-between', marginRight: 10, width: 85, height: 150, },
  cardActive: { backgroundColor: theme.cardActiveBg, elevation: 2, },
  time: { fontSize: 14, fontWeight: '500', color: theme.textSecondary, },
  icon: { width: 50, height: 50, },
  temp: { fontSize: 20, fontWeight: '700', color: theme.textPrimary, marginVertical: 4 },
  textActive: { color: theme.textActive, },
  toggleContainer: { flexDirection: 'row', backgroundColor: theme.background, borderRadius: 8, padding: 2, },
  toggleButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, },
  toggleActive: { backgroundColor: theme.cardActiveBg, },
  toggleText: { fontWeight: '600', color: theme.textSecondary, },
  toggleTextActive: { color: 'white', },
  dailyContainer: { paddingHorizontal: 16, },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border, },
  dayInfo: { flex: 1.2, },
  dayName: { fontSize: 16, fontWeight: '500', color: theme.textPrimary, marginBottom: 4 },
  dayIcon: { width: 45, height: 45, marginHorizontal: 8 },
  dayTemp: { flex: 1, fontSize: 16, fontWeight: '500', color: theme.textPrimary, textAlign: 'right', },
  cardMetrics: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cardMetricText: { fontSize: 12, color: theme.textSecondary, marginLeft: 2 },
  dayMetrics: { flexDirection: 'row', alignItems: 'center' },
  dayMetricText: { fontSize: 13, color: theme.textSecondary, marginLeft: 4 },
});
