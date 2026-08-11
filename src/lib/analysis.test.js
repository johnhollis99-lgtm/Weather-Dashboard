// Regression tests for the ingredients-based narrative.
//
// These exist because the narrative used to run each parameter through its own
// one-way template with no cross-checks, and so contradicted itself: for a hot,
// clear, stable Los Angeles afternoon it stated that deep convection was not
// expected and then, one sentence later, that the moist column favoured
// "efficient — locally heavy — rainfall".
//
// Each case below asserts on the PRESENCE and ABSENCE of key phrases, because
// the bug class is "a sentence that should not have fired", which only an
// absence assertion can catch.

import { describe, it, expect } from 'vitest';
import { analyze, assessHazards, briefing } from './analysis.js';
import { assessIngredients } from './ingredients.js';
import { pwatRegion } from './thresholds.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const JULY = new Date('2026-07-15T21:00:00Z');
const JANUARY = new Date('2026-01-15T21:00:00Z');

const LA = { name: 'Los Angeles', lat: 34.0522, lon: -118.2437 };
const SIERRA = { name: 'Lake Tahoe', lat: 39.0968, lon: -120.0324 };
const PLAINS = { name: 'Oklahoma City', lat: 35.4676, lon: -97.5164 };

function makeDiag({
  cape = 0,
  cin = 0,
  li = 6,
  pwatMm = 12,
  blHeight = 1200,
  freezingLevel = 3500,
  t2m = 20,
  td2m = 5,
  lapseMid = 6.5,
  lapseLow = 6.0,
  haines = 3,
  mixingHeight = 1200,
  transportWindKmh = 14,
  snowLevelM = null,
} = {}) {
  return {
    gfs: {
      cape,
      cin,
      liftedIndex: li,
      pwatMm,
      blHeight,
      freezingLevel,
      t2m,
      td2m,
      validTime: '2026-07-15T14:00',
    },
    nws: {
      mixingHeight: { value: mixingHeight, uom: 'm' },
      transportWindSpeed: { value: transportWindKmh, uom: 'km/h' },
      transportWindDirection: { value: 250, uom: 'deg' },
      hainesIndex: { value: haines, uom: '' },
      probabilityOfThunder: { value: 0, uom: '' },
      ...(snowLevelM == null ? {} : { snowLevel: { value: snowLevelM, uom: 'm' } }),
    },
    derived: {
      lapse850_700: lapseLow,
      lapse700_500: lapseMid,
      dewpointDepression: t2m - td2m,
      pwatIn: pwatMm / 25.4,
      ventilationRate: mixingHeight * (transportWindKmh / 3.6),
    },
  };
}

function makeSum({ maxPoP = 0, totalPrecipMm = 0, totalSnowCm = 0, maxCape = 0, minCinMag = 0, minRH = 40, maxGustKmh = 15, maxWindKmh = 10, maxPoT = 0 } = {}) {
  return { hours: 18, maxPoP, totalPrecipMm, totalSnowCm, maxCape, minCinMag, minRH, maxRH: 70, maxGustKmh, maxWindKmh, maxPoT };
}

// Whole narrative surface for a case: synthesis + every finding + briefing.
function narrativeText(diag, sum, location, date) {
  const r = analyze(diag, sum, location, date);
  const b = briefing({
    diag,
    hazards: assessHazards(diag, sum),
    sum,
    confidence: null,
    obs: null,
    location,
    alerts: [],
    date,
  });
  return [r.synthesis, ...r.findings.map((f) => f.text), b.setup, b.outlook, b.watch].join(' \n');
}

// Phrases that assert heavy/efficient CONVECTIVE rainfall. Deliberately narrow:
// "flushing efficiently" (dispersion) is a legitimate, unrelated use of
// "efficient" and must not trip these.
const HEAVY_RAIN = /heavy[- ]rain|locally heavy|efficient[^.]*rainfall|efficient[- ]precip/i;
// A snow level actually being QUOTED, as opposed to being explicitly withheld.
const SNOW_LEVEL_QUOTED = /snow level ~|snow level ≈|rain\/snow line (?:is|sits|near)/i;

// ---------------------------------------------------------------------------
// Case 1 — the Los Angeles regression (the reported bug)
// ---------------------------------------------------------------------------
describe('narrative: LA hot/clear/stable with unremarkable summer PWAT', () => {
  const diag = makeDiag({
    cape: 42,
    cin: -3,
    li: 6.2,
    pwatMm: 31.2, // 1.23 in — near normal for coastal SoCal in July
    t2m: 36.1,
    td2m: 12.0,
    lapseMid: 7.0,
    lapseLow: 7.3,
    haines: 5,
    mixingHeight: 1450,
  });
  const sum = makeSum({ maxPoP: 0, totalPrecipMm: 0, maxCape: 60, minCinMag: 3, minRH: 14, maxGustKmh: 18, maxWindKmh: 12 });
  const text = narrativeText(diag, sum, LA, JULY);

  it('does NOT claim heavy or efficient rainfall', () => {
    expect(text).not.toMatch(HEAVY_RAIN);
  });

  it('frames the moisture as going unused', () => {
    expect(text).toMatch(/goes unused|no lifting mechanism/i);
  });

  it('judges PWAT against the seasonal normal, not an absolute scale', () => {
    const ing = assessIngredients({ diag, sum, location: LA, date: JULY });
    expect(ing.moisture.region).toBe('pacific-sw');
    // 1.23 in against a ~1.15 in July normal is unremarkable.
    expect(ing.moisture.pctOfNormal).toBeGreaterThan(85);
    expect(ing.moisture.pctOfNormal).toBeLessThan(120);
    expect(ing.moisture.tier).toBe('moderate'); // "near normal"
    expect(ing.moisture.anomalous).toBe(false);
  });

  it('classifies precipMode as unused', () => {
    const ing = assessIngredients({ diag, sum, location: LA, date: JULY });
    expect(ing.precipMode).toBe('unused');
    expect(ing.lift.present).toBe(false);
    expect(ing.instability.convectiveAllowed).toBe(false);
  });

  it('does not quote a snow level with no precipitation', () => {
    const snow = assessHazards(diag, sum).find((h) => h.hazard === 'Snow');
    expect(snow.reason).not.toMatch(/snow level ~/);
    expect(snow.reason).toMatch(/no precipitation expected/i);
  });

  it('does not contradict itself: stable AND heavy rain never co-occur', () => {
    expect(text).toMatch(/stable|not expected/i);
    expect(text).not.toMatch(HEAVY_RAIN);
  });
});

// ---------------------------------------------------------------------------
// Case 2 — atmospheric river: high PWAT for season, strong lift, little CAPE
// ---------------------------------------------------------------------------
describe('narrative: Sierra atmospheric river (high PWAT for season, strong lift, low CAPE)', () => {
  const diag = makeDiag({
    cape: 60,
    cin: -5,
    li: 3,
    pwatMm: 31.2, // 1.23 in — EXCEPTIONAL against a ~0.32 in January normal
    t2m: 6,
    td2m: 5,
    lapseMid: 5.8,
    lapseLow: 5.0,
    haines: 2,
    mixingHeight: 600,
    snowLevelM: 1980, // NWS grid publishes a snow level during the event
  });
  const sum = makeSum({ maxPoP: 95, totalPrecipMm: 42, totalSnowCm: 12, maxCape: 80, minCinMag: 5, minRH: 88, maxGustKmh: 70, maxWindKmh: 45 });
  const text = narrativeText(diag, sum, SIERRA, JANUARY);

  it('recognises the moisture as far above seasonal normal', () => {
    const ing = assessIngredients({ diag, sum, location: SIERRA, date: JANUARY });
    expect(ing.moisture.pctOfNormal).toBeGreaterThan(300);
    expect(ing.moisture.anomalous).toBe(true);
  });

  it('classifies precipMode as stratiform, not convective', () => {
    const ing = assessIngredients({ diag, sum, location: SIERRA, date: JANUARY });
    expect(ing.lift.present).toBe(true);
    expect(ing.instability.convectiveAllowed).toBe(false);
    expect(ing.precipMode).toBe('stratiform');
  });

  it('uses steady/stratiform language and does not require convective language', () => {
    expect(text).toMatch(/steady|stratiform/i);
    expect(text).not.toMatch(/locally heavy/i);
  });

  it('does not call the moisture unused when lift is present', () => {
    expect(text).not.toMatch(/goes unused/i);
  });

  it('quotes a snow level, because precipitation is falling', () => {
    const snow = assessHazards(diag, sum).find((h) => h.hazard === 'Snow');
    expect(snow.reason).toMatch(/snow level ~/);
  });

  it('suppresses fire-weather language under wetting rain', () => {
    const fire = analyze(diag, sum, SIERRA, JANUARY).findings.find((f) => f.category === 'Fire weather');
    expect(fire.text).toMatch(/suppressed|wetting rain/i);
    expect(fire.level).toBe('good');
  });
});

// ---------------------------------------------------------------------------
// Case 3 — genuine convective setup
// ---------------------------------------------------------------------------
describe('narrative: Plains convective setup (moderate PWAT, CAPE 2200, lift present)', () => {
  const diag = makeDiag({
    cape: 2200,
    cin: -30,
    li: -7,
    pwatMm: 38, // ~1.5 in, above normal for OKC in July
    t2m: 32,
    td2m: 21,
    lapseMid: 8.2,
    lapseLow: 7.5,
    haines: 4,
    mixingHeight: 2200,
  });
  const sum = makeSum({ maxPoP: 60, totalPrecipMm: 14, maxCape: 2400, minCinMag: 20, minRH: 45, maxGustKmh: 75, maxWindKmh: 40, maxPoT: 45 });
  const text = narrativeText(diag, sum, PLAINS, JULY);

  it('classifies precipMode as convective', () => {
    const ing = assessIngredients({ diag, sum, location: PLAINS, date: JULY });
    expect(ing.instability.convectiveAllowed).toBe(true);
    expect(ing.lift.present).toBe(true);
    expect(ing.precipMode).toBe('convective');
  });

  it('allows heavy-rain / convective language here', () => {
    expect(text).toMatch(HEAVY_RAIN);
  });

  it('allows the steep-lapse-rate updraft conclusion when buoyancy exists', () => {
    expect(text).toMatch(/updrafts accelerate/i);
  });

  it('does not claim the moisture goes unused', () => {
    expect(text).not.toMatch(/goes unused/i);
  });
});

// ---------------------------------------------------------------------------
// Case 4 — dry, stable, nothing happening
// ---------------------------------------------------------------------------
describe('narrative: dry stable airmass (low PWAT, no CAPE, no lift)', () => {
  const diag = makeDiag({
    cape: 5,
    cin: 0,
    li: 9,
    pwatMm: 6, // 0.24 in — absolutely dry
    t2m: 28,
    td2m: -2,
    lapseMid: 6.0,
    lapseLow: 5.5,
    haines: 3,
    mixingHeight: 2600,
  });
  const sum = makeSum({ maxPoP: 0, totalPrecipMm: 0, totalSnowCm: 0, maxCape: 10, minRH: 9, maxGustKmh: 20, maxWindKmh: 14 });
  const text = narrativeText(diag, sum, SIERRA, JULY);

  it('mentions no rainfall and no rainfall efficiency', () => {
    expect(text).not.toMatch(HEAVY_RAIN);
    // "efficient" may legitimately describe dispersion; it must never describe
    // rainfall here.
    expect(text).not.toMatch(/efficient[^.]*(rain|precip)/i);
  });

  it('withholds the snow level rather than quoting one', () => {
    const snow = assessHazards(diag, sum).find((h) => h.hazard === 'Snow');
    expect(snow.reason).not.toMatch(SNOW_LEVEL_QUOTED);
    expect(snow.reason).toMatch(/no rain\/snow line applies/i);
  });

  it('treats an absolutely dry column as dry regardless of seasonal ratio', () => {
    const ing = assessIngredients({ diag, sum, location: SIERRA, date: JULY });
    expect(ing.moisture.tier).toBe('nil');
    expect(ing.precipMode).toBe('none');
  });

  it('does not promise high-based storms without buoyancy', () => {
    expect(text).not.toMatch(/high-based/i);
  });
});

// ---------------------------------------------------------------------------
// The seasonal-moisture lookup that makes "relative to airmass" possible
// ---------------------------------------------------------------------------
describe('PWAT climatology region lookup', () => {
  it('separates the Sierra from coastal SoCal', () => {
    // Regression: a longitude-only test classified Tahoe (39N, 120W) as
    // 'pacific-sw', which is ~3x too moist in winter and made an atmospheric
    // river read as an ordinary day.
    expect(pwatRegion(39.0968, -120.0324)).toBe('interior-west');
    expect(pwatRegion(34.0522, -118.2437)).toBe('pacific-sw');
  });

  it('places the other verification locations sensibly', () => {
    expect(pwatRegion(47.6062, -122.3321)).toBe('pacific-nw'); // Seattle
    expect(pwatRegion(39.7392, -104.9903)).toBe('interior-west'); // Denver
    expect(pwatRegion(33.4484, -112.074)).toBe('desert-sw'); // Phoenix
    expect(pwatRegion(35.4676, -97.5164)).toBe('plains'); // Oklahoma City
    expect(pwatRegion(40.7128, -74.006)).toBe('northeast'); // New York
  });

  it('same PWAT reads as unremarkable in July LA and exceptional in January Sierra', () => {
    const diag = makeDiag({ pwatMm: 31.2 }); // 1.23 in
    const la = assessIngredients({ diag, sum: makeSum(), location: LA, date: JULY });
    const sierra = assessIngredients({ diag, sum: makeSum(), location: SIERRA, date: JANUARY });
    expect(la.moisture.tier).toBe('moderate'); // near normal
    expect(sierra.moisture.tier).toBe('extreme'); // far above normal
    expect(sierra.moisture.pctOfNormal).toBeGreaterThan(300);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: the invariant itself
// ---------------------------------------------------------------------------
describe('invariant: no precipitation claim without lift', () => {
  it('holds across a sweep of PWAT values when lift is absent', () => {
    for (const pwatMm of [10, 20, 30, 40, 55, 70]) {
      const diag = makeDiag({ cape: 20, li: 5, pwatMm });
      const sum = makeSum({ maxPoP: 0, totalPrecipMm: 0 });
      const text = narrativeText(diag, sum, LA, JULY);
      expect(text, `PWAT ${pwatMm} mm leaked a rainfall claim`).not.toMatch(HEAVY_RAIN);
    }
  });

  it('holds for high CAPE with no lift — instability alone is not precipitation', () => {
    const diag = makeDiag({ cape: 3000, li: -8, pwatMm: 40 });
    const sum = makeSum({ maxPoP: 0, totalPrecipMm: 0, maxCape: 3000 });
    const ing = assessIngredients({ diag, sum, location: PLAINS, date: JULY });
    expect(ing.precipMode).toBe('unused');
    expect(narrativeText(diag, sum, PLAINS, JULY)).not.toMatch(HEAVY_RAIN);
  });

  it('names only the ingredient that is actually missing', () => {
    // Regression: with CAPE ~1160 and no forcing the narrative said "no lifting
    // mechanism AND no instability" two sentences after calling the airmass
    // moderately unstable — the same contradiction class, reintroduced by a
    // hardcoded phrase.
    const unstableNoLift = makeDiag({ cape: 1160, li: -5, pwatMm: 18.5, lapseMid: 7.9 });
    const sum = makeSum({ maxPoP: 0, totalPrecipMm: 0, maxCape: 1160, minCinMag: 60 });
    const ing = assessIngredients({ diag: unstableNoLift, sum, location: SIERRA, date: JULY });
    expect(ing.instability.convectiveAllowed).toBe(true);
    expect(ing.lift.present).toBe(false);
    expect(ing.missingIngredient).toBe('no lifting mechanism');

    const text = narrativeText(unstableNoLift, sum, SIERRA, JULY);
    expect(text).not.toMatch(/no instability/i);
    expect(text).toMatch(/no lifting mechanism/i);
  });

  it('does not call a below-normal column "moisture is present aloft"', () => {
    // 0.67 in against a 1.00 in normal is 67% — saying moisture "is present"
    // in the same sentence that reports 67% of normal is the contradiction in
    // miniature.
    const dryish = makeDiag({ cape: 430, li: -2, pwatMm: 17 });
    const sum = makeSum({ maxPoP: 4, totalPrecipMm: 0, maxCape: 1150, minCinMag: 110 });
    const ing = assessIngredients({ diag: dryish, sum, location: SIERRA, date: JULY });
    expect(ing.moisture.tier).toBe('low'); // below normal
    expect(ing.precipMode).toBe('unused');

    const text = narrativeText(dryish, sum, SIERRA, JULY);
    expect(text).toMatch(/on the dry side/i);
    expect(text).not.toMatch(/moisture is present aloft/i);
  });

  it('still says "moisture is present aloft" for a near-normal column', () => {
    const moist = makeDiag({ cape: 42, li: 6, pwatMm: 31.2 });
    const sum = makeSum({ maxPoP: 0, totalPrecipMm: 0 });
    const ing = assessIngredients({ diag: moist, sum, location: LA, date: JULY });
    expect(ing.moisture.tier).toBe('moderate');
    expect(narrativeText(moist, sum, LA, JULY)).toMatch(/moisture is present aloft/i);
  });

  it('names both ingredients when both are genuinely absent', () => {
    const stableNoLift = makeDiag({ cape: 20, li: 6, pwatMm: 30 });
    const sum = makeSum({ maxPoP: 0, totalPrecipMm: 0, maxCape: 20 });
    const ing = assessIngredients({ diag: stableNoLift, sum, location: LA, date: JULY });
    expect(ing.missingIngredient).toBe('neither lift nor instability');
  });

  it('treats unknown lift as absent rather than inventing a claim', () => {
    const diag = makeDiag({ cape: 2000, li: -6, pwatMm: 45 });
    const ing = assessIngredients({ diag, sum: undefined, location: PLAINS, date: JULY });
    expect(ing.lift.known).toBe(false);
    expect(ing.lift.present).toBe(false);
    expect(narrativeText(diag, undefined, PLAINS, JULY)).not.toMatch(HEAVY_RAIN);
  });
});
