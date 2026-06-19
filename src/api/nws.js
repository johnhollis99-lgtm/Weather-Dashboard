// National Weather Service (api.weather.gov).
//
// NWS sends permissive CORS headers, so we fetch directly from the browser.
// NWS asks for a descriptive User-Agent; browsers send their own UA string
// automatically (and forbid overriding it from fetch), which satisfies the API.
// We additionally send an Accept header for the GeoJSON ld+json variant.

const NWS_BASE = 'https://api.weather.gov';
const HEADERS = { Accept: 'application/geo+json' };

async function getJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`NWS ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

// /points/{lat},{lon} — the entry point. Returns forecast URLs + grid metadata.
export async function getPoints(lat, lon) {
  const url = `${NWS_BASE}/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
  const json = await getJSON(url);
  const p = json.properties;
  return {
    forecast: p.forecast,
    forecastHourly: p.forecastHourly,
    forecastGridData: p.forecastGridData,
    observationStations: p.observationStations,
    gridId: p.gridId,
    gridX: p.gridX,
    gridY: p.gridY,
    timeZone: p.timeZone,
    city: p.relativeLocation?.properties?.city,
    state: p.relativeLocation?.properties?.state,
  };
}

export async function getForecast(url) {
  const json = await getJSON(url);
  return json.properties.periods;
}

export async function getHourly(url) {
  const json = await getJSON(url);
  return json.properties.periods;
}

// Raw gridpoint data (forecastGridData) — the source for the NWS-side
// diagnostics (mixing height, transport wind, Haines, etc.).
export async function getGridData(url) {
  const json = await getJSON(url);
  return json.properties;
}

// Nearest station's latest observation = ACTUAL observed temp/dewpoint.
export async function getLatestObservation(observationStationsUrl) {
  const stations = await getJSON(observationStationsUrl);
  const first = stations.features?.[0];
  if (!first) throw new Error('No observation stations returned');
  const stationId = first.properties.stationIdentifier;
  const obsUrl = `${NWS_BASE}/stations/${stationId}/observations/latest`;
  const json = await getJSON(obsUrl);
  const o = json.properties;
  return {
    station: stationId,
    stationName: first.properties.name,
    timestamp: o.timestamp,
    temperatureC: o.temperature?.value,
    dewpointC: o.dewpoint?.value,
    humidity: o.relativeHumidity?.value,
    windSpeedKmh: o.windSpeed?.value,
    windDir: o.windDirection?.value,
    textDescription: o.textDescription,
  };
}

export async function getActiveAlerts(lat, lon) {
  const url = `${NWS_BASE}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
  const json = await getJSON(url);
  return (json.features || []).map((f) => ({
    id: f.id,
    event: f.properties.event,
    severity: f.properties.severity,
    headline: f.properties.headline,
    description: f.properties.description,
    onset: f.properties.onset,
    expires: f.properties.expires,
    areaDesc: f.properties.areaDesc,
  }));
}
