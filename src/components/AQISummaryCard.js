// src/components/AQISummaryCard.js
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { pm25ToAQI } from "../utils/aqi";
import { Feather } from "@expo/vector-icons"; // Make sure you have @expo/vector-icons installed

export default function AQISummaryCard({ data, loc, lastUpdated }) {
  // `onPressDetails` is no longer used in this UI
  // --- EXISTING LOGIC (INTACT) ---
  const pm25Tempo = data?.tempo?.hourly?.[0]?.PM25;
  const pm25Ground = data?.ground?.results?.[0]?.measurements?.find(
    (m) => m.parameter === "pm25"
  )?.value;
  const pm25 = pm25Tempo ?? pm25Ground ?? null;

  const aqi = pm25 ? pm25ToAQI(pm25) : null;
  const { label, color, lightBg } = summaryStyleForAQI(aqi);

  const tempoName = data?.tempo?.site?.name;
  const weatherName = data?.weather?.name;
  const openAQCity = data?.ground?.results?.[0]?.city;
  const openAQLocation = data?.ground?.results?.[0]?.location;
  const coordsFromProp =
    loc && loc.latitude && loc.longitude
      ? `${Number(loc.latitude).toFixed(4)}, ${Number(loc.longitude).toFixed(
          4
        )}`
      : null;

  const locationLabel =
    tempoName ||
    weatherName ||
    openAQCity ||
    openAQLocation ||
    coordsFromProp ||
    "Unknown location";

  // --- NEW UI RENDER ---
  return (
    <View style={styles.container}>
      {/* High AQI Alert Banner (conditionally shown) */}
      {aqi > 100 && (
        <View
          style={[
            styles.alertBanner,
            { backgroundColor: lightBg, borderColor: color },
          ]}
        >
          <Feather name="bell" size={18} color={color} />
          <View style={styles.alertTextContainer}>
            <Text style={[styles.alertTitle, { color: color }]}>
              High AQI Alert!
            </Text>
            <Text style={[styles.alertSubtitle, { color: color }]}>
              {shortAdvice(aqi)}
            </Text>
          </View>
        </View>
      )}
      {/* AQI Circle Display */}
      <View
        style={[
          styles.aqiCircle,
          { borderColor: color, backgroundColor: lightBg },
        ]}
      >
        <Text style={[styles.aqiCircleLabel, { color: color }]}>AQI</Text>
        <Text style={[styles.aqiCircleValue, { color: color }]}>
          {aqi ?? "—"}
        </Text>
        <Text style={[styles.aqiCircleLabel, { color: color }]}>{label}</Text>
      </View>
      {/* Location Display */}
      <View style={styles.locationContainer}>
        <Feather name="map-pin" size={16} color="#6b7280" />
        <Text style={styles.locationText}>{locationLabel}</Text>
      </View>
      {/* Last Updated Timestamp */}
      {lastUpdated && (
        <Text style={styles.timestampText}>
          Updated: {lastUpdated.toLocaleTimeString()}
        </Text>
      )}
    </View>
  );
}

// --- HELPER FUNCTIONS (LOGIC INTACT, STYLES UPDATED) ---

function shortAdvice(aqi) {
  if (aqi == null) return "No data available.";
  if (aqi <= 50) return "Enjoy your day!";
  if (aqi <= 100) return "Air quality is acceptable for most individuals.";
  if (aqi <= 150)
    return "Members of sensitive groups may experience health effects.";
  if (aqi <= 200)
    return "Air quality is currently unhealthy. Limit outdoor exposure.";
  if (aqi <= 300)
    return "Health alert: everyone may experience more serious health effects.";
  return "Hazardous conditions. Remain indoors and keep activity levels low.";
}

// Updated to provide colors that match the new design system
function summaryStyleForAQI(aqi) {
  if (aqi == null) return { label: "N/A", color: "#333", lightBg: "#eef2f5" };
  if (aqi <= 50) return { label: "Good", color: "#2e8b57", lightBg: "#e6f9ec" };
  if (aqi <= 100)
    return { label: "Moderate", color: "#af8d00", lightBg: "#fff7e0" };
  if (aqi <= 150)
    return { label: "Unhealthy-Sens", color: "#d35400", lightBg: "#fff1e6" };
  if (aqi <= 200)
    return { label: "Unhealthy", color: "#c0392b", lightBg: "#fdecea" };
  if (aqi <= 300)
    return { label: "Very Unhealthy", color: "#7d3c98", lightBg: "#f3e8ff" };
  return { label: "Hazardous", color: "#6a0dad", lightBg: "#fbeff8" };
}

// --- NEW STYLESHEET ---
const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    padding: 16,
  },
  alertBanner: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  alertTextContainer: {
    marginLeft: 10,
    flex: 1,
  },
  alertTitle: {
    fontWeight: "700",
    fontSize: 15,
  },
  alertSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  aqiCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    elevation: 8, // Add shadow for Android
    shadowColor: "#000", // Add shadow for iOS
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  aqiCircleLabel: {
    fontSize: 16,
    fontWeight: "600",
    opacity: 0.9,
  },
  aqiCircleValue: {
    fontSize: 72,
    fontWeight: "800",
    marginVertical: 4,
  },
  locationContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  locationText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#374151",
    marginLeft: 8,
  },
  timestampText: {
    fontSize: 12,
    color: "#9ca3af",
  },
});
