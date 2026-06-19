// Location presets and per-location source selection (GOES sector, nearest
// radiosonde station for the skew-T, SPC mesoanalysis sector).

export const PRESETS = [
  { name: 'Lake Tahoe', lat: 39.0968, lon: -120.0324 },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194 },
  { name: 'Reno', lat: 39.5296, lon: -119.8138 },
  { name: 'Seattle', lat: 47.6062, lon: -122.3321 },
  { name: 'Denver', lat: 39.7392, lon: -104.9903 },
];

export const DEFAULT_LOCATION = PRESETS[0];

// GOES-West (GOES-18) regional sector for a lat/lon. Returns the CDN sector
// code AND the square image size that sector actually publishes (they differ:
// psw/pnw are 1200×1200, wus is 1000×1000).
//   psw = Pacific Southwest, pnw = Pacific Northwest, wus = Western U.S. (wide)
export function goesSectorConfig(lat, lon) {
  if (lat >= 42 && lon <= -116) return { code: 'pnw', size: '1200x1200' };
  if (lon <= -114) return { code: 'psw', size: '1200x1200' };
  return { code: 'wus', size: '1000x1000' }; // interior west / Rockies (Denver)
}

// SPC mesoanalysis sector number (verified against SPC's own sector legend):
//   11 Northwest · 12 Southwest · 13 N. Plains · 14 Central Plains ·
//   15 S. Plains · 16 Northeast · 17 East Central · 18 Southeast ·
//   19 National (CONUS) · 20 Midwest
// Approximate geographic boxes; falls back to National for anything outside.
export function spcSector(lat, lon) {
  if (lat >= 42 && lon <= -110) return '11'; // Northwest (Seattle, PNW, N. Rockies)
  if (lat < 42 && lon <= -108) return '12'; // Southwest (CA, NV, AZ, UT, S. CO)
  if (lat >= 42 && lon > -110 && lon <= -95) return '13'; // Northern Plains
  if (lat >= 37 && lat < 42 && lon > -108 && lon <= -92) return '14'; // Central Plains (Denver)
  if (lat < 37 && lon > -108 && lon <= -90) return '15'; // Southern Plains
  if (lat >= 38 && lon > -95 && lon <= -82) return '20'; // Midwest
  if (lat >= 35 && lat < 42 && lon > -90 && lon <= -78) return '17'; // East Central
  if (lat >= 40 && lon > -80) return '16'; // Northeast
  if (lat < 37 && lon > -90) return '18'; // Southeast
  return '19'; // National (CONUS) fallback
}

// Nearest upper-air (radiosonde) station for the UWyo skew-T.
// Stored as [lat, lon, WMO id, label].
const SOUNDING_STATIONS = [
  [39.57, -119.8, '72489', 'Reno, NV (REV)'],
  [37.73, -122.21, '72493', 'Oakland, CA (OAK)'],
  [47.95, -124.55, '72797', 'Quillayute, WA (UIL)'],
  [39.12, -108.53, '72476', 'Grand Junction, CO (GJT)'],
  [40.77, -111.95, '72572', 'Salt Lake City, UT (SLC)'],
  [34.0, -117.0, '72393', 'Vandenberg, CA (VBG)'],
  [43.56, -116.21, '72681', 'Boise, ID (BOI)'],
  [45.7, -118.85, '72786', 'Spokane region, WA (OTX)'],
];

export function nearestSounding(lat, lon) {
  let best = SOUNDING_STATIONS[0];
  let bestD = Infinity;
  for (const s of SOUNDING_STATIONS) {
    const d = (s[0] - lat) ** 2 + (s[1] - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { id: best[2], label: best[3] };
}

// WSR-88D (NEXRAD) sites — [lat, lon, ICAO, name]. Western-focused + key others.
const RADAR_SITES = [
  [39.754, -119.462, 'KRGX', 'Reno, NV'],
  [38.501, -121.678, 'KDAX', 'Sacramento, CA'],
  [39.496, -121.632, 'KBBX', 'Beale AFB, CA'],
  [37.155, -121.898, 'KMUX', 'San Francisco Bay, CA'],
  [36.314, -119.632, 'KHNX', 'San Joaquin Valley, CA'],
  [40.498, -124.292, 'KBHX', 'Eureka, CA'],
  [34.412, -119.179, 'KVTX', 'Los Angeles, CA'],
  [32.919, -117.042, 'KNKX', 'San Diego, CA'],
  [48.195, -122.496, 'KATX', 'Seattle/Everett, WA'],
  [47.681, -117.626, 'KOTX', 'Spokane, WA'],
  [45.715, -122.965, 'KRTX', 'Portland, OR'],
  [42.081, -122.717, 'KMAX', 'Medford, OR'],
  [43.49, -116.236, 'KCBX', 'Boise, ID'],
  [41.263, -112.448, 'KMTX', 'Salt Lake City, UT'],
  [35.701, -114.891, 'KESX', 'Las Vegas, NV'],
  [39.787, -104.546, 'KFTG', 'Denver, CO'],
  [39.062, -108.214, 'KGJX', 'Grand Junction, CO'],
  [38.46, -104.181, 'KPUX', 'Pueblo, CO'],
  [47.041, -113.986, 'KMSX', 'Missoula, MT'],
];

export function nearestRadar(lat, lon) {
  let best = RADAR_SITES[0];
  let bestD = Infinity;
  for (const s of RADAR_SITES) {
    const d = (s[0] - lat) ** 2 + (s[1] - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { id: best[2], name: best[3], lat: best[0], lon: best[1] };
}

// Tahoe-area reference elevations (feet) for snow-level context.
export const TAHOE_LAKE_FT = 6225;
export const TAHOE_PASSES = [
  { name: 'Spooner Summit (US-50 NV)', ft: 7146 },
  { name: 'Donner Summit (I-80)', ft: 7056 },
  { name: 'Echo Summit (US-50)', ft: 7382 },
  { name: 'Kingsbury Grade (SR-207)', ft: 7334 },
  { name: 'Luther Pass (SR-89)', ft: 7740 },
  { name: 'Carson Pass (SR-88)', ft: 8574 },
  { name: 'Mt Rose Summit (SR-431)', ft: 8911 },
];

// Is this location in/around the Tahoe basin (so the lake/pass context applies)?
export function isTahoeArea(lat, lon) {
  return Math.abs(lat - 39.0968) < 1.1 && Math.abs(lon - -120.0324) < 1.1;
}

// Road-conditions state selection. Uses a geocoded admin name when available,
// otherwise rough bounding boxes. Returns 'CA' | 'NV' | other code | null.
export function roadState(lat, lon, adminName) {
  if (adminName) {
    if (/california/i.test(adminName)) return 'CA';
    if (/nevada/i.test(adminName)) return 'NV';
  }
  // Nevada box.
  if (lat >= 35 && lat <= 42 && lon >= -120.0 && lon <= -114.0) return 'NV';
  // California box (west of NV).
  if (lat >= 32.5 && lat <= 42 && lon >= -124.6 && lon < -114.1) return 'CA';
  return adminName || null;
}
