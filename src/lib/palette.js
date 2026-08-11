// Semantic color vocabularies — the OFFICIAL ones, reused exactly.
//
// Color here is a data channel, never a mood. Every value below is the
// published hex from the authority that defines the scale, because these
// vocabularies are already in the reader's eyes from every radar loop and AQI
// map they have ever seen. Substituting prettier hues would be a bug: it breaks
// the reader's existing calibration for no gain.
//
// CONTRAST RULE. These palettes were designed as FILLS ON WHITE MAPS, and
// several fail WCAG as colored text on a dark ground (EPA "Very Unhealthy"
// #8F3F97 is 2.6:1, "Hazardous" #7E0023 is 1.5:1, NWS warning red #E60000 is
// 3.4:1). So semantic color is only ever painted as a FILLED SWATCH, with the
// label color picked by `readableOn()` below. That keeps the official values
// byte-exact and still clears AA — every band lands between 4.8:1 and 18:1.
// Semantic color never becomes text on the page ground.

// --- WCAG helpers -----------------------------------------------------------
const srgb = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
export function luminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
export function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// Ink for a filled swatch: whichever of near-black / white reads better on it.
export const INK_ON_LIGHT = '#0B0E13';
export const INK_ON_DARK = '#FFFFFF';
export function readableOn(fill) {
  return contrast(INK_ON_DARK, fill) >= contrast(INK_ON_LIGHT, fill) ? INK_ON_DARK : INK_ON_LIGHT;
}

// Is this semantic color safe to paint AS TEXT on `bg`? Returns the color when
// it clears `min`, otherwise null so the caller falls back to plain ink.
//
// The swatch-only rule stands for chips and category badges. This is the one
// sanctioned exception — a large data numeral may carry its own ramp color —
// and it is gated per-value because the ramp is NOT uniformly safe: measured on
// --surface-1, the temperature ramp passes from about -11 C to +34 C but fails
// at both ends (-30 C is 1.28:1, +40 C is 2.89:1). Tinting unconditionally
// would make the most extreme temperatures the least legible ones on the page.
export function textSafeOn(fill, bg, min = 4.5) {
  if (!fill) return null;
  return contrast(fill, bg) >= min ? fill : null;
}

// --- EPA Air Quality Index (AirNow official category colors) ---------------
export const AQI_BANDS = [
  { max: 50, label: 'Good', fill: '#00E400' },
  { max: 100, label: 'Moderate', fill: '#FFFF00' },
  { max: 150, label: 'Unhealthy for Sensitive Groups', short: 'USG', fill: '#FF7E00' },
  { max: 200, label: 'Unhealthy', fill: '#FF0000' },
  { max: 300, label: 'Very Unhealthy', fill: '#8F3F97' },
  { max: Infinity, label: 'Hazardous', fill: '#7E0023' },
];
export function aqiBand(aqi) {
  if (aqi == null || Number.isNaN(aqi)) return { label: '—', fill: '#5A6B78', short: '—' };
  return AQI_BANDS.find((b) => aqi <= b.max) || AQI_BANDS[AQI_BANDS.length - 1];
}

// --- NWS alert severity ----------------------------------------------------
// Keyed to the CAP `severity` field the alerts API returns, using NWS's
// warning-red / watch-orange / advisory-yellow / statement-blue-gray convention.
export const ALERT_SEVERITY = {
  Extreme: { fill: '#B10026', label: 'Extreme' },
  Severe: { fill: '#E60000', label: 'Warning' },
  Moderate: { fill: '#FF8C00', label: 'Watch' },
  Minor: { fill: '#E5C100', label: 'Advisory' },
  Unknown: { fill: '#78909C', label: 'Statement' },
};
export const alertSeverity = (s) => ALERT_SEVERITY[s] || ALERT_SEVERITY.Unknown;

// --- NEXRAD base-reflectivity ramp (standard N0Q color table) --------------
// Used for precipitation intensity in the condition strip. Stops are the
// familiar green → yellow → orange → red → magenta escalation.
export const REFLECTIVITY_STOPS = [
  { dbz: 20, fill: '#02FD02' },
  { dbz: 25, fill: '#01C501' },
  { dbz: 30, fill: '#008E00' },
  { dbz: 35, fill: '#FDF802' },
  { dbz: 40, fill: '#E5BC00' },
  { dbz: 45, fill: '#FD9500' },
  { dbz: 50, fill: '#FD0000' },
  { dbz: 55, fill: '#D40000' },
  { dbz: 65, fill: '#F800FD' },
];

// Precipitation rate (mm/h) → reflectivity color, via the Marshall–Palmer
// Z–R relation (Z = 200 R^1.6, dBZ = 10 log10 Z). Below ~20 dBZ there is
// nothing worth painting, so the cell stays empty rather than faintly tinted.
export function precipFill(mmPerHour) {
  if (mmPerHour == null || mmPerHour <= 0.05) return null;
  const z = 200 * mmPerHour ** 1.6;
  const dbz = 10 * Math.log10(z);
  if (dbz < 18) return null;
  let out = REFLECTIVITY_STOPS[0].fill;
  for (const s of REFLECTIVITY_STOPS) if (dbz >= s.dbz) out = s.fill;
  return out;
}

// --- Temperature ramp -------------------------------------------------------
// Cold-blue → hot-red, anchored so 0 °C sits at a recognisable cyan. Used as a
// subtle TINT behind readouts and under the condition strip — never as a
// background flood, which would drown the reflectivity channel above it.
export const TEMP_STOPS = [
  { c: -30, fill: '#4B0F7A' },
  { c: -20, fill: '#2B4FA8' },
  { c: -10, fill: '#3E8FD0' },
  { c: 0, fill: '#64C4D9' },
  { c: 10, fill: '#59B36B' },
  { c: 20, fill: '#E3C03C' },
  { c: 30, fill: '#E8722C' },
  { c: 40, fill: '#C42B1C' },
];
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function tempFill(c) {
  if (c == null || Number.isNaN(c)) return null;
  if (c <= TEMP_STOPS[0].c) return TEMP_STOPS[0].fill;
  const last = TEMP_STOPS[TEMP_STOPS.length - 1];
  if (c >= last.c) return last.fill;
  for (let i = 0; i < TEMP_STOPS.length - 1; i++) {
    const a = TEMP_STOPS[i];
    const b = TEMP_STOPS[i + 1];
    if (c >= a.c && c <= b.c) {
      const t = (c - a.c) / (b.c - a.c);
      const [r1, g1, b1] = hex2rgb(a.fill);
      const [r2, g2, b2] = hex2rgb(b.fill);
      return rgb2hex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
    }
  }
  return null;
}

// --- Significance tiers (diagnostic threshold chips) -----------------------
// Shared by every chip in Diagnostics. Paired with the band NAME in text, so
// the meaning never depends on hue alone.
export const TIER_FILL = {
  nil: '#5A6B78',
  low: '#3FA96B',
  moderate: '#E5A93C',
  high: '#E0522F',
  extreme: '#C2379B',
};
export const tierFill = (tier) => TIER_FILL[tier] || TIER_FILL.nil;
