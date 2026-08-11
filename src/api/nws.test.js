// Station-resolution tests for getLatestObservation().
//
// The failure this guards against is subtle: NWS lists observation stations by
// distance, but being listed does not mean a station reports, and reporting
// does not mean reporting everything. Two real cases drive these tests:
//   - Tahoe: the four nearest entries are NDOT roadway sensors that 404, and no
//     nearby site publishes sky/visibility — the panel must composite.
//   - Los Angeles: the nearest reporting site (a mesonet station) publishes
//     temperature and wind but no pressure/visibility/sky, while a full airport
//     observation sits one rank further out.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLatestObservation } from './nws.js';

const STATIONS_URL = 'https://api.weather.gov/gridpoints/XXX/1,1/stations';

// Build a station list feature.
const feat = (id, name, lat, lon) => ({
  properties: { stationIdentifier: id, name },
  geometry: { coordinates: [lon, lat] },
});

// Build an observation payload; omit a key to make that field missing.
const obs = (f = {}) => ({
  properties: {
    timestamp: '2026-08-11T02:50:00+00:00',
    temperature: f.temp == null ? { value: null } : { value: f.temp },
    dewpoint: f.dewp == null ? { value: null } : { value: f.dewp },
    relativeHumidity: f.rh == null ? { value: null } : { value: f.rh },
    windSpeed: f.wspd == null ? { value: null } : { value: f.wspd },
    windDirection: f.wdir == null ? { value: null } : { value: f.wdir },
    barometricPressure: f.pres == null ? { value: null } : { value: f.pres },
    visibility: f.vis == null ? { value: null } : { value: f.vis },
    windGust: f.gust == null ? { value: null } : { value: f.gust },
    textDescription: f.sky ?? null,
  },
});

const FULL = { temp: 22, dewp: 18, rh: 78, wspd: 18.5, wdir: 270, pres: 101354, vis: 16093, sky: 'Clear' };
const MESONET = { temp: 22.8, dewp: 4.8, rh: 31, wspd: 6.4, wdir: 254 }; // no pres/vis/sky

// Install a fetch stub: `stationList` names the stations in order, `answers`
// maps station id → observation payload or the string '404'.
function mockNws(stationList, answers) {
  vi.stubGlobal('fetch', async (url) => {
    const u = String(url);
    if (u === STATIONS_URL) {
      return { ok: true, json: async () => ({ features: stationList }) };
    }
    const m = /\/stations\/([^/]+)\/observations\/latest/.exec(u);
    if (m) {
      const a = answers[m[1]];
      if (!a || a === '404') return { ok: false, status: 404, statusText: 'Not Found' };
      return { ok: true, json: async () => a };
    }
    return { ok: false, status: 500, statusText: 'unexpected' };
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('getLatestObservation — station walk', () => {
  it('skips stations that are listed but publish no observation', async () => {
    mockNws(
      [
        feat('CVRNV', 'US-50 Cave Rock', 39.05, -119.95),
        feat('SECNV', 'SR-28 Secret Creek', 39.2, -119.93),
        feat('KGOOD', 'Real Airport', 39.1, -120.0),
      ],
      { CVRNV: '404', SECNV: '404', KGOOD: obs(FULL) },
    );
    const o = await getLatestObservation(STATIONS_URL, 39.0968, -120.0324);
    expect(o.station).toBe('KGOOD');
    expect(o.stationRank).toBe(2);
    expect(o.temperatureC).toBe(22);
  });

  it('prefers a complete station over a nearer incomplete one (the LA case)', async () => {
    mockNws(
      [
        feat('FHMC1', 'LA Downtown mesonet', 34.06, -118.24),
        feat('KHHR', 'Hawthorne Municipal', 34.0, -118.33),
      ],
      { FHMC1: obs(MESONET), KHHR: obs(FULL) },
    );
    const o = await getLatestObservation(STATIONS_URL, 34.0522, -118.2437);
    expect(o.station).toBe('KHHR');
    expect(o.composited).toBe(false);
    expect(o.pressurePa).toBe(101354);
    expect(o.visibilityM).toBe(16093);
    expect(o.textDescription).toBe('Clear');
  });

  it('composites missing fields from the next-nearest donor (the Tahoe case)', async () => {
    mockNws(
      [
        feat('CVRNV', 'roadway sensor', 39.05, -119.95),
        feat('HMDC1', 'HOMEWOOD', 39.09, -120.16),
        feat('KTVL', 'South Lake Tahoe Airport', 38.89, -119.99),
      ],
      {
        CVRNV: '404',
        HMDC1: obs(MESONET),
        KTVL: obs({ temp: 23, dewp: 3, rh: 27, vis: 16093, sky: 'Clear' }),
      },
    );
    const o = await getLatestObservation(STATIONS_URL, 39.0968, -120.0324);
    // Nearest REPORTING station stays primary for the locally-varying values...
    expect(o.station).toBe('HMDC1');
    expect(o.temperatureC).toBe(22.8);
    expect(o.windSpeedKmh).toBe(6.4);
    // ...and the slowly-varying gaps are filled from further out, with sourcing.
    expect(o.composited).toBe(true);
    expect(o.visibilityM).toBe(16093);
    expect(o.textDescription).toBe('Clear');
    expect(o.fieldSources.visibilityM).toBe('KTVL');
    expect(o.fieldSources.textDescription).toBe('KTVL');
    expect(o.stationsUsed.map((s) => s.id)).toEqual(['HMDC1', 'KTVL']);
  });

  it('never splits wind speed and direction across two stations', async () => {
    mockNws(
      [
        feat('A', 'no wind at all', 39.1, -120.0),
        feat('B', 'has both', 39.2, -120.1),
        feat('C', 'has only direction', 39.3, -120.2),
      ],
      {
        A: obs({ temp: 20, dewp: 5, rh: 40, pres: 101000, vis: 16000, sky: 'Clear' }),
        B: obs({ wspd: 11, wdir: 180 }),
        C: obs({ wdir: 999 }),
      },
    );
    const o = await getLatestObservation(STATIONS_URL, 39.0968, -120.0324);
    expect(o.windSpeedKmh).toBe(11);
    expect(o.windDir).toBe(180); // both from B, never 999 from C
    expect(o.fieldSources.windSpeedKmh).toBe('B');
    expect(o.fieldSources.windDir).toBe('B');
  });

  it('never takes a gust from a different station than the wind', async () => {
    // Regression: gust was composited independently, pairing HMDC1's 9 mph wind
    // with another site's 2 km/h gust and rendering "SSW 9 mph, gusting 2 mph".
    mockNws(
      [
        feat('A', 'wind but no gust', 39.1, -120.0),
        feat('B', 'unrelated gust', 39.4, -120.4),
      ],
      {
        A: obs({ temp: 20, dewp: 5, rh: 40, wspd: 14, wdir: 200, pres: 101000, vis: 16000, sky: 'Clear' }),
        B: obs({ wspd: 3, wdir: 10, gust: 2 }),
      },
    );
    const o = await getLatestObservation(STATIONS_URL, 39.0968, -120.0324);
    expect(o.station).toBe('A');
    expect(o.windSpeedKmh).toBe(14);
    expect(o.windGustKmh).toBeNull(); // A reports none; B's is not borrowed
    expect(o.fieldSources.windGustKmh).toBeUndefined();
  });

  it('carries the gust along when the WIND itself is composited', async () => {
    mockNws(
      [
        feat('A', 'no wind', 39.1, -120.0),
        feat('B', 'wind + gust', 39.2, -120.1),
      ],
      {
        A: obs({ temp: 20, dewp: 5, rh: 40, pres: 101000, vis: 16000, sky: 'Clear' }),
        B: obs({ wspd: 12, wdir: 180, gust: 30 }),
      },
    );
    const o = await getLatestObservation(STATIONS_URL, 39.0968, -120.0324);
    expect(o.windSpeedKmh).toBe(12);
    expect(o.windGustKmh).toBe(30); // same station as the wind
    expect(o.fieldSources.windGustKmh).toBe('B');
  });

  it('does not let the unscored gust field mask an incomplete station', async () => {
    // `covered` counts CORE fields only; a gust must not make wave 1 look done.
    mockNws([feat('A', 'gust only', 39.1, -120.0)], { A: obs({ temp: 20, gust: 40 }) });
    const o = await getLatestObservation(STATIONS_URL, 39.0968, -120.0324);
    expect(o.temperatureC).toBe(20);
    expect(o.visibilityM).toBeNull();
  });

  it('derives dewpoint from RH when a station reports humidity only', async () => {
    mockNws([feat('A', 'RH only', 39.1, -120.0)], {
      A: obs({ temp: 20, rh: 50, wspd: 10, wdir: 200, pres: 101000, vis: 16000, sky: 'Clear' }),
    });
    const o = await getLatestObservation(STATIONS_URL, 39.0968, -120.0324);
    expect(o.dewpointC).toBeGreaterThan(8); // ~9.3 C for 20 C / 50 %
    expect(o.dewpointC).toBeLessThan(11);
    expect(o.fieldSources.dewpointC).toBe('derived from RH');
  });

  it('reports real distances from the SELECTED location, not a fixed origin', async () => {
    mockNws([feat('KDEN', 'Denver Intl', 39.86, -104.67)], { KDEN: obs(FULL) });
    const o = await getLatestObservation(STATIONS_URL, 39.7392, -104.9903);
    expect(o.stationDistanceKm).toBeGreaterThan(25);
    expect(o.stationDistanceKm).toBeLessThan(35);
  });

  it('throws a descriptive error when nothing in range reports', async () => {
    mockNws([feat('X', 'dead', 39.1, -120.0), feat('Y', 'also dead', 39.2, -120.1)], {
      X: '404',
      Y: '404',
    });
    await expect(getLatestObservation(STATIONS_URL, 39.09, -120.03)).rejects.toThrow(
      /No reporting observation station found/,
    );
  });
});
