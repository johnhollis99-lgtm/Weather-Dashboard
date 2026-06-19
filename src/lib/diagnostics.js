// Diagnostic-parameter extraction + derived computations.
//
// Two raw sources feed this:
//   - NWS forecastGridData (mixing height, transport wind, Haines, etc.)
//   - Open-Meteo GFS (CAPE/CIN/LI/PWAT/BL height/freezing level + level data)
// and we compute lapse rates, dewpoint depression, ventilation rate, PWAT(in).

// ---- NWS gridData helpers -------------------------------------------------

// Pick the gridData value valid for "now" (or nearest). validTime is an
// ISO8601 interval "START/DURATION". Returns { value, uom } or null.
export function pickGridValue(gridData, key, now = Date.now()) {
  const field = gridData?.[key];
  if (!field || !Array.isArray(field.values) || field.values.length === 0) {
    return null;
  }
  let chosen = null;
  let bestDelta = Infinity;
  for (const v of field.values) {
    const [startStr] = String(v.validTime).split('/');
    const start = Date.parse(startStr);
    if (Number.isNaN(start)) continue;
    // Prefer the interval that currently contains "now"; otherwise nearest start.
    const delta = Math.abs(start - now);
    if (start <= now && delta < bestDelta) {
      bestDelta = delta;
      chosen = v;
    }
  }
  if (!chosen) {
    // Fall back to the earliest future value.
    for (const v of field.values) {
      const start = Date.parse(String(v.validTime).split('/')[0]);
      if (Number.isNaN(start)) continue;
      const delta = Math.abs(start - now);
      if (delta < bestDelta) {
        bestDelta = delta;
        chosen = v;
      }
    }
  }
  if (!chosen) return null;
  return { value: chosen.value, uom: cleanUom(field.uom) };
}

function cleanUom(uom) {
  if (!uom) return '';
  const u = uom.replace('wmoUnit:', '').replace('uc:', '');
  const map = {
    m: 'm',
    'km_h-1': 'km/h',
    degC: '°C',
    degF: '°F',
    percent: '%',
    1: '',
    Pa: 'Pa',
    'm_s-1': 'm/s',
  };
  return map[u] ?? u;
}

// ---- Open-Meteo GFS helpers ----------------------------------------------

export function nearestHourIndex(times, utcOffsetSeconds, now = Date.now()) {
  // Times are location-local wall clock. Compare both in a single fake-UTC frame.
  const target = now + (utcOffsetSeconds || 0) * 1000;
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i] + 'Z');
    const d = Math.abs(t - target);
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  return idx;
}

// ---- Master assembly ------------------------------------------------------

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function computeDiagnostics(gridData, gfs) {
  const out = { nws: {}, gfs: {}, derived: {} };

  // ----- NWS gridpoint side -----
  if (gridData) {
    out.nws.mixingHeight = pickGridValue(gridData, 'mixingHeight');
    out.nws.transportWindSpeed = pickGridValue(gridData, 'transportWindSpeed');
    out.nws.transportWindDirection = pickGridValue(gridData, 'transportWindDirection');
    out.nws.hainesIndex = pickGridValue(gridData, 'hainesIndex');
    out.nws.probabilityOfThunder = pickGridValue(gridData, 'probabilityOfThunder');
    out.nws.wetBulbGlobeTemperature = pickGridValue(gridData, 'wetBulbGlobeTemperature');
    out.nws.dispersionIndex = pickGridValue(gridData, 'dispersionIndex');
    out.nws.probabilityOfPrecipitation = pickGridValue(gridData, 'probabilityOfPrecipitation');
    out.nws.windSpeed = pickGridValue(gridData, 'windSpeed');
    out.nws.windGust = pickGridValue(gridData, 'windGust');
    out.nws.windDirection = pickGridValue(gridData, 'windDirection');
    out.nws.snowfallAmount = pickGridValue(gridData, 'snowfallAmount');
    out.nws.snowLevel = pickGridValue(gridData, 'snowLevel');
    out.nws.relativeHumidity = pickGridValue(gridData, 'relativeHumidity');
  }

  // ----- Open-Meteo GFS side -----
  if (gfs?.hourly?.time?.length) {
    const h = gfs.hourly;
    const i = nearestHourIndex(h.time, gfs.utc_offset_seconds);
    const at = (k) => num(h[k]?.[i]);
    out.gfs = {
      validTime: h.time[i],
      cape: at('cape'),
      cin: at('convective_inhibition'),
      liftedIndex: at('lifted_index'),
      pwatMm: at('total_column_integrated_water_vapour'), // PWAT (mm)
      blHeight: at('boundary_layer_height'),
      freezingLevel: at('freezing_level_height'),
      snowfall: at('snowfall'), // cm (this hour)
      snowDepth: at('snow_depth'), // m
      windSpeed10m: at('wind_speed_10m'), // km/h
      windGusts10m: at('wind_gusts_10m'), // km/h
      windDir10m: at('wind_direction_10m'),
      windSpeed500: at('wind_speed_500hPa'), // km/h
      windDir500: at('wind_direction_500hPa'),
      t2m: at('temperature_2m'),
      td2m: at('dewpoint_2m'),
      rh: at('relative_humidity_2m'),
      t850: at('temperature_850hPa'),
      t700: at('temperature_700hPa'),
      t500: at('temperature_500hPa'),
      z850: at('geopotential_height_850hPa'),
      z700: at('geopotential_height_700hPa'),
      z500: at('geopotential_height_500hPa'),
      elevation: gfs.elevation, // model ground elevation (m)
    };
  }

  // ----- Derived -----
  const g = out.gfs;
  const d = out.derived;

  if (g.t850 != null && g.t700 != null && g.z850 != null && g.z700 != null) {
    const dz = (g.z700 - g.z850) / 1000; // km
    d.lapse850_700 = dz > 0 ? (g.t850 - g.t700) / dz : null; // °C/km
  }
  if (g.t700 != null && g.t500 != null && g.z700 != null && g.z500 != null) {
    const dz = (g.z500 - g.z700) / 1000;
    d.lapse700_500 = dz > 0 ? (g.t700 - g.t500) / dz : null;
  }
  if (g.t2m != null && g.td2m != null) {
    d.dewpointDepression = g.t2m - g.td2m; // °C
  }
  if (g.pwatMm != null) {
    d.pwatIn = g.pwatMm / 25.4;
  }

  // Ventilation rate = mixing height (m) × transport wind (m/s)  →  m²/s
  const mh = out.nws.mixingHeight?.value;
  const twsRaw = out.nws.transportWindSpeed?.value;
  const twsUom = out.nws.transportWindSpeed?.uom;
  if (num(mh) != null && num(twsRaw) != null) {
    const twsMs = twsUom === 'km/h' ? twsRaw / 3.6 : twsRaw; // assume km/h default
    d.ventilationRate = mh * twsMs; // m²/s
    d.ventilationMixingHeight = mh;
    d.ventilationTransportWindMs = twsMs;
  }

  return out;
}

// Max value of an NWS gridData field over the window [now, now+hours].
function maxGridValue(gridData, key, now, hours) {
  const f = gridData?.[key];
  if (!f || !Array.isArray(f.values)) return null;
  const end = now + hours * 3600 * 1000;
  let m = null;
  for (const v of f.values) {
    const start = Date.parse(String(v.validTime).split('/')[0]);
    if (Number.isNaN(start)) continue;
    if (start >= now - 3600 * 1000 && start <= end && typeof v.value === 'number') {
      m = m == null ? v.value : Math.max(m, v.value);
    }
  }
  return m;
}

// Aggregate the next ~18 hours from Open-Meteo GFS + NWS gridData. Feeds the
// derived hazard assessment and the briefing.
export function summarize18h(gfs, gridData, now = Date.now()) {
  const out = { hours: 0 };
  if (gfs?.hourly?.time?.length) {
    const h = gfs.hourly;
    const i0 = nearestHourIndex(h.time, gfs.utc_offset_seconds, now);
    const i1 = Math.min(h.time.length, i0 + 18);
    const slice = (k) => (h[k] || []).slice(i0, i1).filter((v) => typeof v === 'number');
    const max = (a) => (a.length ? Math.max(...a) : null);
    const min = (a) => (a.length ? Math.min(...a) : null);
    const sum = (a) => (a.length ? a.reduce((x, y) => x + y, 0) : null);
    out.hours = i1 - i0;
    out.startTime = h.time[i0];
    out.endTime = h.time[i1 - 1];
    out.maxGustKmh = max(slice('wind_gusts_10m'));
    out.maxWindKmh = max(slice('wind_speed_10m'));
    out.maxCape = max(slice('cape'));
    out.minCinMag = (() => {
      const a = slice('convective_inhibition').map((v) => Math.abs(v));
      return a.length ? Math.min(...a) : null;
    })();
    out.totalSnowCm = sum(slice('snowfall'));
    out.totalPrecipMm = sum(slice('precipitation'));
    out.minRH = min(slice('relative_humidity_2m'));
    out.maxRH = max(slice('relative_humidity_2m'));
    out.minFreezingLevelM = min(slice('freezing_level_height'));
    out.maxFreezingLevelM = max(slice('freezing_level_height'));
  }
  if (gridData) {
    out.maxPoP = maxGridValue(gridData, 'probabilityOfPrecipitation', now, 18);
    out.maxPoT = maxGridValue(gridData, 'probabilityOfThunder', now, 18);
  }
  return out;
}
