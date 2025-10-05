import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from './src/screens/HomeScreen';
import ForecastScreen from './src/screens/ForecastScreen';
import MapScreen from './src/screens/MapScreen'; // <--- add this

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Forecast"
          component={ForecastScreen}
          options={{ title: 'Forecast' }}
        />
        <Stack.Screen
          name="Map"
          component={MapScreen}
          options={{ title: 'Map View' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
