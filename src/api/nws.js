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

// How many stations to probe. NWS orders /stations by distance, but being
// listed does NOT mean a station reports, and reporting does NOT mean reporting
// everything:
//   - Around Tahoe the closest entries are NDOT roadway sensors (CVRNV, SECNV,
//     SPRNV, ZEPNV) that 404 on observations/latest entirely.
//   - In Los Angeles the nearest station that DOES answer (FHMC1, a mesonet
//     site) publishes temperature/wind but no pressure, visibility or sky —
//     while KLAX/KSMO/KBUR one step further out publish all seven fields.
// Taking the first station that has a temperature therefore produced a panel
// that was technically populated but missing most of the local picture.
// Completeness scoring is the durable fix; proximity alone is not a proxy.
// Probed in two waves so the common case stays cheap: wave 1 covers the nearest
// stations and usually contains a complete one (LA resolves at rank 1, Denver
// at rank 0). Wave 2 only runs when wave 1 left fields missing — around Tahoe
// the nearest site publishing visibility and sky is KTVL at rank 17, and
// reaching it on every load would cost 20 requests for a case most locations
// never hit.
const STATION_WAVE = 10;
const MAX_STATION_TRIES = 20;

// Only a station publishing the WHOLE picture is used verbatim. Anything less
// and we keep the nearest reporting station as the primary and composite the
// gaps, so locally-varying values (temperature, wind) come from the closest
// site while slowly-varying ones (sky, visibility) may come from further out.
//
// Accepting a near-complete station instead would trade distance for one field:
// at Tahoe it selected the airport 22 km away over the lakeside site at 12 km,
// and still ended up without pressure. Compositing gets both.
const COMPLETENESS_FLOOR = () => CORE_FIELDS.length;

// The core fields that make up "the local picture", each with how to read it
// out of an NWS observation payload.
const CORE_FIELDS = [
  ['temperatureC', (o) => o.temperature?.value],
  ['dewpointC', (o) => o.dewpoint?.value],
  ['humidity', (o) => o.relativeHumidity?.value],
  ['windSpeedKmh', (o) => o.windSpeed?.value],
  ['windDir', (o) => o.windDirection?.value],
  ['pressurePa', (o) => o.barometricPressure?.value ?? o.seaLevelPressure?.value],
  ['visibilityM', (o) => o.visibility?.value],
  ['textDescription', (o) => o.textDescription || null],
];

const R_EARTH_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;
function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => typeof v !== 'number')) return null;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(a));
}

// Read one station's latest observation into a flat candidate record.
async function probeStation(feature, lat, lon) {
  const p = feature.properties || {};
  const id = p.stationIdentifier;
  const [slon, slat] = feature.geometry?.coordinates || [];
  const base = {
    id,
    name: p.name,
    distanceKm: haversineKm(lat, lon, slat, slon),
  };
  let json;
  try {
    json = await getJSON(`${NWS_BASE}/stations/${id}/observations/latest`);
  } catch {
    return { ...base, ok: false, score: 0, fields: {} }; // listed but publishes nothing
  }
  const o = json.properties || {};
  const fields = {};
  for (const [key, read] of CORE_FIELDS) {
    const v = read(o);
    if (v != null) fields[key] = v;
  }
  return { ...base, ok: true, timestamp: o.timestamp, fields, score: Object.keys(fields).length };
}

/**
 * Resolve the nearest station that actually paints a complete local picture.
 *
 * Strategy: probe the nearest MAX_STATION_TRIES stations in parallel, prefer
 * the NEAREST one meeting COMPLETENESS_FLOOR, and if none does, composite —
 * take each missing field from the next-nearest station that publishes it.
 * Every composited field records where it came from so the UI can disclose it.
 *
 * @param observationStationsUrl NWS gridpoint station-list URL
 * @param lat,lon the SELECTED location (for real distances, any CONUS point)
 */
export async function getLatestObservation(observationStationsUrl, lat, lon) {
  const stations = await getJSON(observationStationsUrl);
  const features = stations.features || [];
  if (!features.length) throw new Error('No observation stations returned');

  const candidates = await Promise.all(
    features.slice(0, STATION_WAVE).map((f) => probeStation(f, lat, lon)),
  );
  let reporting = candidates.filter((c) => c.ok && c.score > 0);

  if (!reporting.length) {
    throw new Error(
      `No reporting observation station found — probed the ${candidates.length} nearest ` +
        `(${candidates.map((c) => c.id).join(', ')}). They are listed by NWS but publish no current observation.`,
    );
  }

  // Wave 2: only if nothing in wave 1 is complete, and only far enough to fill
  // the gaps. Union of fields present so far decides whether it's needed.
  const covered = new Set(reporting.flatMap((c) => Object.keys(c.fields)));
  if (covered.size < CORE_FIELDS.length && features.length > STATION_WAVE) {
    const more = await Promise.all(
      features.slice(STATION_WAVE, MAX_STATION_TRIES).map((f) => probeStation(f, lat, lon)),
    );
    candidates.push(...more);
    reporting = candidates.filter((c) => c.ok && c.score > 0);
  }

  // Candidates stay in NWS's by-distance order, so "first match" is always the
  // nearest match.
  const primary = reporting.find((c) => c.score >= COMPLETENESS_FLOOR()) || reporting[0];

  const out = {
    station: primary.id,
    stationName: primary.name,
    stationDistanceKm: primary.distanceKm,
    timestamp: primary.timestamp,
    // How far down the by-distance list the primary sits (0 = truly nearest).
    stationRank: candidates.indexOf(primary),
    // Which station each field came from — only populated for composited ones.
    fieldSources: {},
    stationsUsed: [{ id: primary.id, name: primary.name, distanceKm: primary.distanceKm }],
    composited: false,
  };
  for (const [key] of CORE_FIELDS) out[key] = primary.fields[key] ?? null;

  // Composite anything the primary is missing from the next-nearest station
  // that has it. Wind is filled as a PAIR so we never report a direction from
  // one site with a speed from another.
  for (const [key] of CORE_FIELDS) {
    if (out[key] != null) continue;
    const donor = reporting.find((c) => c !== primary && c.fields[key] != null);
    if (!donor) continue;
    if (key === 'windSpeedKmh' || key === 'windDir') {
      const pairDonor = reporting.find(
        (c) => c !== primary && c.fields.windSpeedKmh != null && c.fields.windDir != null,
      );
      if (!pairDonor) continue;
      out.windSpeedKmh = pairDonor.fields.windSpeedKmh;
      out.windDir = pairDonor.fields.windDir;
      out.fieldSources.windSpeedKmh = pairDonor.id;
      out.fieldSources.windDir = pairDonor.id;
      if (!out.stationsUsed.some((s) => s.id === pairDonor.id)) {
        out.stationsUsed.push({ id: pairDonor.id, name: pairDonor.name, distanceKm: pairDonor.distanceKm });
      }
      continue;
    }
    out[key] = donor.fields[key];
    out.fieldSources[key] = donor.id;
    if (!out.stationsUsed.some((s) => s.id === donor.id)) {
      out.stationsUsed.push({ id: donor.id, name: donor.name, distanceKm: donor.distanceKm });
    }
  }
  out.composited = Object.keys(out.fieldSources).length > 0;

  // Derive dewpoint from RH when the station reports one but not the other, so
  // a humidity-only site still contributes the moisture half of the picture.
  if (out.dewpointC == null && out.temperatureC != null && out.humidity != null) {
    const es = 6.112 * Math.exp((17.67 * out.temperatureC) / (out.temperatureC + 243.5));
    const e = (es * Math.max(1, Math.min(100, out.humidity))) / 100;
    const ln = Math.log(e / 6.112);
    out.dewpointC = (243.5 * ln) / (17.67 - ln);
    out.fieldSources.dewpointC = 'derived from RH';
  }

  return out;
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
