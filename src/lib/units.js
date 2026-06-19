// Small unit + formatting helpers.

export const cToF = (c) => (c == null ? null : (c * 9) / 5 + 32);
export const deltaCToF = (c) => (c == null ? null : c * 1.8); // temperature DIFFERENCE °C → °F
export const kmhToMph = (k) => (k == null ? null : k * 0.621371);
export const mToFt = (m) => (m == null ? null : m * 3.28084);
export const mmToIn = (mm) => (mm == null ? null : mm / 25.4);
export const cmToIn = (cm) => (cm == null ? null : cm / 2.54);

export function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(digits);
}

// Rounded feet with thousands separators, e.g. "18,500". Null-safe.
export function feet(m) {
  if (m == null) return null;
  return Math.round(m * 3.28084).toLocaleString();
}

// Temperature, dual unit, e.g. "72°F (22°C)".
export function tempBoth(c, digits = 0) {
  if (c == null) return '—';
  return `${fmt(cToF(c), digits)}°F (${fmt(c, digits)}°C)`;
}

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function windDir(deg) {
  if (deg == null) return '';
  return DIRS[Math.round(deg / 22.5) % 16];
}

// Format the hour from a naked location-local ISO string ("2026-06-19T14:00")
// without any timezone shifting. -> "2 PM"
export function wallHour(s) {
  const m = /T(\d{2}):/.exec(s || '');
  if (!m) return '';
  let hr = Number(m[1]);
  const ap = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${hr} ${ap}`;
}

export function localTime(iso, opts = { hour: 'numeric' }) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], opts);
  } catch {
    return '';
  }
}
