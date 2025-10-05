# Aggregator server
Simple Node/Express server that fetches OpenAQ and (optionally) OpenWeather and returns a merged response together with a small TEMPO mock.
Usage:
  cd server
  npm install
  OW_API_KEY=your_key npm start   # to include OpenWeather data
  npm start                      # to run without OpenWeather
Note: If running the Expo app on Android emulator, use 10.0.2.2 for host; for physical device use your machine IP.
