// Offline sample soundings for developing/storybooking <DiagnosticSounding />
// and for validating soundingMath.js. Each is a hand-built but physically
// plausible profile, surface-first (pressure descending). Heights are m MSL and
// roughly hydrostatically consistent so lapse-rate and CAPE integrals behave.
//
// Level shape: { pressure(hPa), height(m MSL), temp(°C), dewpoint(°C),
//                windDir(deg), windSpeed(kt) }

/**
 * 1. CAPPED-BUT-LOADED SEVERE — Great Plains spring setup.
 * Hot/moist boundary layer under an elevated mixed-layer cap (warm, dry nose
 * near 800 hPa), steep mid-level lapse rates, strong veering deep shear.
 * Expect: large SBCAPE, real CIN, a flagged cap below 700 hPa, supercell-ish.
 */
export const cappedSevere = [
  { pressure: 1000, height: 130, temp: 28, dewpoint: 20, windDir: 160, windSpeed: 15 },
  { pressure: 925, height: 800, temp: 22, dewpoint: 18, windDir: 185, windSpeed: 25 },
  { pressure: 850, height: 1500, temp: 19, dewpoint: 15, windDir: 205, windSpeed: 30 },
  { pressure: 800, height: 2000, temp: 22, dewpoint: 4, windDir: 215, windSpeed: 35 }, // cap: warm, dry nose
  { pressure: 750, height: 2550, temp: 17, dewpoint: 1, windDir: 225, windSpeed: 40 },
  { pressure: 700, height: 3120, temp: 12, dewpoint: -4, windDir: 235, windSpeed: 45 },
  { pressure: 600, height: 4350, temp: 3, dewpoint: -13, windDir: 245, windSpeed: 52 },
  { pressure: 500, height: 5750, temp: -10, dewpoint: -23, windDir: 252, windSpeed: 62 }, // steep 700–500
  { pressure: 400, height: 7350, temp: -23, dewpoint: -34, windDir: 256, windSpeed: 72 },
  { pressure: 300, height: 9400, temp: -41, dewpoint: -51, windDir: 260, windSpeed: 86 },
  { pressure: 250, height: 10700, temp: -51, dewpoint: -61, windDir: 261, windSpeed: 95 },
  { pressure: 200, height: 12300, temp: -58, dewpoint: -68, windDir: 262, windSpeed: 100 },
  { pressure: 150, height: 14000, temp: -60, dewpoint: -72, windDir: 265, windSpeed: 88 },
];

/**
 * 2. STABLE / DRY DESERT — Reno-like high-desert afternoon.
 * Deep, nearly dry-adiabatic mixed layer, huge dewpoint depressions, weak winds.
 * Expect: ~zero CAPE, no LFC, NO capping inversion (well-mixed), deep mixing
 * height. Surface pressure ~855 hPa reflects ~1340 m elevation.
 */
export const stableDesert = [
  { pressure: 855, height: 1390, temp: 34, dewpoint: -2, windDir: 230, windSpeed: 10 },
  { pressure: 800, height: 1900, temp: 29, dewpoint: -4, windDir: 235, windSpeed: 12 }, // dry-adiabatic ML
  { pressure: 750, height: 2450, temp: 24, dewpoint: -6, windDir: 240, windSpeed: 14 },
  { pressure: 700, height: 3050, temp: 18, dewpoint: -8, windDir: 245, windSpeed: 16 }, // ML top ~here
  { pressure: 600, height: 4300, temp: 11, dewpoint: -15, windDir: 250, windSpeed: 20 },
  { pressure: 500, height: 5700, temp: 0, dewpoint: -22, windDir: 255, windSpeed: 28 },
  { pressure: 400, height: 7350, temp: -13, dewpoint: -30, windDir: 258, windSpeed: 34 },
  { pressure: 300, height: 9350, temp: -30, dewpoint: -42, windDir: 260, windSpeed: 42 },
  { pressure: 250, height: 10600, temp: -41, dewpoint: -52, windDir: 260, windSpeed: 46 },
  { pressure: 200, height: 12100, temp: -52, dewpoint: -60, windDir: 262, windSpeed: 50 },
];

/**
 * 3. SATURATED STRATUS / FOG — coastal marine layer.
 * Saturated, near-isothermal surface layer capped by a strong subsidence
 * inversion (~950→925 hPa), dry warm air above. Expect: cloud base at/near the
 * surface, ~zero CAPE, an inversion flagged as the cap (traps the stratus).
 */
export const stratusFog = [
  { pressure: 1015, height: 50, temp: 13, dewpoint: 13, windDir: 300, windSpeed: 8 },
  { pressure: 1000, height: 170, temp: 13, dewpoint: 12, windDir: 300, windSpeed: 10 },
  { pressure: 980, height: 340, temp: 12.5, dewpoint: 12, windDir: 305, windSpeed: 11 },
  { pressure: 950, height: 600, temp: 12, dewpoint: 11.5, windDir: 310, windSpeed: 12 }, // top of marine layer
  { pressure: 925, height: 830, temp: 18, dewpoint: 0, windDir: 320, windSpeed: 14 }, // subsidence inversion
  { pressure: 900, height: 1050, temp: 19, dewpoint: -3, windDir: 325, windSpeed: 15 },
  { pressure: 850, height: 1500, temp: 17, dewpoint: -5, windDir: 330, windSpeed: 16 },
  { pressure: 700, height: 3120, temp: 7, dewpoint: -12, windDir: 340, windSpeed: 18 },
  { pressure: 500, height: 5800, temp: -9, dewpoint: -25, windDir: 350, windSpeed: 25 },
  { pressure: 300, height: 9500, temp: -38, dewpoint: -50, windDir: 355, windSpeed: 35 },
  { pressure: 200, height: 12200, temp: -55, dewpoint: -65, windDir: 5, windSpeed: 30 },
];

export const sampleProfiles = {
  cappedSevere: { label: 'Capped severe (Great Plains)', profile: cappedSevere },
  stableDesert: { label: 'Stable dry desert (Reno)', profile: stableDesert },
  stratusFog: { label: 'Saturated stratus / fog (coastal)', profile: stratusFog },
};

export default sampleProfiles;
