// Open-Meteo family of APIs. All send permissive CORS headers → browser-direct.

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} for ${url}`);
  const json = await res.json();
  if (json.error) throw new Error(json.reason || 'Open-Meteo error');
  return json;
}

// GFS model output — the convective / thermodynamic diagnostics source.
export async function getGfs(lat, lon) {
  const hourly = [
    'temperature_2m',
    'dewpoint_2m',
    'relative_humidity_2m',
    'cape',
    'convective_inhibition',
    'lifted_index',
    'total_column_integrated_water_vapour', // PWAT (kg/m² = mm); Open-Meteo's current name
    'boundary_layer_height',
    'freezing_level_height',
    'surface_pressure', // model pressure history for the stat-card sparkline

    'snowfall',
    'snow_depth',
    'precipitation',
    'wind_speed_10m',
    'wind_gusts_10m',
    'wind_direction_10m',
    'wind_speed_500hPa',
    'wind_direction_500hPa',
    'temperature_850hPa',
    'temperature_700hPa',
    'temperature_500hPa',
    'geopotential_height_850hPa',
    'geopotential_height_700hPa',
    'geopotential_height_500hPa',
  ].join(',');
  // `past_days=1` guarantees a real trailing 24 h for the stat-card sparklines.
  // Without it the series starts at local midnight, so at 06:00 a "24-hour
  // trend" would be six points. Index-safe: every consumer locates "now" via
  // nearestHourIndex() against the timestamps, never a fixed offset.
  const url =
    `https://api.open-meteo.com/v1/gfs?latitude=${lat}&longitude=${lon}` +
    `&hourly=${hourly}&forecast_days=3&past_days=1&timezone=auto`;
  return getJSON(url);
}

export async function getAirQuality(lat, lon) {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&hourly=us_aqi,pm2_5,pm10,ozone&forecast_days=2&timezone=auto`;
  return getJSON(url);
}

// Ensemble (gfs_seamless) — many members of temperature + precip. We use the
// daily precip member spread as a forecast-confidence indicator.
export async function getEnsemble(lat, lon) {
  const url =
    `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,precipitation&models=gfs_seamless&forecast_days=4&timezone=auto`;
  return getJSON(url);
}
