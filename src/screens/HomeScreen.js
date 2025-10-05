import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import * as Location from 'expo-location';
import axios from 'axios';
import AQICard from '../components/AQICard';
import AQISummaryCard from '../components/AQISummaryCard';
import BottomNavBar from '../components/BottomNavBar';
import HourlyForecastCard from '../components/HourlyForecastCard';

// Tempo.js server (make sure Tempo.js is running at this address)
const SERVER = 'http://10.47.36.61:4000';

// OpenWeather API key used for direct fallback when outside US/CA/MX or for country lookup
const OW_API_KEY = 'f93455a804ee994a672e83422cacc578';

// Countries that should use your SERVER (Tempo.js)
const SERVER_COUNTRIES = new Set(['US', 'CA', 'MX']);

// Set to true to force a Tempo.js call regardless of detected country (useful for debugging)
const FORCE_SERVER = false;

/**
 * detectCountryCode:
 *  - tries Location.reverseGeocodeAsync() -> returns isoCountryCode if available
 *  - else tries OpenWeather 'weather' endpoint (sys.country)
 *  - else tries BigDataCloud reverse-geocode free endpoint
 *  - returns uppercase 2-letter country code (e.g. 'US') or null
 */
async function detectCountryCode(lat, lon) {
  // 1) expo-location reverse geocode
  try {
    const rev = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    if (Array.isArray(rev) && rev[0]) {
      const iso = rev[0].isoCountryCode || null;
      if (iso) {
        console.log('detectCountryCode: from reverseGeocodeAsync =>', iso.toUpperCase());
        return iso.toUpperCase();
      }
    }
  } catch (e) {
    console.warn('detectCountryCode: reverseGeocodeAsync failed:', e?.message || e);
  }

  // 2) OpenWeather 'weather' endpoint (fast and often returns sys.country)
  try {
    const wUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OW_API_KEY}`;
    const wResp = await axios.get(wUrl, { timeout: 8000 });
    if (wResp && wResp.data && wResp.data.sys && wResp.data.sys.country) {
      console.log('detectCountryCode: from OpenWeather weather =>', String(wResp.data.sys.country).toUpperCase());
      return String(wResp.data.sys.country).toUpperCase();
    }
  } catch (e) {
    console.warn('detectCountryCode: OpenWeather country lookup failed:', e?.message || e);
  }

  // 3) BigDataCloud reverse geocode (free, no key)
  try {
    const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const bdcResp = await axios.get(bdcUrl, { timeout: 8000 });
    if (bdcResp && bdcResp.data && bdcResp.data.countryCode) {
      console.log('detectCountryCode: from BigDataCloud =>', String(bdcResp.data.countryCode).toUpperCase());
      return String(bdcResp.data.countryCode).toUpperCase();
    }
  } catch (e) {
    console.warn('detectCountryCode: BigDataCloud failed:', e?.message || e);
  }

  console.log('detectCountryCode: unknown');
  return null;
}

export default function HomeScreen({ navigation, route }) {
  const [loc, setLoc] = useState(null);
  const [aqData, setAqData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // track which bottom tab is active
  const [activeTab, setActiveTab] = useState('dataBank');

  async function buildTempoFromOpenWeather(weatherResp, airResp) {
    const tempo = {};
    const lat = weatherResp?.coord?.lat ?? (airResp?.coord?.lat ?? null);
    const lon = weatherResp?.coord?.lon ?? (airResp?.coord?.lon ?? null);

    tempo.site = {
      lat: lat !== null ? Number(lat) : (loc?.latitude ?? 0),
      lon: lon !== null ? Number(lon) : (loc?.longitude ?? 0),
      name:
        (weatherResp && weatherResp.name) ||
        `Selected location (${Number(loc?.latitude ?? 0).toFixed(4)}, ${Number(loc?.longitude ?? 0).toFixed(4)})`,
    };

    const hourEntry = {
      time: new Date().toISOString(),
    };

    if (airResp && Array.isArray(airResp.list) && airResp.list[0]) {
      const ent = airResp.list[0];
      const comps = ent.components || {};
      if (comps.pm2_5 != null) hourEntry.PM25 = Number(comps.pm2_5);
      if (comps.no2 != null) hourEntry.NO2 = Number(comps.no2);
      if (comps.o3 != null) hourEntry.O3 = Number(comps.o3);
      if (comps.pm10 != null) hourEntry.PM10 = Number(comps.pm10);
      if (comps.co != null) hourEntry.CO = Number(comps.co);
      if (typeof ent.dt === 'number') hourEntry.time = new Date(ent.dt * 1000).toISOString();
    }

    if (weatherResp) {
      if (weatherResp.main?.temp != null) hourEntry.Temperature = weatherResp.main.temp;
      if (weatherResp.main?.humidity != null) hourEntry.Humidity = weatherResp.main.humidity;
      if (weatherResp.wind?.speed != null) hourEntry.Wind_Speed = weatherResp.wind.speed;
      if (weatherResp.main?.pressure != null && hourEntry.Pressure_hPa == null) {
        hourEntry.Pressure_hPa = weatherResp.main.pressure;
        hourEntry.Pressure = hourEntry.Pressure ? hourEntry.Pressure : Math.round(weatherResp.main.pressure * 100);
      }
    }

    tempo.hourly = [hourEntry];
    return tempo;
  }

  async function fetchAQ(coords) {
    if (!coords) {
      setError('Location unavailable');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const countryCode = await detectCountryCode(coords.latitude, coords.longitude);
      const useServer = FORCE_SERVER || (countryCode && SERVER_COUNTRIES.has(countryCode));

      console.log('fetchAQ: coords=', coords, 'detectedCountry=', countryCode, 'FORCE_SERVER=', FORCE_SERVER, 'useServer=', useServer);

      if (useServer) {
        console.log(`fetchAQ: calling Tempo.js server ${SERVER}/api/aq?lat=${coords.latitude}&lon=${coords.longitude}`);
        try {
          const res = await axios.get(`${SERVER}/api/aq?lat=${coords.latitude}&lon=${coords.longitude}`, { timeout: 25000 });
          console.log('fetchAQ: Tempo.js response received');
          setAqData(res.data);
          setLastUpdated(new Date());
          setError(null);
          return;
        } catch (serverErr) {
          console.error('fetchAQ: Tempo.js request failed:', serverErr?.response?.data ?? serverErr.message ?? serverErr);
          // continue to fallback to OpenWeather
        }
      }

      // Fallback: OpenWeather path (or executed after server failure)
      console.log('fetchAQ: using OpenWeather fallback for', coords);
      const warnings = [];
      let weather = null;
      let airData = null;

      // 1) weather
      try {
        const wUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${coords.latitude}&lon=${coords.longitude}&appid=${OW_API_KEY}&units=metric`;
        const wResp = await axios.get(wUrl, { timeout: 20000 });
        weather = wResp.data;
      } catch (e) {
        console.warn('fetchAQ: openweather weather failed:', e?.message || e);
        warnings.push({ source: 'openweather_weather', detail: String(e?.message || e) });
      }

      // 2) air pollution (current)
      try {
        const aUrl = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${coords.latitude}&lon=${coords.longitude}&appid=${OW_API_KEY}`;
        const aResp = await axios.get(aUrl, { timeout: 20000 });
        airData = aResp.data;
        if (!(airData && Array.isArray(airData.list) && airData.list.length > 0)) {
          warnings.push({ source: 'openweather_air', detail: 'no air data returned' });
          airData = null;
        }
      } catch (e) {
        console.warn('fetchAQ: openweather air failed:', e?.message || e);
        warnings.push({ source: 'openweather_air', detail: String(e?.message || e) });
        airData = null;
      }

      const tempo = await buildTempoFromOpenWeather(weather, airData);
      const responseShape = { ground: null, weather, tempo, warnings };
      setAqData(responseShape);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error('fetchAQ error (outer):', err?.response?.data ?? err?.message ?? err);
      setError('Failed to fetch AQ data. Make sure the Tempo.js server is running and reachable if you expect server data.');
    } finally {
      setLoading(false);
    }
  }

  // initial device location + fetch
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Location permission not granted');
          return;
        }
        const l = await Location.getCurrentPositionAsync({});
        const coords = { latitude: l.coords.latitude, longitude: l.coords.longitude };
        console.log('HomeScreen: device location obtained:', coords);
        setLoc(coords);
        await fetchAQ(coords);
      } catch (e) {
        console.error('Location / fetch error:', e);
        setError('Unable to get location or fetch data: ' + (e.message || e));
      }
    })();
  }, []);

  // Listen for selectedLoc + aqData from MapScreen
  useEffect(() => {
    const incomingAQ = route?.params?.aqData;
    const selected = route?.params?.selectedLoc;

    if (incomingAQ) {
      if (selected && selected.latitude && selected.longitude) setLoc(selected);

      setAqData(incomingAQ);
      setLastUpdated(new Date());
      setError(null);
      try {
        navigation.setParams({ selectedLoc: null, aqData: null });
      } catch (e) {}
      return;
    }

    if (selected && selected.latitude && selected.longitude) {
      setLoc(selected);
      fetchAQ(selected);
      try {
        navigation.setParams({ selectedLoc: null });
      } catch (e) {}
    }
  }, [route?.params?.aqData, route?.params?.selectedLoc]);

  function openMap() {
    if (!loc) {
      Alert.alert('Location', 'Location not available yet.');
      return;
    }
    navigation.navigate('Map', { loc, aqData });
  }

  function openForecast() {
    navigation.navigate('Forecast', { aqData });
  }

  // Handle bottom nav presses
  const handleTabPress = (tab) => {
    setActiveTab(tab);

    if (tab === 'map') {
      openMap();
    } else if (tab === 'download') {
      if (loc) fetchAQ(loc);
      else Alert.alert('Location', 'Location not available');
    } else if (tab === 'more') {
      Alert.alert('More', 'More screen not implemented yet');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>AirAware — Dashboard</Text>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => {
            if (loc) fetchAQ(loc);
            else Alert.alert('Location', 'Location not available yet.');
          }}
        >
          <Text style={styles.headerBtnText}>⟳ Refresh</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContentContainer}>
        {loading && !aqData ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
            <Text style={{ marginTop: 8 }}>Loading air quality…</Text>
          </View>
        ) : (
          <>
            {activeTab === 'dataBank' ? (
              <>
                <AQISummaryCard data={aqData} loc={loc} onPressDetails={openForecast} />

                <View style={styles.quickActions}>
                  <TouchableOpacity style={styles.actionBtn} onPress={openForecast}>
                    <Text style={styles.actionText}>Open Forecast</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, styles.lightBtn]}
                    onPress={() => (loc ? fetchAQ(loc) : Alert.alert('Location', 'Location not available'))}
                  >
                    <Text style={[styles.actionText, styles.lightText]}>Refresh</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.actionBtn, styles.warnBtn]} onPress={openMap}>
                    <Text style={[styles.actionText, styles.warnText]}>View Map</Text>
                  </TouchableOpacity>
                </View>

                <AQICard
                  data={aqData}
                  onPressForecast={openForecast}
                  onRefresh={() => loc && fetchAQ(loc)}
                  onPressMap={openMap}
                  loading={loading}
                  error={error}
                  lastUpdated={lastUpdated}
                  hideSummary={true}
                />

                <HourlyForecastCard data={aqData} loc={loc} server={SERVER} />

                {!aqData && !loading && (
                  <Text style={styles.hint}>No AQ data yet — press Refresh or check your server.</Text>
                )}
              </>
            ) : (
              <View style={[styles.center, { height: 240 }]}>
                <Text style={{ textAlign: 'center' }}>
                  {activeTab === 'map' && 'Opening Map…'}
                  {activeTab === 'download' && 'Performing quick refresh…'}
                  {activeTab === 'more' && 'More options — not implemented yet.'}
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <BottomNavBar activeTab={activeTab} onTabPress={handleTabPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  header: {
    height: 64,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 2,
  },
  title: { fontWeight: '700', fontSize: 18 },
  headerBtn: { padding: 8, backgroundColor: '#eef3ff', borderRadius: 8 },
  headerBtnText: { color: '#2d6cdf', fontWeight: '600' },

  content: { padding: 14 },

  // --- increased bottom padding so content is not hidden behind nav ---
  scrollContentContainer: {
    paddingBottom: 100,
  },

  center: { alignItems: 'center', justifyContent: 'center', height: 180 },

  quickActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  actionBtn: {
    flex: 1,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
    elevation: 1,
  },
  actionText: { fontWeight: '700' },
  lightBtn: { backgroundColor: '#eef3ff' },
  lightText: { color: '#2d6cdf' },
  warnBtn: { backgroundColor: '#fff6eb' },
  warnText: { color: '#d35400' },

  hint: { marginTop: 12, color: '#6b7280', textAlign: 'center' },
});
