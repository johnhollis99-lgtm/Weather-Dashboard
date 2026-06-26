// Small unit + formatting helpers.

export const cToF = (c) => (c == null ? null : (c * 9) / 5 + 32);
export const fToC = (f) => (f == null ? null : ((f - 32) * 5) / 9);
export const deltaCToF = (c) => (c == null ? null : c * 1.8); // temperature DIFFERENCE °C → °F
export const kmhToMph = (k) => (k == null ? null : k * 0.621371);
export const kmhToMs = (k) => (k == null ? null : k / 3.6);
export const msToKt = (ms) => (ms == null ? null : ms * 1.94384);
export const msToMph = (ms) => (ms == null ? null : ms * 2.236936);
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

// ── Per-quantity display registry ─────────────────────────────────────────────
// Policy: ALL physics is computed in SI upstream (°C, m, hPa, J/kg, m/s, mm).
// This registry is DISPLAY-ONLY — switching `system` ('imperial' | 'metric')
// changes formatting, never recomputes. Each quantity declares, per system, how
// to convert the SI value and how to round/label it.
//
//   `round`  — snap to this step before formatting (e.g. 100 ft, 10 J/kg)
//   `digits` — decimal places after rounding
//   `suffix` — unit label, joined to the number with a space ("5,000 ft", "72 °F")
export const SYSTEMS = ['imperial', 'metric'];
export const DEFAULT_SYSTEM = 'imperial';

const id = (x) => x;

const REGISTRY = {
  // Temperature / dewpoint: internal °C. Whole degrees, no space (32°F / 0°C).
  temperature: {
    imperial: { to: cToF, digits: 0, suffix: '°F' },
    metric: { to: id, digits: 0, suffix: '°C' },
  },
  // A temperature DIFFERENCE (e.g. dewpoint depression): scales by 9/5, no +32.
  tempDelta: {
    imperial: { to: deltaCToF, digits: 1, suffix: '°F' },
    metric: { to: id, digits: 1, suffix: '°C' },
  },
  // Heights (LCL/LFC/EL, mixing/BL/freezing, geopotential): internal m.
  // Imperial → ft to nearest 100; metric → m to nearest 10.
  height: {
    imperial: { to: mToFt, round: 100, digits: 0, suffix: 'ft' },
    metric: { to: id, round: 10, digits: 0, suffix: 'm' },
  },
  // Same height, expressed in thousands for an axis label (1 decimal).
  heightKft: {
    imperial: { to: (m) => mToFt(m) / 1000, digits: 1, suffix: 'kft' },
    metric: { to: (m) => m / 1000, digits: 1, suffix: 'km' },
  },
  // Lapse rate: internal °C/km. Imperial → °F per 1000 ft.
  lapseRate: {
    imperial: { to: (r) => (r * 9) / 5 / 3.28084, digits: 1, suffix: '°F/1000 ft' },
    metric: { to: id, digits: 1, suffix: '°C/km' },
  },
  // Precipitable water: internal mm. Imperial → inches (2 dp); metric mm (1 dp).
  pwat: {
    imperial: { to: mmToIn, digits: 2, suffix: 'in' },
    metric: { to: id, digits: 1, suffix: 'mm' },
  },
  // Sounding shear (and other upper-air winds quoted in knots by convention):
  // internal m/s. Imperial → kt (whole); metric → m/s (1 dp).
  wind: {
    imperial: { to: msToKt, digits: 0, suffix: 'kt' },
    metric: { to: id, digits: 1, suffix: 'm/s' },
  },
  // Surface / transport wind: internal m/s. Imperial → mph (whole) to match the
  // rest of the surface UI; metric → m/s (1 dp). Knots stay reserved for shear.
  windSurface: {
    imperial: { to: msToMph, digits: 0, suffix: 'mph' },
    metric: { to: id, digits: 1, suffix: 'm/s' },
  },
  // ── Identical in both systems (meteorological convention) ──
  // Pressure: hPa (== mb), never converted.
  pressure: {
    imperial: { to: id, digits: 0, suffix: 'hPa' },
    metric: { to: id, digits: 0, suffix: 'hPa' },
  },
  // CAPE / CIN: J/kg to nearest 10, identical in both systems.
  cape: {
    imperial: { to: id, round: 10, digits: 0, suffix: 'J/kg' },
    metric: { to: id, round: 10, digits: 0, suffix: 'J/kg' },
  },
  cin: {
    imperial: { to: id, round: 10, digits: 0, suffix: 'J/kg' },
    metric: { to: id, round: 10, digits: 0, suffix: 'J/kg' },
  },
  // Lifted / Showalter index: as-is (°C-based but shown as a bare number, 1 dp).
  index: {
    imperial: { to: id, digits: 1, suffix: '' },
    metric: { to: id, digits: 1, suffix: '' },
  },
};

function formatNumber(value, { round = null, digits = 0 }) {
  let v = value;
  if (round) v = Math.round(v / round) * round;
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Format an SI value for display, returning the pieces so the UI can style the
// unit separately. Null-safe → { num: '—', unit: '', text: '—' }.
export function displayParts(quantityKey, siValue, system = DEFAULT_SYSTEM) {
  const quantity = REGISTRY[quantityKey];
  if (!quantity) throw new Error(`Unknown quantity key: ${quantityKey}`);
  const rule = quantity[system] || quantity[DEFAULT_SYSTEM];
  if (siValue == null || Number.isNaN(siValue)) return { num: '—', unit: '', text: '—' };
  const num = formatNumber(rule.to(siValue), rule);
  const unit = rule.suffix || 