export function pm25ToAQI(c) {
  if (c === null || c === undefined) return null;
  const breakpoints = [
    { c_lo: 0.0,  c_hi: 12.0,  i_lo: 0,   i_hi: 50 },
    { c_lo: 12.1, c_hi: 35.4,  i_lo: 51,  i_hi: 100 },
    { c_lo: 35.5, c_hi: 55.4,  i_lo: 101, i_hi: 150 },
    { c_lo: 55.5, c_hi: 150.4, i_lo: 151, i_hi: 200 },
    { c_lo: 150.5,c_hi: 250.4, i_lo: 201, i_hi: 300 },
    { c_lo: 250.5,c_hi: 350.4, i_lo: 301, i_hi: 400 },
    { c_lo: 350.5,c_hi: 500.4, i_lo: 401, i_hi: 500 }
  ];
  const cp = parseFloat(c);
  for (let bp of breakpoints) {
    if (cp >= bp.c_lo && cp <= bp.c_hi) {
      const aqi = ((bp.i_hi - bp.i_lo)/(bp.c_hi - bp.c_lo))*(cp - bp.c_lo) + bp.i_lo;
      return Math.round(aqi);
    }
  }
  return null;
}
