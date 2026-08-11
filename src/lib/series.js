// Pull a trailing window of an Open-Meteo hourly series around "now".
//
// Shared by every stat card that carries a sparkline, so the window definition
// lives in exactly one place. `getGfs` requests `past_days=1`, which is what
// makes a real trailing 24 h possible — without it the series would start at
// local midnight and a "24-hour trend" would be six points at 06:00.

import { nearestHourIndex } from './diagnostics.js';

/**
 * @param gfsData raw getGfs() response
 * @param key     hourly variable name, e.g. 'temperature_2m'
 * @param hours   how many hours of history to include (default 24)
 * @param transform optional per-value mapper (e.g. unit conversion)
 * @returns { values, nowIndex } or null when there isn't enough to draw
 */
export function seriesAround(gfsData, key, hours = 24, transform = null) {
  const h = gfsData?.hourly;
  if (!h?.time?.length || !Array.isArray(h[key])) return null;
  const now = nearestHourIndex(h.time, gfsData.utc_offset_seconds);
  const start = Math.max(0, now - (hours - 1));
  let values = h[key].slice(start, now + 1);
  if (transform) values = values.map((v) => (v == null ? null : transform(v)));
  const usable = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  // Below four points a "trend" is noise, not information.
  if (usable.length < 4) return null;
  return { values, nowIndex: values.length - 1 };
}
