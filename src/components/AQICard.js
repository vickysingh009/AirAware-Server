// src/components/AQICard.js
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Button } from "react-native";
import { pm25ToAQI } from "../utils/aqi"; // Assuming aqi.js is correctly implemented for color/label

// Helper function to get color for the circles
function getCircleColor(label) {
  switch (label) {
    case "PM2.5":
      return "#ef4444"; // Red
    case "Ozone (O₃)":
      return "#f97316"; // Orange
    case "NO₂ (TEMPO)":
      return "#a855f7"; // Purple
    case "Temperature":
      return "#fbbf24"; // Yellow
    case "Humidity":
      return "#3b82f6"; // Blue
    case "Wind":
      return "#22c55e"; // Green
    default:
      return "#cccccc"; // Grey
  }
}

// New component for individual measurement cards
function MeasurementCard({ label, value, unit, color }) {
  return (
    <View style={measurementStyles.card}>
      <View style={[measurementStyles.circle, { backgroundColor: color }]} />

      <View style={measurementStyles.textContainer}>
        <Text style={measurementStyles.label}>{label}</Text>
        <Text style={measurementStyles.value}>
          {value} {unit}
        </Text>
      </View>
    </View>
  );
}

export default function AQICard({
  data,
  onPressForecast,
  onRefresh,
  onPressMap,
  loading,
  error,
  lastUpdated,
  hideSummary = false,
}) {
  if (loading) return null;
  if (error)
    return (
      <View style={styles.errorCard}>
        <Text style={{ color: "red", fontWeight: "700" }}>{error}</Text>

        <View style={{ marginTop: 8 }}>
          <Button title="Retry" onPress={onRefresh} />
        </View>
      </View>
    ); // Extract data

  const pm25Ground = data?.ground?.results?.[0]?.measurements?.find(
    (m) => m.parameter === "pm25"
  )?.value;
  const pm25Tempo = data?.tempo?.hourly?.[0]?.PM25;
  const no2Tempo = data?.tempo?.hourly?.[0]?.NO2;
  const o3Tempo = data?.tempo?.hourly?.[0]?.O3;
  const pm25 = pm25Tempo ?? pm25Ground; // Prioritize TEMPO PM2.5

  // --- CHANGE: Weather data is now sourced from the `tempo` object ---
  // NOTE: Please verify that `Temperature`, `Humidity`, and `Wind_Speed` are the correct
  // property names in your `data.tempo.hourly[0]` object from your API.
  const temperature = data?.tempo?.hourly?.[0]?.Temperature
    ? `${Math.round(data.tempo.hourly[0].Temperature)}`
    : "—";
  const humidity = data?.tempo?.hourly?.[0]?.Humidity
    ? `${data.tempo.hourly[0].Humidity}`
    : "—";
  // Assuming wind speed from tempo is also in m/s, converting to km/h. Adjust if the unit is different.
  const windSpeed = data?.tempo?.hourly?.[0]?.Wind_Speed
    ? `${Math.round(data.tempo.hourly[0].Wind_Speed * 3.6)}`
    : "—";

  return (
    <View style={styles.container}>
      {/* Grid for pollutant and weather cards */}
      <View style={styles.grid}>
        <MeasurementCard
          label="PM2.5"
          value={pm25 ?? "—"}
          unit="µg/m³"
          color={getCircleColor("PM2.5")}
        />

        <MeasurementCard
          label="Ozone (O₃)"
          value={o3Tempo ?? "—"}
          unit="ppb"
          color={getCircleColor("Ozone (O₃)")}
        />

        <MeasurementCard
          label="NO₂ (TEMPO)"
          value={no2Tempo ?? "—"}
          unit="ppb"
          color={getCircleColor("NO₂ (TEMPO)")}
        />

        <MeasurementCard
          label="Temperature"
          value={temperature}
          unit="°C"
          color={getCircleColor("Temperature")}
        />

        <MeasurementCard
          label="Humidity"
          value={humidity}
          unit="%"
          color={getCircleColor("Humidity")}
        />

        <MeasurementCard
          label="Wind"
          value={windSpeed}
          unit="km/h"
          color={getCircleColor("Wind")}
        />
      </View>

      {data?.healthAdvice ? (
        <View style={styles.healthAdviceCard}>
          <Text style={styles.healthAdviceTitle}>Health Advice</Text>

          <Text style={styles.healthAdviceText}>{data.healthAdvice}</Text>
        </View>
      ) : (
        <View style={styles.healthAdviceCard}>
          <Text style={styles.healthAdviceTitle}>Health Advice</Text>

          <Text style={styles.healthAdviceText}>
            Everyone should reduce prolonged or heavy exertion. Take breaks and
            limit outdoor activities.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  errorCard: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 12,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    alignItems: "center",
    justifyContent: "center",
    minHeight: 120,
    marginTop: 10,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  healthAdviceCard: {
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  healthAdviceTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#dc2626",
    marginBottom: 8,
  },
  healthAdviceText: {
    fontSize: 14,
    color: "#dc2626",
  },
});

const measurementStyles = StyleSheet.create({
  card: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    color: "#4b5563",
    marginBottom: 2,
  },
  value: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f2937",
  },
});
