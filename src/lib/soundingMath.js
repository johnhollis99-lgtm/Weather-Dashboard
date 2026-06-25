// Skew-T / convective sounding physics.
//
// Everything here is derived from a raw vertical profile — no values are
// pulled from an API. The module lifts a parcel, finds the LCL/LFC/EL, and
// integrates CAPE/CIN; it also extracts capping inversions, lapse rates, bulk
// shear, precipitable water and a convective-mode narrative. Units are SI/metric
// internally (°C, hPa, m, kt for wind); callers convert for display.
//
// Formulas follow standard references:
//   - saturation vapor pressure: Bolton (1980), MWR 108, eq. 10
//   - LCL: dry-adiabat ∩ constant-mixing-ratio intersection (Espy as cross-check)
//   - pseudoadiabatic lapse rate: AMS Glossary "saturation-adiabatic lapse rate"
//   - CAPE/CIN: integral of g·(Tv,parcel − Tv,env)/Tv,env dz (virtual-temp corrected)
//
// All functions are pure and individually exported so the physics can be unit
// tested in isolation (see soundingMath.test.js).

// ---- Physical constants ---------------------------------------------------

export const G = 9.80665; // gravity, m/s²
export const RD = 287.04; // gas constant, dry air, J/(kg·K)
export const RV = 461.5; // gas constant, water vapor, J/(kg·K)
export const CP = 1005.0; // specific heat dry air at const pressure, J/(kg·K)
export const LV = 2.501e6; // latent heat of vaporization at 0 °C, J/kg
export const EPS = RD / RV; // ≈ 0.622
export const KAPPA = RD / CP; // ≈ 0.2854 (Poisson exponent)
export const GAMMA_D = G / CP; // dry adiabatic lapse rate, K/m (≈ 0.00976 → 9.76 °C/km)
export const P0 = 1000.0; // reference pressure, hPa
export const C2K = 273.15;

export const cToK = (c) => c + C2K;
export const kToC = (k) => k - C2K;

// ---- Thermodynamic primitives ---------------------------------------------

/**
 * Saturation vapor pressure over liquid water (Bolton 1980). Accurate to ~0.3%
 * for −35…35 °C.
 * @param {number} tC temperature, °C
 * @returns {number} es, hPa
 */
export function saturationVaporPressure(tC) {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

/**
 * Actual vapor pressure from dewpoint (= es evaluated at the dewpoint).
 * @param {number} tdC dewpoint, °C
 * @returns {number} e, hPa
 */
export function vaporPressure(tdC) {
  return saturationVaporPressure(tdC);
}

/**
 * Dewpoint from vapor pressure (inverse of Bolton).
 * @param {number} eHpa vapor pressure, hPa
 * @returns {number} dewpoint, °C
 */
export function dewpointFromVaporPressure(eHpa) {
  const ln = Math.log(eHpa / 6.112);
  return (243.5 * ln) / (17.67 - ln);
}

/**
 * Mixing ratio from vapor pressure and total pressure.
 * @param {number} eHpa vapor pressure, hPa
 * @param {number} pHpa total pressure, hPa
 * @returns {number} mixing ratio, kg/kg
 */
export function mixingRatio(eHpa, pHpa) {
  return (EPS * eHpa) / (pHpa - eHpa);
}

/**
 * Saturation mixing ratio at a given temperature and pressure.
 * @param {number} tC temperature, °C
 * @param {number} pHpa pressure, hPa
 * @returns {number} ws, kg/kg
 */
export function saturationMixingRatio(tC, pHpa) {
  const es = saturationVaporPressure(tC);
  return (EPS * es) / (pHpa - es);
}

/**
 * Relative humidity from temperature and dewpoint.
 * @returns {number} RH, percent (0–100+)
 */
export function relativeHumidity(tC, tdC) {
  return 100 * (saturationVaporPressure(tdC) / saturationVaporPressure(tC));
}

/**
 * Virtual temperature — accounts for water vapor's lower molecular weight.
 * Used for buoyancy so CAPE/CIN match operational (Tv-corrected) values.
 * @param {number} tC temperature, °C
 * @param {number} w mixing ratio, kg/kg
 * @returns {number} virtual temperature, K
 */
export function virtualTemperature(tC, w) {
  return cToK(tC) * ((1 + w / EPS) / (1 + w));
}

/**
 * Potential temperature (dry).
 * @param {number} tC temperature, °C
 * @param {number} pHpa pressure, hPa
 * @returns {number} θ, K
 */
export function potentialTemperature(tC, pHpa) {
  return cToK(tC) * Math.pow(P0 / pHpa, KAPPA);
}

/**
 * Temperature on a dry adiabat (constant θ) at a target pressure.
 * @param {number} thetaK potential temperature, K
 * @param {number} pHpa pressure, hPa
 * @returns {number} temperature, °C
 */
export function temperatureFromTheta(thetaK, pHpa) {
  return kToC(thetaK * Math.pow(pHpa / P0, KAPPA));
}

/**
 * Lift a parcel dry-adiabatically from (tSurfaceC, pSurface) to pTarget.
 * @returns {number} temperature, °C
 */
export function dryAdiabatTemp(tSurfaceC, pSurface, pTarget) {
  return temperatureFromTheta(potentialTemperature(tSurfaceC, pSurface), pTarget);
}

/**
 * Saturation- (pseudo-) adiabatic lapse rate Γs, in K/m. Temperature- AND
 * pressure-dependent (not a fixed 6 °C/km).
 *   Γs = Γd · (1 + Lv·ws/(Rd·T)) / (1 + Lv²·ws/(cp·Rv·T²))
 * @param {number} tK temperature, K
 * @param {number} pHpa pressure, hPa
 * @returns {number} Γs, K/m (positive = cooling with height)
 */
export function moistLapseRate(tK, pHpa) {
  const ws = saturationMixingRatio(kToC(tK), pHpa); // kg/kg
  const num = 1 + (LV * ws) / (RD * tK);
  const den = 1 + (LV * LV * ws) / (CP * RV * tK * tK);
  return GAMMA_D * (num / den);
}

// ---- Interpolation helpers ------------------------------------------------

/**
 * Linear-in-log-pressure interpolation of a profile field at pressure p.
 * Profile is surface-first (pressure descending). Clamps outside the range.
 * @param {Array<object>} profile
 * @param {number} p pressure, hPa
 * @param {string} key field name (e.g. 'temp', 'height')
 * @returns {number|null}
 */
export function interpByPressure(profile, p, key) {
  if (!profile.length) return null;
  if (p >= profile[0].pressure) return profile[0][key];
  const last = profile[profile.length - 1];
  if (p <= last.pressure) return last[key];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if (p <= a.pressure && p >= b.pressure) {
      const f = (Math.log(p) - Math.log(a.pressure)) / (Math.log(b.pressure) - Math.log(a.pressure));
      return a[key] + f * (b[key] - a[key]);
    }
  }
  return null;
}

/** Like interpByPressure but over a {pressure,temp} array (parcel path). */
function interpArrTemp(arr, p) {
  if (p >= arr[0].pressure) return arr[0].temp;
  const last = arr[arr.length - 1];
  if (p <= last.pressure) return last.temp;
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i];
    const b = arr[i + 1];
    if (p <= a.pressure && p >= b.pressure) {
      const f = (Math.log(p) - Math.log(a.pressure)) / (Math.log(b.pressure) - Math.log(a.pressure));
      return a.temp + f * (b.temp - a.temp);
    }
  }
  return last.temp;
}

// ---- LCL ------------------------------------------------------------------

/**
 * Lifting condensation level via the dry-adiabat ∩ constant-mixing-ratio
 * intersection (bisection in pressure). This is cloud base.
 * @param {number} tC surface temperature, °C
 * @param {number} tdC surface dewpoint, °C
 * @param {number} pHpa surface pressure, hPa
 * @returns {{pressure:number, temp:number}}
 */
export function lcl(tC, tdC, pHpa) {
  if (tdC >= tC) return { pressure: pHpa, temp: tC }; // already saturated → cloud base at surface
  const theta = potentialTemperature(tC, pHpa);
  const w0 = mixingRatio(vaporPressure(tdC), pHpa);
  // f(p) = ws(Tdry(p), p) − w0. Positive near surface, negative aloft.
  const f = (p) => saturationMixingRatio(temperatureFromTheta(theta, p), p) - w0;
  let aLo = 50; // low pressure bound (f<0)
  let bHi = pHpa; // high pressure bound (f>0)
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (aLo + bHi);
    if (f(mid) > 0) bHi = mid;
    else aLo = mid;
  }
  const pLCL = 0.5 * (aLo + bHi);
  return { pressure: pLCL, temp: temperatureFromTheta(theta, pLCL) };
}

/**
 * Espy estimate of LCL height above ground: 125·(T−Td) m (≈ 222·(T−Td) ft with
 * the dewpoint depression in °F). A quick sanity cross-check on the exact LCL.
 * @returns {number} height AGL, meters
 */
export function lclEspyMeters(tC, tdC) {
  return 125 * (tC - tdC);
}

// ---- Parcel ascent: LCL/LFC/EL + CAPE/CIN ---------------------------------

/**
 * Build a dense moist-adiabat path from a saturated start point upward to pTop.
 * Integrates Γs with small pressure steps (hydrostatic layer thickness). Also
 * used by the renderer to draw background moist adiabats.
 * @returns {Array<{pressure:number, temp:number}>} surface-first (p descending)
 */
export function moistAdiabatPath(pStart, tStartC, pTop, stepHpa = 2) {
  const path = [{ pressure: pStart, temp: tStartC }];
  let p = pStart;
  let tK = cToK(tStartC);
  while (p - stepHpa >= pTop) {
    // Layer thickness for a stepHpa decrement (hypsometric, thin layer):
    const dz = ((RD * tK) / (G * p)) * stepHpa; // m, positive (going up)
    tK -= moistLapseRate(tK, p) * dz;
    p -= stepHpa;
    path.push({ pressure: p, temp: kToC(tK) });
  }
  return path;
}

/**
 * Lift a parcel through the environment and compute the convective triad
 * (LCL/LFC/EL) plus CAPE and CIN (virtual-temperature corrected).
 *
 * @param {Array<object>} profile environmental profile, surface-first
 * @param {{pressure:number, temp:number, dewpoint:number}} parcel starting parcel
 * @returns {object} { lcl, lfc, el, cape, cin, parcelPath }
 */
export function computeParcelAscent(profile, parcel) {
  const pSfc = parcel.pressure;
  const pTop = profile[profile.length - 1].pressure;
  const theLcl = lcl(parcel.temp, parcel.dewpoint, pSfc);
  const w0 = mixingRatio(vaporPressure(parcel.dewpoint), pSfc); // sub-cloud mixing ratio
  const moist = moistAdiabatPath(theLcl.pressure, theLcl.temp, pTop);

  // Parcel temperature at any pressure: dry adiabat below LCL, moist above.
  const parcelTemp = (p) =>
    p >= theLcl.pressure ? dryAdiabatTemp(parcel.temp, pSfc, p) : interpArrTemp(moist, p);
  const parcelW = (p, tp) => (p >= theLcl.pressure ? w0 : saturationMixingRatio(tp, p));

  // Fine integration grid (surface → top), 5 hPa steps, LCL inserted exactly.
  const grid = [];
  for (let p = pSfc; p > pTop; p -= 5) grid.push(p);
  grid.push(pTop);
  if (theLcl.pressure < pSfc && theLcl.pressure > pTop) {
    grid.push(theLcl.pressure);
    grid.sort((a, b) => b - a);
  }

  // Buoyancy b = g·(Tv,p − Tv,e)/Tv,e at each grid level.
  const lvl = grid.map((p) => {
    const tEnv = interpByPressure(profile, p, 'temp');
    const tdEnv = interpByPressure(profile, p, 'dewpoint');
    const z = interpByPressure(profile, p, 'height');
    const tp = parcelTemp(p);
    const tvEnv = virtualTemperature(tEnv, mixingRatio(vaporPressure(tdEnv), p));
    const tvPar = virtualTemperature(tp, parcelW(p, tp));
    return { p, z, b: (G * (tvPar - tvEnv)) / tvEnv };
  });

  // LFC = first level above the LCL where buoyancy turns positive.
  let lfcIdx = -1;
  for (let i = 1; i < lvl.length; i++) {
    if (lvl[i].p < theLcl.pressure && lvl[i].b > 0 && lvl[i - 1].b <= 0) {
      lfcIdx = i;
      break;
    }
  }
  // EL = highest level where buoyancy turns back negative (above the LFC).
  let elIdx = -1;
  if (lfcIdx >= 0) {
    for (let i = lfcIdx; i < lvl.length - 1; i++) {
      if (lvl[i].b > 0 && lvl[i + 1].b <= 0) elIdx = i + 1;
    }
    if (elIdx < 0) elIdx = lvl.length - 1; // positive to the top of the profile
  }

  // Interpolate the exact pressure/height where buoyancy crosses zero.
  const crossing = (i) => {
    if (i <= 0) return { p: lvl[0].p, z: lvl[0].z };
    const a = lvl[i - 1];
    const c = lvl[i];
    const f = a.b / (a.b - c.b); // 0..1 fraction to the zero
    return { p: a.p + f * (c.p - a.p), z: a.z + f * (c.z - a.z) };
  };

  let cape = 0;
  let cin = 0;
  let lfc = null;
  let el = null;
  if (lfcIdx >= 0) {
    const lfcX = crossing(lfcIdx);
    const elX = elIdx === lvl.length - 1 ? { p: lvl[elIdx].p, z: lvl[elIdx].z } : crossing(elIdx);
    lfc = { pressure: lfcX.p, height: lfcX.z };
    el = { pressure: elX.p, height: elX.z };

    // CAPE: positive area between LFC and EL.
    for (let i = lfcIdx; i < elIdx; i++) {
      const dz = lvl[i + 1].z - lvl[i].z;
      cape += 0.5 * (Math.max(lvl[i].b, 0) + Math.max(lvl[i + 1].b, 0)) * dz;
    }
    // CIN: negative area from surface up to the LFC.
    for (let i = 0; i < lfcIdx; i++) {
      const dz = lvl[i + 1].z - lvl[i].z;
      cin += 0.5 * (Math.min(lvl[i].b, 0) + Math.min(lvl[i + 1].b, 0)) * dz;
    }
  }

  // Parcel path for plotting (dry segment + moist segment).
  const parcelPath = [];
  for (let p = pSfc; p > theLcl.pressure; p -= 10) {
    parcelPath.push({ pressure: p, temp: dryAdiabatTemp(parcel.temp, pSfc, p) });
  }
  for (const m of moist) parcelPath.push(m);

  const lclHeight = interpByPressure(profile, theLcl.pressure, 'height');
  return {
    lcl: { ...theLcl, height: lclHeight, heightAGL: lclHeight - profile[0].height },
    lfc,
    el,
    cape,
    cin,
    parcelPath,
  };
}

/**
 * Mixed-layer parcel: mean potential temperature and mixing ratio over the
 * lowest `depthHpa` of the profile, brought back to the surface pressure.
 * @returns {{pressure:number, temp:number, dewpoint:number}}
 */
export function mixedLayerParcel(profile, depthHpa = 100) {
  const pSfc = profile[0].pressure;
  let n = 0;
  let thetaSum = 0;
  let wSum = 0;
  for (const lev of profile) {
    if (lev.pressure < pSfc - depthHpa) break;
    thetaSum += potentialTemperature(lev.temp, lev.pressure);
    wSum += mixingRatio(vaporPressure(lev.dewpoint), lev.pressure);
    n++;
  }
  const thetaBar = thetaSum / n;
  const wBar = wSum / n;
  const temp = temperatureFromTheta(thetaBar, pSfc);
  const e = (wBar * pSfc) / (EPS + wBar);
  return { pressure: pSfc, temp, dewpoint: dewpointFromVaporPressure(e) };
}

// ---- Capping inversions ---------------------------------------------------

/**
 * Detect layers where temperature INCREASES with height (inversions). Returns
 * one entry per contiguous inversion. The strongest one based below 700 hPa is
 * flagged as "the cap".
 * @param {Array<object>} profile surface-first
 * @returns {{inversions:Array, cap:object|null}}
 */
export function cappingInversions(profile) {
  const inversions = [];
  let i = 0;
  while (i < profile.length - 1) {
    if (profile[i + 1].temp > profile[i].temp) {
      const baseIdx = i;
      let j = i + 1;
      while (j < profile.length - 1 && profile[j + 1].temp > profile[j].temp) j++;
      const base = profile[baseIdx];
      const top = profile[j];
      inversions.push({
        basePressure: base.pressure,
        topPressure: top.pressure,
        baseHeight: base.height,
        topHeight: top.height,
        strength: top.temp - base.temp, // °C of warming through the layer
      });
      i = j;
    } else {
      i++;
    }
  }
  // "The cap": strongest inversion whose base is below (higher p than) 700 hPa.
  let cap = null;
  for (const inv of inversions) {
    if (inv.basePressure >= 700 && (!cap || inv.strength > cap.strength)) cap = inv;
  }
  return { inversions, cap };
}

// ---- Lapse rates ----------------------------------------------------------

/** Classify a lapse rate (°C/km): steep > 7, weak < 5.5, else moderate. */
export function classifyLapse(rate) {
  if (rate == null) return 'unknown';
  if (rate > 7) return 'steep';
  if (rate < 5.5) return 'weak';
  return 'moderate';
}

/**
 * Lapse rate (°C/km) of the layer between two pressure levels.
 * @returns {number|null}
 */
export function layerLapseRate(profile, pBottom, pTop) {
  const tB = interpByPressure(profile, pBottom, 'temp');
  const tT = interpByPressure(profile, pTop, 'temp');
  const zB = interpByPressure(profile, pBottom, 'height');
  const zT = interpByPressure(profile, pTop, 'height');
  if (tB == null || tT == null || zT <= zB) return null;
  return (tB - tT) / ((zT - zB) / 1000);
}

/**
 * The two diagnostic lapse rates: surface→700 hPa and 700→500 hPa (classic
 * "mid-level lapse rate").
 */
export function lapseRates(profile) {
  const pSfc = profile[0].pressure;
  const sfc700 = layerLapseRate(profile, pSfc, 700);
  const mid = layerLapseRate(profile, 700, 500);
  return {
    surface700: sfc700,
    surface700Class: classifyLapse(sfc700),
    mid700_500: mid,
    mid700_500Class: classifyLapse(mid),
  };
}

// ---- Wind shear & hodograph -----------------------------------------------

/**
 * Meteorological wind (direction FROM, speed) → u/v components.
 * @returns {{u:number, v:number}}
 */
export function windComponents(dirDeg, speed) {
  const r = (dirDeg * Math.PI) / 180;
  return { u: -speed * Math.sin(r), v: -speed * Math.cos(r) };
}

/** Interpolate the u/v wind components at a height (m MSL). */
function windAtHeight(profile, z) {
  if (z <= profile[0].height) return windComponents(profile[0].windDir, profile[0].windSpeed);
  const last = profile[profile.length - 1];
  if (z >= last.height) return windComponents(last.windDir, last.windSpeed);
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if (z >= a.height && z <= b.height) {
      const f = (z - a.height) / (b.height - a.height);
      const wa = windComponents(a.windDir, a.windSpeed);
      const wb = windComponents(b.windDir, b.windSpeed);
      return { u: wa.u + f * (wb.u - wa.u), v: wa.v + f * (wb.v - wa.v) };
    }
  }
  return windComponents(last.windDir, last.windSpeed);
}

/** Normalize an angle difference to (−180, 180]. */
function normAngle(d) {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

/**
 * Bulk wind shear (vector difference magnitude, kt) for the 0–1 km and 0–6 km
 * layers, plus whether the hodograph veers (clockwise turning, favorable for
 * right-moving supercells in the N. hemisphere).
 */
export function shearAnalysis(profile) {
  // Use only levels with real winds; interpolate across any gaps rather than
  // letting a missing level read as calm.
  const wl = profile.filter((l) => Number.isFinite(l.windSpeed) && Number.isFinite(l.windDir));
  if (wl.length < 2) return { shear0_1km: null, shear0_6km: null, veering: false, turningDeg: 0 };
  const z0 = wl[0].height;
  const sfc = windComponents(wl[0].windDir, wl[0].windSpeed);
  const mag = (zTop) => {
    const w = windAtHeight(wl, z0 + zTop);
    return Math.hypot(w.u - sfc.u, w.v - sfc.v);
  };
  // Net directional turning over 0–6 km, sampled at 0/1/3/6 km.
  let turning = 0;
  const samples = [0, 1000, 3000, 6000].map((dz) => {
    const w = windAtHeight(wl, z0 + dz);
    return (Math.atan2(-w.u, -w.v) * 180) / Math.PI; // direction FROM
  });
  for (let i = 1; i < samples.length; i++) turning += normAngle(samples[i] - samples[i - 1]);
  return {
    shear0_1km: mag(1000),
    shear0_6km: mag(6000),
    veering: turning > 10, // clockwise turning with height
    turningDeg: turning,
  };
}

// ---- Precipitable water ---------------------------------------------------

/**
 * Precipitable water: (1/g)∫ w dp over the column.
 * @returns {{mm:number, inches:number}}
 */
export function precipitableWater(profile) {
  let mm = 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const wa = mixingRatio(vaporPressure(a.dewpoint), a.pressure);
    const wb = mixingRatio(vaporPressure(b.dewpoint), b.pressure);
    const dpPa = (a.pressure - b.pressure) * 100; // hPa → Pa, positive
    mm += (0.5 * (wa + wb) * dpPa) / G; // kg/m² == mm
  }
  return { mm, inches: mm / 25.4 };
}

// ---- Mixing height --------------------------------------------------------

/**
 * Convective mixing height: lift a dry adiabat from the forecast max surface
 * temperature until it intersects the environmental temperature curve.
 * @param {Array<object>} profile
 * @param {number} surfaceMaxTempC forecast daytime max temperature, °C
 * @returns {{pressure:number, height:number, heightAGL:number}|null}
 */
export function mixingHeight(profile, surfaceMaxTempC) {
  const pSfc = profile[0].pressure;
  const theta = potentialTemperature(surfaceMaxTempC, pSfc);
  const pTop = profile[profile.length - 1].pressure;
  // f(p) = Tdry(p) − Tenv(p); ≥0 at surface, decreases to 0 at the mixing top.
  const f = (p) => temperatureFromTheta(theta, p) - interpByPressure(profile, p, 'temp');
  if (f(pSfc) <= 0) return { pressure: pSfc, height: profile[0].height, heightAGL: 0 };
  let aLo = pTop; // f<0 aloft
  let bHi = pSfc; // f>0 at surface
  if (f(aLo) > 0) return null; // never intersects within the profile
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (aLo + bHi);
    if (f(mid) > 0) bHi = mid;
    else aLo = mid;
  }
  const p = 0.5 * (aLo + bHi);
  const height = interpByPressure(profile, p, 'height');
  return { pressure: p, height, heightAGL: height - profile[0].height };
}

// ---- Storm-mode narrative -------------------------------------------------

export const STORM_THRESHOLDS = {
  CAPE_NONE: 100, // J/kg, below this = effectively stable
  CAPE_HIGH: 1500, // J/kg, "strong instability"
  CIN_STRONG: -150, // J/kg, strongly capped
  SHEAR_SUPERCELL: 35, // kt, 0–6 km
  SHEAR_WEAK: 25, // kt, 0–6 km
};

/**
 * One-line plain-language convective-mode call, computed from the derived
 * parameters. Pure function — see unit tests for each branch.
 * @param {{cape:number, cin:number, shear6km:number}} params
 * @returns {string}
 */
export function stormModeNarrative({ cape, cin, shear6km }) {
  const T = STORM_THRESHOLDS;
  if (cape == null || !Number.isFinite(cape)) return 'Insufficient data to assess convective mode.';
  const capeR = Math.round(cape);
  const shearR = shear6km == null ? null : Math.round(shear6km);
  if (cape < T.CAPE_NONE) return 'Stable — no meaningful convective instability.';
  if (cin != null && cin <= T.CIN_STRONG) {
    return `Capped (CIN ${Math.round(cin)} J/kg, CAPE ${capeR} J/kg) — strong inhibition; needs strong heating or forcing to initiate.`;
  }
  if (cape >= T.CAPE_HIGH) {
    if (shearR != null && shearR >= T.SHEAR_SUPERCELL)
      return `Strong instability (CAPE ${capeR} J/kg) with ${shearR}-kt deep shear — supercells likely if storms initiate.`;
    if (shearR != null && shearR < T.SHEAR_WEAK)
      return `Strong instability (CAPE ${capeR} J/kg) but weak shear (${shearR} kt) — pulse/multicell storms, locally heavy.`;
    return `Strong instability (CAPE ${capeR} J/kg) with moderate shear (${shearR ?? '—'} kt) — organized multicells; a few supercells possible.`;
  }
  if (shearR != null && shearR >= T.SHEAR_SUPERCELL)
    return `Moderate instability (CAPE ${capeR} J/kg) with strong shear (${shearR} kt) — organized, potentially severe storms.`;
  return `Moderate instability (CAPE ${capeR} J/kg) — scattered showers and thunderstorms possible.`;
}

// ---- Master assembly ------------------------------------------------------

/**
 * Run the full diagnostic suite on a profile.
 * @param {Array<object>} profile surface-first levels
 * @param {object} [opts]
 * @param {{temp:number, dewpoint:number, pressure:number}} [opts.surface] parcel override
 * @param {number} [opts.surfaceMaxTemp] forecast max temp for mixing height, °C
 * @returns {object} all derived parameters
 */
export function analyzeSounding(profile, opts = {}) {
  if (!Array.isArray(profile) || profile.length < 3) {
    throw new Error('analyzeSounding: need a profile with at least 3 levels');
  }
  const sfc = opts.surface
    ? { ...opts.surface }
    : { temp: profile[0].temp, dewpoint: profile[0].dewpoint, pressure: profile[0].pressure };

  const sb = computeParcelAscent(profile, sfc);
  const mlParcel = mixedLayerParcel(profile);
  const ml = computeParcelAscent(profile, mlParcel);
  const shear = shearAnalysis(profile);
  const lr = lapseRates(profile);
  const pwat = precipitableWater(profile);
  const { inversions, cap } = cappingInversions(profile);
  const mh = opts.surfaceMaxTemp != null ? mixingHeight(profile, opts.surfaceMaxTemp) : null;

  const narrative = stormModeNarrative({ cape: sb.cape, cin: sb.cin, shear6km: shear.shear0_6km });

  return {
    surfaceBased: sb,
    mixedLayer: ml,
    lcl: sb.lcl,
    lclEspyMeters: lclEspyMeters(sfc.temp, sfc.dewpoint),
    lfc: sb.lfc,
    el: sb.el,
    cape: sb.cape,
    cin: sb.cin,
    mlCape: ml.cape,
    mlCin: ml.cin,
    shear,
    lapseRates: lr,
    pwat,
    inversions,
    cap,
    mixingHeight: mh,
    narrative,
  };
}
