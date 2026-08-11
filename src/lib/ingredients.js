// Stage 1 of the interpretation pipeline: assess the INGREDIENTS once, up
// front, so Stage 2 (analysis.js) can narrate conclusions instead of narrating
// parameters.
//
// Why this exists. The narrative used to run each parameter through its own
// one-way template — "PWAT is high → say heavy rainfall is favoured" — with no
// reference to the other parameters. That produced self-contradicting output:
// for a hot, clear, stable Los Angeles afternoon it stated that deep convection
// was not expected and then, one sentence later, that the moist column favoured
// "efficient — locally heavy — rainfall".
//
// Heavy rain needs MOISTURE and LIFT and (for the convective flavour)
// INSTABILITY, simultaneously. Those three are computed here, once, and every
// precipitation sentence downstream is gated on the conjunction.

import {
  CAPE,
  CIN_MAG,
  LIFTED_INDEX_NEG,
  LAPSE_MID,
  LAPSE_LOW,
  MIXING_HEIGHT,
  HAINES,
  POP,
  QPF_MM,
  PWAT_RATIO,
  PWAT_NORMALS_IN,
  PWAT_ABSOLUTE_DRY_IN,
  WETTING_RAIN_MM,
  MIN_RH_DRY_PCT,
  DEWPOINT_DEPRESSION_DRY_C,
  BREEZY_MPH,
  COLD_C,
  bandOf,
  pwatRegion,
  atLeast,
  tierIndex,
  TIERS,
} from './thresholds.js';

const MPH = (kmh) => (kmh == null ? null : kmh * 0.621371);
const maxTier = (a, b) => (tierIndex(a) >= tierIndex(b) ? a : b);

// Seasonal-normal PWAT (inches) for a location and date.
export function pwatNormalIn(lat, lon, date = new Date()) {
  const region = pwatRegion(lat, lon);
  const table = PWAT_NORMALS_IN[region] || PWAT_NORMALS_IN['interior-west'];
  return { region, normalIn: table[date.getMonth()] };
}

/**
 * Assess the ingredients. Everything is optional — missing inputs produce
 * `tier: null` / `known: false` rather than a fabricated verdict, and the
 * gating downstream treats "unknown" as "don't make the claim".
 *
 * @param diag  computeDiagnostics() output
 * @param sum   summarize18h() output (supplies the lift proxy)
 * @param location {lat, lon, name}
 * @param date  reference date (seasonal normals)
 */
export function assessIngredients({ diag, sum, location, date = new Date() } = {}) {
  const g = diag?.gfs || {};
  const d = diag?.derived || {};
  const nws = diag?.nws || {};
  const s = sum || {};

  // ---- INSTABILITY -------------------------------------------------------
  // Prefer the window maximum over the instantaneous value: the narrative is
  // about the next 18 h, not this minute.
  const cape = s.maxCape ?? g.cape;
  const li = g.liftedIndex;
  const capeBand = bandOf(cape, CAPE);
  const liBand = li == null ? null : bandOf(-li, LIFTED_INDEX_NEG);
  let instTier = null;
  if (capeBand || liBand) {
    instTier = capeBand?.tier ?? liBand?.tier;
    if (capeBand && liBand) instTier = maxTier(capeBand.tier, liBand.tier);
  }
  const instability = {
    known: instTier != null,
    tier: instTier,
    label: capeBand?.label ?? liBand?.label ?? null,
    cape,
    li,
    // "Is there enough buoyancy to talk about storms at all?"
    convectiveAllowed: instTier != null && atLeast(instTier, 'low'),
  };

  // ---- LIFT --------------------------------------------------------------
  // Model PoP/QPF is the proxy. If the model itself keeps the column dry over
  // the window, there is no operative forcing — regardless of how moist or
  // unstable the sounding looks.
  const popBand = bandOf(s.maxPoP, POP);
  const qpfBand = bandOf(s.totalPrecipMm, QPF_MM);
  let liftTier = null;
  if (popBand || qpfBand) {
    liftTier = popBand && qpfBand ? maxTier(popBand.tier, qpfBand.tier) : (popBand?.tier ?? qpfBand.tier);
  }
  const lift = {
    known: liftTier != null,
    tier: liftTier,
    // `present` is deliberately strict: unknown lift is NOT present, so an
    // absent forecast can never license a heavy-rain claim.
    present: liftTier != null && atLeast(liftTier, 'low'),
    significant: liftTier != null && atLeast(liftTier, 'moderate'),
    maxPoP: s.maxPoP ?? null,
    qpfMm: s.totalPrecipMm ?? null,
    source: popBand && qpfBand ? 'NWS PoP + GFS QPF' : popBand ? 'NWS PoP' : qpfBand ? 'GFS QPF' : null,
  };

  // ---- MOISTURE (relative to season and airmass) -------------------------
  const pwatIn = d.pwatIn ?? (g.pwatMm != null ? g.pwatMm / 25.4 : null);
  const { region, normalIn } = pwatNormalIn(location?.lat, location?.lon, date);
  const ratio = pwatIn != null && normalIn ? pwatIn / normalIn : null;
  const ratioBand = bandOf(ratio, PWAT_RATIO);
  const absolutelyDry = pwatIn != null && pwatIn < PWAT_ABSOLUTE_DRY_IN;
  const moisture = {
    known: pwatIn != null,
    pwatIn,
    normalIn,
    region,
    ratio,
    // An absolutely dry column is dry no matter what the local normal says.
    tier: absolutelyDry ? 'nil' : (ratioBand?.tier ?? null),
    label: absolutelyDry ? 'very dry' : (ratioBand?.label ?? null),
    pctOfNormal: ratio == null ? null : Math.round(ratio * 100),
    // "Is there enough water in the column to be worth a precipitation claim?"
    sufficient: !absolutelyDry && ratioBand != null && atLeast(ratioBand.tier, 'moderate'),
    anomalous: !absolutelyDry && ratioBand != null && atLeast(ratioBand.tier, 'high'),
  };

  // ---- SUPPORTING FIELDS --------------------------------------------------
  const midLapse = bandOf(d.lapse700_500, LAPSE_MID);
  const lowLapse = bandOf(d.lapse850_700, LAPSE_LOW);
  const mixH = g.blHeight ?? nws.mixingHeight?.value;
  const mixingBand = bandOf(mixH, MIXING_HEIGHT);
  const cinMag = s.minCinMag ?? (g.cin != null ? Math.abs(g.cin) : null);
  const capBand = bandOf(cinMag, CIN_MAG);
  const hainesVal = nws.hainesIndex?.value;
  const hainesBand = bandOf(hainesVal, HAINES);

  const dd = d.dewpointDepression;
  const minRH = s.minRH;
  const maxWindMph = MPH(s.maxWindKmh);
  const maxGustMph = MPH(s.maxGustKmh);

  // ---- DERIVED CONJUNCTIONS (what the gates actually read) ---------------
  const precipExpected = lift.present && (moisture.known ? moisture.tier !== 'nil' : true);
  const wettingRain = s.totalPrecipMm != null && s.totalPrecipMm >= WETTING_RAIN_MM;
  const snowExpected = (s.totalSnowCm ?? 0) > 0.1;
  const dryAirmass =
    (minRH != null && minRH <= MIN_RH_DRY_PCT) || (dd != null && dd >= DEWPOINT_DEPRESSION_DRY_C);
  const cold = g.t2m != null && g.t2m <= COLD_C;

  return {
    instability,
    lift,
    moisture,
    cap: { known: capBand != null, tier: capBand?.tier ?? null, label: capBand?.label ?? null, magnitude: cinMag },
    lapse: {
      mid: midLapse ? { ...midLapse, value: d.lapse700_500 } : null,
      low: lowLapse ? { ...lowLapse, value: d.lapse850_700 } : null,
    },
    mixing: mixingBand ? { ...mixingBand, value: mixH } : null,
    haines: hainesBand ? { ...hainesBand, value: hainesVal } : null,
    ventilationRate: d.ventilationRate ?? null,
    dewpointDepression: dd,
    minRH,
    maxWindMph,
    maxGustMph,

    // The conjunctions every precipitation/fire/snow sentence is gated on.
    precipExpected,
    wettingRain,
    snowExpected,
    dryAirmass,
    breezy: maxWindMph != null && maxWindMph >= BREEZY_MPH,
    cold,

    // Which ingredient is actually absent, for the "goes unused" sentence.
    // Naming both when only one is missing would reintroduce the very bug this
    // pipeline exists to prevent: at Tahoe with CAPE ~1160 J/kg and no forcing,
    // "no lifting mechanism and no instability" contradicts the regime line two
    // sentences earlier.
    missingIngredient: (() => {
      const noLift = !lift.present;
      const noInstability = !instability.convectiveAllowed;
      if (noLift && noInstability) return 'neither lift nor instability';
      if (noLift) return 'no lifting mechanism';
      if (noInstability) return 'no instability';
      return null;
    })(),

    // Precipitation CHARACTER — the single decision that replaces the old
    // one-way PWAT template.
    //   'convective' → moisture + lift + instability
    //   'stratiform' → moisture + lift, no instability
    //   'unused'     → moisture, no lift  (the forecaster's sentence)
    //   'none'       → no moisture worth mentioning
    precipMode: (() => {
      if (!moisture.known) return 'unknown';
      if (moisture.tier === 'nil') return 'none';
      if (!lift.present) return 'unused';
      return instability.convectiveAllowed ? 'convective' : 'stratiform';
    })(),
  };
}

export { TIERS, atLeast };
