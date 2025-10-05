import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Alert,
  TextInput,
  FlatList,
  Keyboard,
} from 'react-native';
import * as Location from 'expo-location';
import axios from 'axios';

let MapView = null;
let Marker = null;
let Circle = null;
let PROVIDER_GOOGLE = null;
if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
  Circle = Maps.Circle;
  PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
}

// <-- set to your Tempo.js server (original server)
const SERVER = 'http://10.47.36.61:4000';

// radii (meters) for the concentric circles (inner, middle, outer)
const RADII = [10000, 30000, 50000]; // 10 km, 30 km, 50 km

export default function MapScreen({ route, navigation }) {
  const initial = route?.params?.loc ?? null;
  const [loc, setLoc] = useState(initial);
  const [selected, setSelected] = useState(initial);
  const [loading, setLoading] = useState(false);

  // circleInfos: array of { radius, pm25, aqi } for each concentric circle
  const [circleInfos, setCircleInfos] = useState([]);

  // Search states
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);

  const mapRef = useRef(null);

  useEffect(() => {
    (async () => {
      if (!loc) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        try {
          const l = await Location.getCurrentPositionAsync({});
          const coords = { latitude: l.coords.latitude, longitude: l.coords.longitude };
          setLoc(coords);
          setSelected(coords);
        } catch (e) {
          console.warn('Could not get device location:', e);
        }
      }
    })();
  }, []);

  // whenever selected changes, fetch concentric circle AQI info (always via original server)
  useEffect(() => {
    if (!selected) {
      setCircleInfos([]);
      return;
    }
    fetchConcentricCircleAQ(selected.latitude, selected.longitude);
  }, [selected]);

  // Debounced search
  useEffect(() => {
    if (!query || query.trim().length === 0) {
      setResults([]);
      setSearching(false);
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
      return;
    }

    setSearching(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      searchPlaces(query.trim());
    }, 600);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  async function searchPlaces(q) {
    try {
      const url = 'https://nominatim.openstreetmap.org/search';
      const resp = await axios.get(url, {
        params: {
          q,
          format: 'json',
          addressdetails: 1,
          limit: 6,
        },
        headers: {
          'User-Agent': 'AirAwareApp/1.0 (example@example.com)'
        },
        timeout: 10000,
      });

      if (Array.isArray(resp.data)) {
        const parsed = resp.data.map((r) => ({
          id: r.place_id || `${r.lat}-${r.lon}`,
          name: r.display_name,
          lat: Number(r.lat),
          lon: Number(r.lon),
          type: r.type,
        }));
        setResults(parsed);
      } else {
        setResults([]);
      }
    } catch (err) {
      console.warn('Search error:', err?.message ?? err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function onMapPress(evt) {
    const { latitude, longitude } = evt.nativeEvent.coordinate;
    setSelected({ latitude, longitude });
  }

  function onMarkerDragEnd(evt) {
    const { latitude, longitude } = evt.nativeEvent.coordinate;
    setSelected({ latitude, longitude });
  }

  async function useDeviceLocation() {
    try {
      setLoading(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Location permission is required to use device location.');
        setLoading(false);
        return;
      }
      const p = await Location.getCurrentPositionAsync({});
      const coords = { latitude: p.coords.latitude, longitude: p.coords.longitude };
      setSelected(coords);
      setLoc(coords);

      if (mapRef.current && mapRef.current.animateToRegion) {
        mapRef.current.animateToRegion({
          latitude: coords.latitude,
          longitude: coords.longitude,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        }, 500);
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Unable to get device location.');
    } finally {
      setLoading(false);
    }
  }

  // confirm location: fetch AQ for single point and navigate back
  async function confirmLocation() {
    if (!selected) {
      Alert.alert('Select location', 'Please tap the map to choose a location.');
      return;
    }

    setLoading(true);
    try {
      console.log(`MapScreen: confirmLocation -> calling SERVER for ${selected.latitude},${selected.longitude}`);
      const url = `${SERVER}/api/aq?lat=${selected.latitude}&lon=${selected.longitude}`;
      const resp = await axios.get(url, { timeout: 20000 });
      const aqData = resp.data;

      navigation.navigate('Home', { selectedLoc: selected, aqData });
    } catch (err) {
      console.error('Error fetching AQ for selected location:', err?.message ?? err);
      Alert.alert('Fetch error', 'Unable to fetch air quality for selected location. Returning selection only.');
      navigation.navigate('Home', { selectedLoc: selected });
    } finally {
      setLoading(false);
    }
  }

  function onSelectSearchResult(item) {
    Keyboard.dismiss?.();
    setQuery('');
    setResults([]);
    const coords = { latitude: item.lat, longitude: item.lon };
    setSelected(coords);
    setLoc(coords);

    if (mapRef.current && mapRef.current.animateToRegion) {
      mapRef.current.animateToRegion({
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.06,
        longitudeDelta: 0.06,
      }, 500);
    }
  }

  // ---------- GEO helpers ----------
  function destinationPoint(lat, lon, bearingDeg, distanceMeters) {
    const R = 6371e3; // earth radius meters
    const bearing = (bearingDeg * Math.PI) / 180.0;
    const φ1 = (lat * Math.PI) / 180;
    const λ1 = (lon * Math.PI) / 180;
    const δ = distanceMeters / R;

    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearing));
    const λ2 = λ1 + Math.atan2(
      Math.sin(bearing) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );

    return { latitude: (φ2 * 180 / Math.PI), longitude: (λ2 * 180 / Math.PI) };
  }

  // ---------- AQI conversion (PM2.5 -> AQI using EPA breakpoints) ----------
  const PM25_BREAKPOINTS = [
    { C_lo: 0.0, C_hi: 12.0, I_lo: 0, I_hi: 50 },
    { C_lo: 12.1, C_hi: 35.4, I_lo: 51, I_hi: 100 },
    { C_lo: 35.5, C_hi: 55.4, I_lo: 101, I_hi: 150 },
    { C_lo: 55.5, C_hi: 150.4, I_lo: 151, I_hi: 200 },
    { C_lo: 150.5, C_hi: 250.4, I_lo: 201, I_hi: 300 },
    { C_lo: 250.5, C_hi: 350.4, I_lo: 301, I_hi: 400 },
    { C_lo: 350.5, C_hi: 500.4, I_lo: 401, I_hi: 500 },
  ];

  function linearAqi(C, breakpoints) {
    if (C == null || Number.isNaN(C)) return null;
    for (const b of breakpoints) {
      if (C >= b.C_lo && C <= b.C_hi) {
        const aqi = (b.I_hi - b.I_lo) / (b.C_hi - b.C_lo) * (C - b.C_lo) + b.I_lo;
        return Math.round(aqi);
      }
    }
    if (C < breakpoints[0].C_lo) return breakpoints[0].I_lo;
    return breakpoints[breakpoints.length - 1].I_hi;
  }

  function pm25ToAqi(pm25) {
    return linearAqi(pm25, PM25_BREAKPOINTS);
  }

  function aqiToColor(aqi, alpha = 0.35) {
    if (aqi == null) return `rgba(107,114,128, ${alpha})`; // gray
    if (aqi <= 50) return `rgba(16,185,129, ${alpha})`;
    if (aqi <= 100) return `rgba(250,204,21, ${alpha})`;
    if (aqi <= 150) return `rgba(249,115,22, ${alpha})`;
    if (aqi <= 200) return `rgba(234,88,12, ${alpha})`;
    if (aqi <= 300) return `rgba(139,0,139, ${alpha})`;
    return `rgba(126,0,35, ${alpha})`;
  }

  /**
   * fetchConcentricCircleAQ:
   *  - For each radius in RADII we sample at 4 bearings (0,90,180,270) around the center.
   *  - We also fetch the center once.
   *  - For each radius we compute the average PM2.5 from the available samples.
   *  - Inner circle prefers the center sample (if available) otherwise uses the avg of inner radius samples.
   */
  async function fetchConcentricCircleAQ(lat, lon) {
    setLoading(true);
    setCircleInfos([]);
    try {
      const bearings = [0, 90, 180, 270]; // sample N,E,S,W
      const points = []; // array of { latitude, longitude, label, metaRadius (null for center) }

      // center point (label 'center')
      points.push({ latitude: lat, longitude: lon, label: 'center', metaRadius: 0 });

      // radius points
      for (const r of RADII) {
        for (const b of bearings) {
          const p = destinationPoint(lat, lon, b, r);
          points.push({ latitude: p.latitude, longitude: p.longitude, label: `r${r}_b${b}`, metaRadius: r });
        }
      }

      // Deduplicate points by lat/lon string to avoid duplicate requests
      const uniqueKey = (p) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;
      const uniqMap = new Map();
      for (const p of points) {
        const k = uniqueKey(p);
        if (!uniqMap.has(k)) uniqMap.set(k, p);
      }
      const uniquePoints = Array.from(uniqMap.values());

      console.log(`MapScreen: requesting ${uniquePoints.length} points from SERVER for concentric circles (center + ${RADII.length} radii × ${bearings.length} bearings).`);
      uniquePoints.forEach(p => console.log('  ->', `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`));

      // Fire all requests in parallel
      const promises = uniquePoints.map(pt => {
        const url = `${SERVER}/api/aq?lat=${pt.latitude}&lon=${pt.longitude}`;
        console.log('MapScreen: requesting', url);
        return axios.get(url, { timeout: 20000 })
          .then(resp => ({ success: true, pt, data: resp.data }))
          .catch(err => ({ success: false, pt, error: err }));
      });

      const results = await Promise.all(promises);

      // Map back by point key
      const respByKey = new Map();
      for (const r of results) {
        const k = `${r.pt.latitude.toFixed(6)},${r.pt.longitude.toFixed(6)}`;
        if (!r.success) {
          console.warn('Concentric fetch failed for', r.pt, r.error?.message ?? r.error);
          respByKey.set(k, null);
        } else {
          respByKey.set(k, r.data);
        }
      }

      // helper to extract PM2.5 from server response (try tempo.hourly[0].PM25, fallback to ground measurements)
      function extractPm25FromResp(resp) {
        if (!resp) return null;
        try {
          if (resp?.tempo?.hourly && Array.isArray(resp.tempo.hourly) && resp.tempo.hourly[0] && resp.tempo.hourly[0].PM25 != null) {
            return Number(resp.tempo.hourly[0].PM25);
          }
          if (resp?.ground?.results && Array.isArray(resp.ground.results) && resp.ground.results[0]?.measurements) {
            const m = resp.ground.results[0].measurements.find(x => x.parameter === 'pm25');
            if (m && m.value != null) return Number(m.value);
          }
          // sometimes OpenWeather fallback may put components elsewhere; try top-level weather components
          if (resp?.weather?.components && resp.weather.components.pm2_5 != null) {
            return Number(resp.weather.components.pm2_5);
          }
        } catch (e) {
          // ignore
        }
        return null;
      }

      // Build circleInfos
      const infos = [];

      // Determine center pm25
      const centerKey = `${lat.toFixed(6)},${lon.toFixed(6)}`;
      const centerResp = respByKey.get(centerKey) ?? null;
      const centerPm25 = extractPm25FromResp(centerResp);

      for (const r of RADII) {
        // collect sample keys for this radius
        const sampleKeys = [];
        for (const b of bearings) {
          const p = destinationPoint(lat, lon, b, r);
          sampleKeys.push(`${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`);
        }
        // gather pm25 samples
        const samples = [];
        for (const k of sampleKeys) {
          const resp = respByKey.get(k) ?? null;
          const pm = extractPm25FromResp(resp);
          if (pm != null && !Number.isNaN(pm)) samples.push(pm);
        }
        // compute average if any
        const avgPm25 = samples.length ? (samples.reduce((s, v) => s + v, 0) / samples.length) : null;

        // For the inner radius (first one), prefer center sample if available
        let pm25ForCircle = avgPm25;
        if (r === RADII[0]) {
          if (centerPm25 != null) pm25ForCircle = centerPm25;
          else pm25ForCircle = avgPm25;
        }

        const aqi = pm25ForCircle != null ? pm25ToAqi(pm25ForCircle) : null;
        infos.push({
          radius: r,
          pm25: pm25ForCircle,
          aqi,
        });
      }

      console.log('MapScreen: concentric circle infos:', infos.map(i => `${i.radius}m -> pm25:${i.pm25 ?? 'N/A'}, aqi:${i.aqi ?? 'N/A'}`).join(' | '));

      setCircleInfos(infos);
    } catch (err) {
      console.error('fetchConcentricCircleAQ error:', err);
      setCircleInfos([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      {/* Search bar (absolute at top) */}
      <View style={styles.searchContainer} pointerEvents="box-none">
        <View style={styles.searchBox}>
          <TextInput
            placeholder="Search place or address"
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            returnKeyType="search"
            onSubmitEditing={() => searchPlaces(query)}
            clearButtonMode="while-editing"
          />
          <TouchableOpacity
            style={styles.searchBtn}
            onPress={() => {
              if (query && query.trim().length) searchPlaces(query.trim());
            }}
          >
            <Text style={{ fontWeight: '700' }}>{searching ? '…' : 'Go'}</Text>
          </TouchableOpacity>
        </View>

        {results.length > 0 && (
          <View style={styles.resultsContainer}>
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={results}
              keyExtractor={(i) => String(i.id)}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.resultItem} onPress={() => onSelectSearchResult(item)}>
                  <Text numberOfLines={1} style={styles.resultTitle}>{item.name}</Text>
                  <Text style={styles.resultSub}>{item.type}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </View>

      {Platform.OS !== 'web' && MapView ? (
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          initialRegion={{
            latitude: loc?.latitude ?? 37.7749,
            longitude: loc?.longitude ?? -122.4194,
            latitudeDelta: 0.6,
            longitudeDelta: 0.6,
          }}
          onPress={onMapPress}
        >
          {selected && (
            <Marker
              coordinate={selected}
              draggable
              onDragEnd={onMarkerDragEnd}
              title="Selected location"
              description={`${selected.latitude.toFixed(5)}, ${selected.longitude.toFixed(5)}`}
            />
          )}

          {/* draw concentric circles centered on selected */}
          {Circle && selected && circleInfos.map((ci, idx) => {
            const color = aqiToColor(ci.aqi, 0.28);
            const stroke = aqiToColor(ci.aqi, 0.7);
            return (
              <Circle
                key={`circle-${ci.radius}`}
                center={{ latitude: selected.latitude, longitude: selected.longitude }}
                radius={ci.radius}
                strokeWidth={2}
                strokeColor={stroke}
                fillColor={color}
              />
            );
          })}
        </MapView>
      ) : (
        <View style={styles.center}>
          <Text>Map not available on web.</Text>
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.btn} onPress={useDeviceLocation} disabled={loading}>
          <Text style={styles.btnText}>{loading ? 'Locating…' : 'Use current location'}</Text>
        </TouchableOpacity>

        <View style={{ width: 12 }} />

        <TouchableOpacity style={[styles.btn, styles.confirmBtn]} onPress={confirmLocation} disabled={loading}>
          <Text style={[styles.btnText, { color: '#fff' }]}>{loading ? 'Fetching…' : 'Set Location'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.coordBox}>
        <Text style={{ fontSize: 12, color: '#374151' }}>
          Selected: {selected ? `${selected.latitude.toFixed(5)}, ${selected.longitude.toFixed(5)}` : '—'}
        </Text>
        <Text style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>
          Concentric circles: {RADII.map(r=>`${r/1000}km`).join(' , ')} — sampled from SERVER.
        </Text>
      </View>

      {/* small legend */}
      <View style={styles.legend}>
        <Text style={{ fontWeight: '700', marginBottom: 6 }}>AQI Legend</Text>
        <View style={styles.legendRow}>
          <View style={[styles.legendBox, { backgroundColor: aqiToColor(25, 0.9) }]} />
          <Text style={styles.legendLabel}>Good (0-50)</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendBox, { backgroundColor: aqiToColor(75, 0.9) }]} />
          <Text style={styles.legendLabel}>Moderate (51-100)</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendBox, { backgroundColor: aqiToColor(125, 0.9) }]} />
          <Text style={styles.legendLabel}>Unhealthy (101-150)</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendBox, { backgroundColor: aqiToColor(175, 0.9) }]} />
          <Text style={styles.legendLabel}>Unhealthy (151-200)</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendBox, { backgroundColor: aqiToColor(250, 0.9) }]} />
          <Text style={styles.legendLabel}>Very Unhealthy (201-300)</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendBox, { backgroundColor: aqiToColor(400, 0.9) }]} />
          <Text style={styles.legendLabel}>Hazardous (301+)</Text>
        </View>
      </View>

      {/* spinner while overlay fetching */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={{ color: '#fff', marginTop: 8 }}>Fetching AQ for concentric circles…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Search UI
  searchContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 40,
  },
  searchBox: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 3,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: 8,
  },
  searchBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resultsContainer: {
    maxHeight: 220,
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 3,
    paddingVertical: 6,
  },
  resultItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  resultTitle: { fontWeight: '700' },
  resultSub: { fontSize: 12, color: '#6b7280', marginTop: 4 },

  controls: {
    position: 'absolute',
    bottom: 16,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  btn: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    elevation: 3,
  },
  confirmBtn: {
    backgroundColor: '#2d6cdf',
  },
  btnText: {
    fontWeight: '700',
    color: '#0f172a',
  },
  coordBox: {
    position: 'absolute',
    bottom: 78,
    left: 14,
    right: 14,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    elevation: 2,
  },

  // Legend
  legend: {
    position: 'absolute',
    right: 12,
    top: 100,
    width: 160,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    elevation: 3,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  legendBox: { width: 18, height: 12, marginRight: 8, borderRadius: 2 },
  legendLabel: { fontSize: 12 },

  loadingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(17,24,39,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
});
