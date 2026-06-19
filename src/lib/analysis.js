// Rule-based meteorological analysis engine.
//
// Takes the computed diagnostics object and interprets the RAW NUMBERS into a
// plain-language assessment. This is an independent interpretation — not a
// restatement of the NWS zone forecast. Each rule emits a "finding" with a
// severity level; a synthesis paragraph ties them together (what's happening,
// what's next, why).

const LEVELS = { good: 'good', info: 'info', watch: 'watch', warn: 'warn' };

function f(category, level, title, text) {
  return { category, level, title, text };
}

// ---- Individual classifiers ----------------------------------------------

function instability(cape, li) {
  if (cape == null && li == null) return null;
  let level = LEVELS.info;
  let desc;
  if (cape != null) {
    if (cape < 100) {
      desc = `CAPE ${Math.round(cape)} J/kg — essentially stable; no meaningful buoyancy for deep convection.`;
      level = LEVELS.good;
    } else if (cape < 500) {
      desc = `CAPE ${Math.round(cape)} J/kg — weak/marginal instability; at most weak showers or elevated convection.`;
      level = LEVELS.info;
    } else if (cape < 1000) {
      desc = `CAPE ${Math.round(cape)} J/kg — moderate instability; thunderstorms possible with a trigger.`;
      level = LEVELS.watch;
    } else if (cape < 2500) {
      desc = `CAPE ${Math.round(cape)} J/kg — strong instability; organized/robust thunderstorms favored if convection initiates.`;
      level = LEVELS.warn;
    } else {
      desc = `CAPE ${Math.round(cape)} J/kg — very strong to extreme instability; potential for intense updrafts and severe storms.`;
      level = LEVELS.warn;
    }
  }
  if (li != null) {
    const liTxt =
      li > 0
        ? `LI +${li.toFixed(0)} (stable)`
        : li > -2
          ? `LI ${li.toFixed(0)} (marginally unstable)`
          : li > -4
            ? `LI ${li.toFixed(0)} (moderately unstable)`
            : li > -6
              ? `LI ${li.toFixed(0)} (very unstable)`
              : `LI ${li.toFixed(0)} (extremely unstable)`;
    desc = desc ? `${desc} ${liTxt}.` : `${liTxt}.`;
  }
  return f('Instability', level, 'Instability (CAPE / LI)', desc);
}

function cap(cin, cape) {
  if (cin == null) return null;
  const mag = Math.abs(cin); // treat as cap strength
  let level = LEVELS.info;
  let desc;
  if (mag < 10) {
    desc = `CIN ~${Math.round(mag)} J/kg — no meaningful cap; parcels can rise freely if lift is present.`;
    level = cape && cape > 500 ? LEVELS.watch : LEVELS.info;
  } else if (mag < 50) {
    desc = `CIN ~${Math.round(mag)} J/kg — modest cap; needs daytime heating or forcing to break.`;
    level = LEVELS.info;
  } else if (mag < 100) {
    desc = `CIN ~${Math.round(mag)} J/kg — strong cap; convection unlikely without significant forcing or heating.`;
    level = LEVELS.good;
  } else {
    desc = `CIN ~${Math.round(mag)} J/kg — very strong cap; deep convection effectively suppressed. If it breaks late, any storms could be intense (CAPE released at once).`;
    level = cape && cape > 1000 ? LEVELS.watch : LEVELS.good;
  }
  return f('Cap', level, 'Convective inhibition (cap)', desc);
}

function lapseRates(mid, low) {
  if (mid == null && low == null) return null;
  const parts = [];
  let level = LEVELS.info;
  if (mid != null) {
    let t;
    if (mid >= 8) {
      t = `700–500 mb lapse rate ${mid.toFixed(1)} °C/km — steep, approaching dry-adiabatic; strongly supports vertical acceleration of updrafts.`;
      level = LEVELS.warn;
    } else if (mid >= 7) {
      t = `700–500 mb lapse rate ${mid.toFixed(1)} °C/km — moderately steep; conditionally unstable mid-levels.`;
      level = LEVELS.watch;
    } else if (mid >= 5.5) {
      t = `700–500 mb lapse rate ${mid.toFixed(1)} °C/km — near moist-adiabatic; modest mid-level instability.`;
    } else {
      t = `700–500 mb lapse rate ${mid.toFixed(1)} °C/km — weak; stable mid-levels.`;
      level = LEVELS.good;
    }
    parts.push(t);
  }
  if (low != null) {
    parts.push(
      `850–700 mb lapse rate ${low.toFixed(1)} °C/km in the low levels` +
        (low >= 8 ? ' — steep, efficient low-level mixing/buoyancy.' : '.'),
    );
  }
  return f('Lapse rates', level, 'Lapse rates', parts.join(' '));
}

function moisture(pwatIn, dewpointDepression) {
  if (pwatIn == null && dewpointDepression == null) return null;
  const parts = [];
  let level = LEVELS.info;
  if (pwatIn != null) {
    if (pwatIn < 0.5) {
      parts.push(`PWAT ${pwatIn.toFixed(2)} in — very dry column; rainfall would be light/inefficient.`);
      level = LEVELS.good;
    } else if (pwatIn < 1.0) {
      parts.push(`PWAT ${pwatIn.toFixed(2)} in — modest moisture; showers possible but limited rain totals.`);
    } else if (pwatIn < 1.5) {
      parts.push(`PWAT ${pwatIn.toFixed(2)} in — moist column (notably so for the interior West); efficient rainfall possible.`);
      level = LEVELS.watch;
    } else {
      parts.push(`PWAT ${pwatIn.toFixed(2)} in — very moist; heavy-rain / efficient-precip potential if storms develop.`);
      level = LEVELS.warn;
    }
  }
  if (dewpointDepression != null) {
    if (dewpointDepression >= 15) {
      parts.push(`Surface dewpoint depression ${dewpointDepression.toFixed(0)} °C — dry low levels (high cloud bases, strong sub-cloud evaporation; gusty/dry storms and fire concern).`);
    } else if (dewpointDepression <= 3) {
      parts.push(`Surface dewpoint depression ${dewpointDepression.toFixed(0)} °C — near-saturated low levels (fog/low stratus or steady precip favored).`);
    } else {
      parts.push(`Surface dewpoint depression ${dewpointDepression.toFixed(0)} °C.`);
    }
  }
  return f('Moisture', level, 'Moisture (PWAT / dewpoint depression)', parts.join(' '));
}

function mixing(blHeight, mixingHeight) {
  const h = blHeight ?? mixingHeight;
  if (h == null) return null;
  let level = LEVELS.info;
  let desc;
  if (h < 500) {
    desc = `Boundary-layer / mixing height ~${Math.round(h)} m — shallow; poor vertical mixing, pollutants and smoke stay trapped near the surface.`;
    level = LEVELS.watch;
  } else if (h < 1500) {
    desc = `Boundary-layer / mixing height ~${Math.round(h)} m — moderate daytime mixing.`;
  } else {
    desc = `Boundary-layer / mixing height ~${Math.round(h)} m — deep mixing; efficient vertical dispersion.`;
    level = LEVELS.good;
  }
  return f('Mixing', level, 'Boundary-layer mixing', desc);
}

function ventilation(rate) {
  if (rate == null) return null;
  let level = LEVELS.info;
  let desc;
  if (rate < 2000) {
    desc = `Ventilation rate ~${Math.round(rate)} m²/s — POOR; stagnant air, smoke/haze accumulates, air-quality risk.`;
    level = LEVELS.warn;
  } else if (rate < 4000) {
    desc = `Ventilation rate ~${Math.round(rate)} m²/s — marginal/fair dispersion.`;
    level = LEVELS.watch;
  } else if (rate < 6000) {
    desc = `Ventilation rate ~${Math.round(rate)} m²/s — good dispersion.`;
    level = LEVELS.good;
  } else {
    desc = `Ventilation rate ~${Math.round(rate)} m²/s — excellent dispersion; smoke/pollutants cleared efficiently.`;
    level = LEVELS.good;
  }
  return f('Ventilation', level, 'Ventilation / smoke potential', desc);
}

function fireWeather(haines, dewpointDepression, ventilationRate) {
  if (haines == null) return null;
  let level = LEVELS.info;
  let desc;
  const h = Math.round(haines);
  if (h <= 3) {
    desc = `Haines index ${h} — LOW potential for large fire growth.`;
    level = LEVELS.good;
  } else if (h === 4) {
    desc = `Haines index ${h} — MODERATE fire-growth potential (dry, unstable lower atmosphere).`;
    level = LEVELS.watch;
  } else {
    desc = `Haines index ${h} — HIGH potential for plume-dominated / erratic large-fire growth.`;
    level = LEVELS.warn;
  }
  if (dewpointDepression != null && dewpointDepression >= 15) {
    desc += ` Combined with dry low levels (DD ${dewpointDepression.toFixed(0)} °C), expect rapid fuel drying.`;
  }
  return f('Fire weather', level, 'Fire weather (Haines)', desc);
}

// ---- Synthesis ------------------------------------------------------------

function synthesize(diag) {
  const g = diag.gfs || {};
  const d = diag.derived || {};
  const cape = g.cape;
  const cinMag = g.cin != null ? Math.abs(g.cin) : null;
  const mid = d.lapse850_700 != null || d.lapse700_500 != null ? d.lapse700_500 : null;
  const pwatIn = d.pwatIn;
  const vent = d.ventilationRate;

  // Headline regime.
  let regime;
  if (cape == null) {
    regime = 'Insufficient model data to classify the convective regime.';
  } else if (cape < 100) {
    regime = 'The atmosphere is stable — no meaningful buoyant energy is available, so deep convection is not expected.';
  } else if (cape < 500) {
    regime = 'Weakly unstable — only marginal buoyancy is present, supporting at most weak showers or isolated elevated convection.';
  } else if (cape < 1500) {
    regime = 'Moderately unstable — enough buoyant energy for thunderstorms if a trigger is available.';
  } else {
    regime = 'Strongly unstable — substantial buoyant energy is in place; robust to potentially severe storms are possible where convection initiates.';
  }

  // Whether anything can break the cap / lift parcels.
  let trigger;
  if (cape != null && cape >= 300) {
    if (cinMag != null && cinMag >= 75) {
      trigger = ` A strong cap (CIN ~${Math.round(cinMag)} J/kg) is holding things in check, so storms need strong forcing or peak heating to fire — but if the cap erodes late in the day the stored energy could release abruptly.`;
    } else if (cinMag != null && cinMag >= 25) {
      trigger = ` A modest cap (CIN ~${Math.round(cinMag)} J/kg) means afternoon heating or terrain/forcing should be enough to initiate.`;
    } else {
      trigger = ' Little inhibition is present, so any lift (terrain, heating, a passing disturbance) can readily set off convection.';
    }
  } else {
    trigger = '';
  }

  // Steepness + moisture flavor.
  let flavor = '';
  if (mid != null && mid >= 7.5) {
    flavor += ` Steep mid-level lapse rates (${mid.toFixed(1)} °C/km) would let updrafts accelerate efficiently.`;
  }
  if (pwatIn != null) {
    if (pwatIn >= 1.2) {
      flavor += ` The column is moist (PWAT ${pwatIn.toFixed(2)} in), favoring efficient — locally heavy — rainfall.`;
    } else if (pwatIn < 0.6) {
      flavor += ` The column is dry (PWAT ${pwatIn.toFixed(2)} in), so storms would tend to be high-based with gusty winds and little rain.`;
    }
  }

  // Air quality / ventilation tail.
  let air = '';
  if (vent != null) {
    if (vent < 2000) {
      air = ` Dispersion is poor (ventilation ~${Math.round(vent)} m²/s): any smoke or pollutants will tend to accumulate near the surface.`;
    } else if (vent >= 6000) {
      air = ` Dispersion is excellent (ventilation ~${Math.round(vent)} m²/s): the boundary layer is flushing efficiently.`;
    }
  }

  return (regime + trigger + flavor + air).trim();
}

// ---- Public API -----------------------------------------------------------

// ---------------------------------------------------------------------------
// DERIVED 18-hour hazard assessment.
// IMPORTANT: this is a rule-based interpretation of the raw diagnostics, NOT an
// official probability. Levels are Low / Moderate / High with a rough % and a
// one-line reason. `sum` is summarize18h(gfs, gridData).
// ---------------------------------------------------------------------------

const MPH = (kmh) => (kmh == null ? null : kmh * 0.621371);
const bump = (lvl) => (lvl === 'Low' || lvl === 'None' ? 'Moderate' : lvl === 'Moderate' ? 'High' : 'High');

export function assessHazards(diag, sum) {
  const g = diag?.gfs || {};
  const d = diag?.derived || {};
  const nws = diag?.nws || {};
  const s = sum || {};

  const gustMph = MPH(s.maxGustKmh);
  const windMph = MPH(s.maxWindKmh);
  const snowIn = s.totalSnowCm != null ? s.totalSnowCm / 2.54 : null;
  const dd = d.dewpointDepression;
  const pwatIn = d.pwatIn;
  const cape = s.maxCape ?? g.cape;
  const cinMag = s.minCinMag;
  const pot = s.maxPoT;
  const precip = s.totalPrecipMm;
  const haines = nws.hainesIndex?.value;
  const minRH = s.minRH;
  const snowLevelFt = nws.snowLevel?.value != null ? nws.snowLevel.value * 3.28084 : null;

  const out = [];

  // --- Thunderstorms ---
  {
    let level = 'Low', pct = 5;
    const cap = cinMag ?? 0;
    if ((cape >= 1500 && cap < 75) || pot >= 50) { level = 'High'; pct = 70; }
    else if ((cape >= 700 && cap < 150) || cape >= 1200 || pot >= 30) { level = 'Moderate'; pct = 45; }
    else if (cape >= 250 || pot >= 15) { level = 'Low'; pct = 22; }
    const bits = [];
    if (cape != null) bits.push(`CAPE to ~${Math.round(cape)} J/kg`);
    if (pot != null) bits.push(`NWS thunder prob max ${Math.round(pot)}%`);
    if (cinMag != null) bits.push(`min cap ~${Math.round(cinMag)} J/kg`);
    out.push({ hazard: 'Thunderstorms', level, pct, reason: bits.join(', ') + '.' });
  }

  // --- Dry lightning ---
  // Requires thunder potential + a genuinely dry sub-cloud layer (high dewpoint
  // depression / high LCL) with little rain reaching the ground. Modest PWAT
  // alone is not enough.
  {
    let level = 'Low', pct = 5;
    const thunder = cape >= 300 || pot >= 15;
    const drySubcloud = dd != null && dd >= 12;
    const dryColumn = pwatIn != null && pwatIn < 0.6;
    const littleRain = precip != null && precip < 2.5;
    if (thunder && drySubcloud && littleRain) {
      const veryDry = cape >= 700 && dd >= 15;
      level = veryDry ? 'High' : 'Moderate';
      pct = veryDry ? 55 : 35;
    } else if (thunder && (drySubcloud || dryColumn) && littleRain) {
      level = 'Low'; pct = 22;
    } else if (thunder && littleRain) {
      level = 'Low'; pct = 12;
    }
    const reason =
      `${thunder ? 'thunder potential present' : 'little thunder potential'}; ` +
      `${dd != null ? `dewpoint depression ${dd.toFixed(0)}°C` : 'sub-cloud moisture unknown'}` +
      `${pwatIn != null ? `, PWAT ${pwatIn.toFixed(2)}″` : ''}` +
      `${precip != null ? `, ~${precip.toFixed(1)} mm rain expected` : ''}.`;
    out.push({ hazard: 'Dry lightning', level, pct, reason });
  }

  // --- Gusty / downburst winds ---
  {
    let level = 'Low', pct = 10;
    if (gustMph != null) {
      if (gustMph >= 58) { level = 'High'; pct = 70; }
      else if (gustMph >= 46) { level = 'Moderate'; pct = 45; }
      else if (gustMph >= 35) { level = 'Low'; pct = 25; }
      else { level = 'Low'; pct = 10; }
    }
    const downburst = cape >= 500 && dd != null && dd >= 14;
    if (downburst && level !== 'High') level = bump(level);
    const reason =
      `${gustMph != null ? `gusts to ~${Math.round(gustMph)} mph` : 'gust data unavailable'}` +
      `${downburst ? '; convective downburst potential (unstable + dry sub-cloud layer)' : ''}.`;
    out.push({ hazard: 'Gusty / downburst winds', level, pct, reason });
  }

  // --- Snow ---
  {
    let level = 'None', pct = 2;
    if (snowIn != null) {
      if (snowIn >= 6) { level = 'High'; pct = 80; }
      else if (snowIn >= 2) { level = 'Moderate'; pct = 50; }
      else if (snowIn >= 0.1) { level = 'Low'; pct = 25; }
      else { level = 'None'; pct = 3; }
    }
    const reason =
      `${snowIn != null ? `~${snowIn.toFixed(1)}″ snow modeled (next 18h)` : 'snow data unavailable'}` +
      `${snowLevelFt != null ? `; snow level ~${Math.round(snowLevelFt).toLocaleString()} ft` : ''}.`;
    out.push({ hazard: 'Snow', level, pct, reason });
  }

  // --- Fire weather ---
  {
    let level = 'Low', pct = 8;
    const dryAir = minRH != null && minRH <= 20;
    const breezy = windMph != null && windMph >= 20;
    const noRain = precip == null || precip < 1;
    if (haines != null && haines >= 5 && dryAir && breezy && noRain) { level = 'High'; pct = 70; }
    else if (haines != null && haines >= 4 && (dryAir || breezy) && noRain) { level = 'Moderate'; pct = 45; }
    else if (dryAir && noRain) { level = 'Low'; pct = 25; }
    if (snowIn != null && snowIn >= 1) { level = 'Low'; pct = 2; } // wet/snowy → negligible
    const reason =
      `${haines != null ? `Haines ${Math.round(haines)}` : 'Haines n/a'}` +
      `${minRH != null ? `, min RH ${Math.round(minRH)}%` : ''}` +
      `${windMph != null ? `, winds to ${Math.round(windMph)} mph` : ''}` +
      `${noRain ? ', dry' : ', wetting rain expected'}.`;
    out.push({ hazard: 'Fire weather', level, pct, reason });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Top-of-dashboard briefing — plain-language synthesis of everything.
// ---------------------------------------------------------------------------
export function briefing({ diag, hazards, sum, confidence, obs, location, alerts }) {
  if (!diag) return null;
  const s = sum || {};
  const parts = {};

  // Setup line: observed temp + the meteorological regime.
  const tF = obs?.temperatureC != null ? Math.round((obs.temperatureC * 9) / 5 + 32) : null;
  const where = location?.name || 'the selected location';
  parts.setup =
    `${where}: ` +
    `${tF != null ? `currently ${tF}°F${obs?.textDescription ? ', ' + obs.textDescription.toLowerCase() : ''}. ` : ''}` +
    synthesize(diag);

  // Outlook for the next 18–24h.
  const o = [];
  if (s.maxPoP != null) o.push(`peak precip probability ${Math.round(s.maxPoP)}%`);
  if (s.totalPrecipMm != null && s.totalPrecipMm >= 0.5) o.push(`~${s.totalPrecipMm.toFixed(1)} mm total QPF`);
  if (s.totalSnowCm != null && s.totalSnowCm >= 0.3) o.push(`~${(s.totalSnowCm / 2.54).toFixed(1)}″ snow`);
  if (s.maxGustKmh != null) o.push(`gusts to ${Math.round(MPH(s.maxGustKmh))} mph`);
  parts.outlook =
    o.length > 0
      ? `Over the next ${s.hours || 18} hours: ${o.join(', ')}.`
      : 'The next 18 hours look quiet with no notable precip or wind signal.';

  // Main hazards (Moderate+).
  const sig = (hazards || []).filter((h) => h.level === 'Moderate' || h.level === 'High');
  parts.hazards =
    sig.length > 0
      ? sig.map((h) => `${h.hazard}: ${h.level} (~${h.pct}%)`).join(' · ')
      : 'No elevated derived hazards in the next 18 hours.';

  // Active official alerts.
  parts.alerts =
    alerts && alerts.length > 0
      ? `${alerts.length} active NWS alert${alerts.length > 1 ? 's' : ''}: ${alerts.map((a) => a.event).join(', ')}.`
      : 'No active NWS alerts.';

  // Confidence.
  parts.confidence = confidence ? `Forecast confidence is ${confidence.text}.` : '';

  // What to watch — derive from the top hazard.
  const top = (hazards || []).slice().sort((a, b) => b.pct - a.pct)[0];
  parts.watch = top && top.pct >= 25 ? `Watch: ${top.hazard.toLowerCase()} — ${top.reason}` : 'Watch: nothing pressing; routine conditions.';

  return parts;
}

export function analyze(diag) {
  if (!diag) return { findings: [], synthesis: 'No diagnostics available yet.' };
  const g = diag.gfs || {};
  const d = diag.derived || {};
  const nws = diag.nws || {};

  const findings = [
    instability(g.cape, g.liftedIndex),
    cap(g.cin, g.cape),
    lapseRates(d.lapse700_500, d.lapse850_700),
    moisture(d.pwatIn, d.dewpointDepression),
    mixing(g.blHeight, nws.mixingHeight?.value),
    ventilation(d.ventilationRate),
    fireWeather(nws.hainesIndex?.value, d.dewpointDepression, d.ventilationRate),
  ].filter(Boolean);

  return { findings, synthesis: synthesize(diag) };
}
