// Build a numeric vertical profile (SoundingLevel[]) from Open-Meteo GFS
// pressure-level output. Keyless, CORS-OK, browser-direct (like the rest of the
// Open-Meteo family). Dewpoint is derived from temperature + RH; winds are
// requested in knots. Returned surface-first (pressure descending), with any
// below-ground levels (p > surface pressure) dropped.

import { saturationVaporPressure, dewpointFromVaporPressure } from '../lib/soundingMath.js';
import { nearestHourIndex } from '../lib/diagnostics.js';

const LEVELS = [
  1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150,
];

export async function getSoundingProfile(lat, lon) {
  const vars = [];
  for (const L of LEVELS) {
    vars.push(
      `temperature_${L}hPa`,
      `relative_humidity_${L}hPa`,
      `geopotential_height_${L}hPa`,
      `wind_speed_${L}hPa`,
      `wind_direction_${L}hPa`,
    );
  }
  vars.push(
    'surface_pressure',
    'temperature_2m',
    'dewpoint_2m',
    'relative_humidity_2m',
    'wind_speed_10m',
    'wind_direction_10m',
  );

  const url =
    `https://api.open-meteo.com/v1/gfs?latitude=${lat}&longitude=${lon}` +
    `&hourly=${vars.join(',')}&forecast_days=1&timezone=auto&wind_speed_unit=kn`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.reason || 'Open-Meteo error');
  const h = j.hourly;
  if (!h?.time?.length) throw new Error('no hourly data');

  const i = nearestHourIndex(h.time, j.utc_offset_seconds);
  const at = (k) => {
    const v = h[k]?.[i];
    return typeof v === 'number' ? v : null;
  };

  const sp = at('surface_pressure'); // hPa
  const elev = typeof j.elevation === 'number' ? j.elevation : 0; // m MSL
  const levels = [];

  // Surface level from 2 m / 10 m fields. Derive dewpoint from RH if the
  // dedicated dewpoint field is missing, so the true surface level is never
  // dropped (which would silently shift the parcel origin aloft).
  const t2 = at('temperature_2m');
  let td2 = at('dewpoint_2m');
  if (td2 == null && t2 != null) {
    const rh2 = at('relative_humidity_2m');
    if (rh2 != null) {
      td2 = dewpointFromVaporPressure((saturationVaporPressure(t2) * Math.max(1, Math.min(100, rh2))) / 100);
    }
  }
  if (sp != null && t2 != null && td2 != null) {
    levels.push({
      pressure: sp,
      height: elev,
      temp: t2,
      dewpoint: td2,
      windDir: at('wind_direction_10m'),
      windSpeed: at('wind_speed_10m'),
    });
  }

  for (const L of LEVELS) {
    if (sp != null && L > sp + 0.5) continue; // below ground
    const t = at(`temperature_${L}hPa`);
    const rh = at(`relative_humidity_${L}hPa`);
    const z = at(`geopotential_height_${L}hPa`);
    if (t == null || rh == null || z == null) continue;
    const e = (saturationVaporPressure(t) * Math.max(1, Math.min(100, rh))) / 100;
    levels.push({
      pressure: L,
      height: z,
      temp: t,
      dewpoint: dewpointFromVaporPressure(e),
      windDir: at(`wind_direction_${L}hPa`),
      windSpeed: at(`wind_speed_${L}hPa`),
    });
  }

  // Surface-first, strictly decreasing pressure (dedupe near-equal levels).
  levels.sort((a, b) => b.pressure - a.pressure);
  const profile = [];
  for (const lv of levels) {
    if (!profile.length || lv.pressure < profile[profile.length - 1].pressure - 0.5) profile.push(lv);
  }
  if (profile.length < 6) throw new Error('insufficient pressure levels');
  return { profile, validTime: h.time[i], elevation: elev };
}
