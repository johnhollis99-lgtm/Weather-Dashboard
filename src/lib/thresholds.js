// Tunable meteorological threshold bands — the single place to adjust how the
// dashboard judges "significant".
//
// Everything here is DATA, not logic. The interpretation layer
// (`ingredients.js` → `analysis.js`) reads these bands and never hardcodes a
// number of its own. Edit the numbers here to retune the narrative and the
// diagnostic chips together.
//
// Bands are ordered ascending by the value they match and are evaluated with
// `bandOf()` below: the first band whose `max` the value falls under wins, and
// the final band (max: Infinity) is the catch-all. Set `invert: true` on a
// family whose SIGNIFICANCE runs opposite its magnitude (low CIN and low mixing
// height are the *more* notable states, not the less).

// Significance tiers, ascending. These are about how NOTABLE a value is, not
// whether it is "good" — low CIN means more convective potential, not better
// weather, and encoding it as good/bad would actively mislead.
export const TIERS = ['nil', 'low', 'moderate', 'high', 'extreme'];
export const tierIndex = (t) => TIERS.indexOf(t);
export const atLeast = (tier, floor) => tierIndex(tier) >= tierIndex(floor);

// Pick the band for a value. Returns { tier, label } or null when value == null.
export function bandOf(value, bands) {
  if (value == null || Number.isNaN(value)) return null;
  for (const b of bands) {
    if (value < b.max) return b;
  }
  return bands[bands.length - 1];
}

// ---------------------------------------------------------------------------
// Convective / thermodynamic parameters
// ---------------------------------------------------------------------------

// CAPE (J/kg). Conventional SBCAPE/MUCAPE significance bands.
export const CAPE = [
  { max: 300, tier: 'nil', label: 'negligible' },
  { max: 1000, tier: 'low', label: 'marginal' },
  { max: 2500, tier: 'moderate', label: 'moderate' },
  { max: 4000, tier: 'high', label: 'strong' },
  { max: Infinity, tier: 'extreme', label: 'extreme' },
];

// CIN as MAGNITUDE (J/kg, positive). Inverted: a small cap is the notable
// state because it lets convection go.
export const CIN_MAG = [
  { max: 10, tier: 'extreme', label: 'uncapped' },
  { max: 25, tier: 'high', label: 'weak cap' },
  { max: 50, tier: 'moderate', label: 'modest cap' },
  { max: 100, tier: 'low', label: 'strong cap' },
  { max: Infinity, tier: 'nil', label: 'capped' },
];

// Lifted index (°C). More negative = more unstable, so bands run downward;
// evaluated on the NEGATED value so `bandOf` still works ascending.
export const LIFTED_INDEX_NEG = [
  { max: 0, tier: 'nil', label: 'stable' },
  { max: 3, tier: 'low', label: 'marginally unstable' },
  { max: 6, tier: 'moderate', label: 'moderately unstable' },
  { max: 9, tier: 'high', label: 'very unstable' },
  { max: Infinity, tier: 'extreme', label: 'extremely unstable' },
];

// 700–500 mb lapse rate (°C/km). Dry adiabatic is 9.8.
export const LAPSE_MID = [
  { max: 5.5, tier: 'nil', label: 'weak' },
  { max: 6.5, tier: 'low', label: 'modest' },
  { max: 7.5, tier: 'moderate', label: 'steep' },
  { max: 8.5, tier: 'high', label: 'very steep' },
  { max: Infinity, tier: 'extreme', label: 'near dry-adiabatic' },
];

// 850–700 mb lapse rate (°C/km).
export const LAPSE_LOW = [
  { max: 5, tier: 'nil', label: 'weak' },
  { max: 6.5, tier: 'low', label: 'modest' },
  { max: 8, tier: 'moderate', label: 'steep' },
  { max: 9, tier: 'high', label: 'very steep' },
  { max: Infinity, tier: 'extreme', label: 'near dry-adiabatic' },
];

// Mixing / boundary-layer height (m). Inverted: a SHALLOW layer is the notable
// (poor-dispersion) state.
export const MIXING_HEIGHT = [
  { max: 250, tier: 'extreme', label: 'very shallow' },
  { max: 500, tier: 'high', label: 'shallow' },
  { max: 1000, tier: 'moderate', label: 'marginal' },
  { max: 2000, tier: 'low', label: 'good' },
  { max: Infinity, tier: 'nil', label: 'deep' },
];

// Haines index (2–6) — potential for large-fire growth.
export const HAINES = [
  { max: 3, tier: 'nil', label: 'very low' },
  { max: 4, tier: 'low', label: 'low' },
  { max: 5, tier: 'moderate', label: 'moderate' },
  { max: 6, tier: 'high', label: 'high' },
  { max: Infinity, tier: 'extreme', label: 'very high' },
];

// Freezing level (m MSL). Inverted: a LOW freezing level is the notable state.
// Most meaningful read against local terrain — see Snow.jsx for the
// pass-by-pass comparison that supersedes these coarse bands where available.
export const FREEZING_LEVEL = [
  { max: 1200, tier: 'extreme', label: 'very low' },
  { max: 1800, tier: 'high', label: 'low' },
  { max: 2500, tier: 'moderate', label: 'moderate' },
  { max: 3500, tier: 'low', label: 'high' },
  { max: Infinity, tier: 'nil', label: 'very high' },
];

// ---------------------------------------------------------------------------
// Lift — is anything actually forcing ascent?
// ---------------------------------------------------------------------------
// The model's own QPF/PoP is the reliable proxy: if the model dries the column
// out over the window, there is no operative lift, whatever the moisture says.

// Max probability of precipitation over the window (%).
export const POP = [
  { max: 15, tier: 'nil', label: 'none' },
  { max: 30, tier: 'low', label: 'slight' },
  { max: 60, tier: 'moderate', label: 'likely' },
  { max: Infinity, tier: 'high', label: 'high' },
];

// Total QPF over the window (mm).
export const QPF_MM = [
  { max: 0.5, tier: 'nil', label: 'none' },
  { max: 2.5, tier: 'low', label: 'light' },
  { max: 10, tier: 'moderate', label: 'moderate' },
  { max: Infinity, tier: 'high', label: 'heavy' },
];

// A "wetting rain" — enough to matter for fire behaviour and to make
// smoke/dispersion talk irrelevant (mm over the window).
export const WETTING_RAIN_MM = 2.5;

// ---------------------------------------------------------------------------
// Moisture — judged against SEASON AND AIRMASS, never an absolute scale.
// ---------------------------------------------------------------------------
// 1.23" PWAT in a July Los Angeles airmass is unremarkable; the same value in a
// January Sierra storm is exceptional. Absolute PWAT bands cannot express that,
// so the narrative uses percent-of-normal instead.
//
// These are COARSE climatological monthly mean PWAT values (inches) by broad
// region — good enough to separate "normal for the season" from "anomalous",
// which is the only judgement the narrative makes. Tune freely.
export const PWAT_NORMALS_IN = {
  //                 Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct   Nov   Dec
  'pacific-sw':    [0.55, 0.60, 0.62, 0.66, 0.74, 0.86, 1.15, 1.28, 1.08, 0.84, 0.66, 0.56],
  'desert-sw':     [0.40, 0.42, 0.45, 0.50, 0.55, 0.70, 1.30, 1.40, 1.05, 0.66, 0.48, 0.40],
  'pacific-nw':    [0.50, 0.52, 0.56, 0.62, 0.72, 0.84, 0.92, 0.95, 0.85, 0.72, 0.60, 0.52],
  'interior-west': [0.32, 0.34, 0.40, 0.46, 0.56, 0.66, 0.95, 1.00, 0.78, 0.55, 0.40, 0.33],
  plains:          [0.35, 0.38, 0.50, 0.70, 1.00, 1.30, 1.50, 1.45, 1.15, 0.75, 0.50, 0.38],
  midwest:         [0.35, 0.38, 0.52, 0.72, 1.05, 1.35, 1.55, 1.50, 1.20, 0.80, 0.55, 0.40],
  southeast:       [0.85, 0.88, 1.05, 1.25, 1.55, 1.85, 2.00, 1.95, 1.75, 1.30, 1.00, 0.88],
  northeast:       [0.40, 0.42, 0.55, 0.75, 1.05, 1.35, 1.55, 1.55, 1.25, 0.85, 0.62, 0.45],
};

// Coarse region lookup from lat/lon. Deliberately simple — it only has to pick
// the right climatological column, not draw real boundaries.
//
// Latitude matters as much as longitude out west: a longitude-only test puts
// the Sierra (39°N, 120°W) in the same bucket as coastal Southern California,
// which is wrong by a factor of ~3 in winter and makes an atmospheric river
// read as an ordinary day. Both coordinates are therefore checked together.
export function pwatRegion(lat, lon) {
  if (lat == null || lon == null) return 'interior-west';
  // West of the Continental Divide.
  if (lon <= -104) {
    if (lat >= 40) return lon <= -117 ? 'pacific-nw' : 'interior-west';
    if (lat < 36 && lon <= -117) return 'pacific-sw'; // coastal SoCal
    if (lat < 37 && lon > -117) return 'desert-sw'; // AZ / Mojave / southern NV
    return 'interior-west'; // Sierra, Great Basin, UT, CO Rockies
  }
  if (lon <= -95) return 'plains';
  if (lon <= -82) return lat >= 38 ? 'midwest' : 'southeast';
  return lat >= 38 ? 'northeast' : 'southeast';
}

// PWAT as a fraction of the seasonal normal for the region.
export const PWAT_RATIO = [
  { max: 0.6, tier: 'nil', label: 'well below normal' },
  { max: 0.85, tier: 'low', label: 'below normal' },
  { max: 1.15, tier: 'moderate', label: 'near normal' },
  { max: 1.5, tier: 'high', label: 'above normal' },
  { max: Infinity, tier: 'extreme', label: 'far above normal' },
];

// Absolute floor: below this the column is dry in any season/airmass, and the
// percent-of-normal framing stops being useful (inches).
export const PWAT_ABSOLUTE_DRY_IN = 0.35;

// ---------------------------------------------------------------------------
// Dryness / fire — gates the fire-weather and smoke language.
// ---------------------------------------------------------------------------
export const MIN_RH_DRY_PCT = 20; // min RH at or below this = "dry airmass"
export const DEWPOINT_DEPRESSION_DRY_C = 15; // surface DD at or above = dry sub-cloud
export const BREEZY_MPH = 20; // sustained wind for fire-weather relevance

// Cold thresholds — gates wind-chill language (°C).
export const COLD_C = 5;
export const WIND_CHILL_RELEVANT_C = 10;
