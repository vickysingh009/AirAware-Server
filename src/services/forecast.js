export function simpleForecast({groundVals = [0], satVals = [0], weather = {}}) {
  const avgGround = (groundVals.length>0) ? (groundVals.reduce((a,b)=>a+b,0)/groundVals.length) : 0;
  const avgSat = (satVals.length>0) ? (satVals.reduce((a,b)=>a+b,0)/satVals.length) : 0;
  const wind = weather.wind_speed || (weather.wind && weather.wind.speed) || 0;
  const windFactor = Math.max(0, 1 - wind / 10);
  const rainFactor = (weather.rain && (weather.rain['1h'] || weather.rain['3h'])) ? 0.7 : 1.0;
  const w_g = 0.6, w_s = 0.4;
  const raw = (w_g * avgGround + w_s * avgSat) * windFactor * rainFactor;
  return raw;
}
