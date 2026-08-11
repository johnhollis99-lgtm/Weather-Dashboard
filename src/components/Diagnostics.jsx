import { useState } from 'react';
import Panel from './Panel.jsx';
import ThresholdChip from './ThresholdChip.jsx';
import { displayParts, kmhToMs, fToC, windDir, fmt } from '../lib/units.js';
import { useUnits } from '../lib/unitsContext.jsx';
import {
  CAPE,
  CIN_MAG,
  LIFTED_INDEX_NEG,
  LAPSE_MID,
  LAPSE_LOW,
  MIXING_HEIGHT,
  HAINES,
  FREEZING_LEVEL,
  PWAT_RATIO,
} from '../lib/thresholds.js';
import { pwatNormalIn } from '../lib/ingredients.js';

// Diagnostic parameters from NWS gridpoint + Open-Meteo GFS, plus in-app
// derived values. `diag` is the output of computeDiagnostics(); `loading` /
// `error` reflect the combined grid+gfs fetch state.
//
// Units policy: every value arrives in SI from computeDiagnostics(); formatting
// is delegated to the per-quantity registry in units.js via the active display
// system, so the °F·ft / °C·m toggle only re-formats — it never recomputes.
export default function Diagnostics({ diag, location, loading, error }) {
  return (
    <Panel title="Diagnostic Parameters" sub="NWS gridpoint · Open-Meteo GFS" kind="derived">
      {loading && !diag ? (
        <div className="state"><span className="spinner" /> Loading…</div>
      ) : error && !diag ? (
        <div className="state error">⚠ {String(error)}</div>
      ) : !diag ? (
        <div className="state">No data.</div>
      ) : (
        <Body diag={diag} location={location} />
      )}
    </Panel>
  );
}

// A registry-formatted quantity. `q` is a units.js quantity key, `si` the value
// in SI (null → "not provided"). `info` adds an ⓘ tooltip on the label.
//
// `bands` (+ optional `bandValue` when the chip should be scored on a derived
// quantity such as percent-of-normal rather than the raw SI value) attaches the
// significance chip that turns this grid into a status board.
function Q({ label, q, si, system, info, bands, bandValue, chipTitle }) {
  if (si == null || Number.isNaN(si)) {
    return (
      <div className="metric na">
        <div className="m-label">{label}</div>
        <div className="m-value">not provided</div>
      </div>
    );
  }
  const { num, unit } = displayParts(q, si, system);
  return (
    <div className="metric">
      <div className="m-label">
        {label}
        {info ? (
          <span className="m-info" title={info} aria-label={info}>
            i
          </span>
        ) : null}
      </div>
      <div className="m-value">
        {num}
        {unit ? <span className="m-unit"> {unit}</span> : null}
      </div>
      {bands && <ThresholdChip value={bandValue ?? si} bands={bands} title={chipTitle} />}
    </div>
  );
}

// A plain (unit-less / as-is) metric — Haines, PoT, dispersion, ventilation.
function Metric({ label, value, unit, na, bands, bandValue, chipTitle }) {
  if (na || value == null) {
    return (
      <div className="metric na">
        <div className="m-label">{label}</div>
        <div className="m-value">not provided</div>
      </div>
    );
  }
  return (
    <div className="metric">
      <div className="m-label">{label}</div>
      <div className="m-value">
        {value}
        {unit ? <span className="m-unit"> {unit}</span> : null}
      </div>
      {bands && bandValue != null && <ThresholdChip value={bandValue} bands={bands} title={chipTitle} />}
    </div>
  );
}

const CAPE_TIP_KEY = 'wx.capeTipSeen';
const CAPE_NOTE =
  'CAPE & CIN stay in J/kg in both unit systems — that is the meteorological convention, ' +
  'so the °F·ft / °C·m toggle intentionally leaves them (and pressure) unchanged.';

function Body({ diag, location }) {
  const { system } = useUnits();
  const { nws, gfs, derived } = diag;

  // PWAT is scored as PERCENT OF SEASONAL NORMAL, not on an absolute scale:
  // 1.23 in is unremarkable in a July coastal-SoCal airmass and exceptional in
  // a January Sierra storm, and one absolute band table cannot say both.
  const pwatNormal = location ? pwatNormalIn(location.lat, location.lon).normalIn : null;
  const pwatRatio =
    pwatNormal && derived.pwatIn != null ? derived.pwatIn / pwatNormal : null;

  // One-time explainer so users don't think CAPE is "stuck" when toggling units.
  const [capeTipSeen, setCapeTipSeen] = useState(() => {
    try {
      return !!localStorage.getItem(CAPE_TIP_KEY);
    } catch {
      return false;
    }
  });
  const dismissCapeTip = () => {
    setCapeTipSeen(true);
    try {
      localStorage.setItem(CAPE_TIP_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  // Wet-bulb globe T arrives with its own uom; normalize to SI °C first.
  const wbgt = nws.wetBulbGlobeTemperature;
  const wbgtC = wbgt?.value == null ? null : wbgt.uom === '°F' ? fToC(wbgt.value) : wbgt.value;

  // Transport wind is km/h from the NWS grid → SI m/s for the registry.
  const transportWindMs = kmhToMs(nws.transportWindSpeed?.value);
  const transportWind =
    transportWindMs == null
      ? null
      : `${windDir(nws.transportWindDirection?.value)} ${displayParts('windSurface', transportWindMs, system).text}`;

  return (
    <>
      <div className="diag-section-title">NWS Gridpoint (fire/dispersion)</div>
      <div className="diag-grid">
        <Q
          label="Mixing height"
          q="height"
          si={nws.mixingHeight?.value}
          system={system}
          bands={MIXING_HEIGHT}
          chipTitle="Dispersion significance — a SHALLOW layer is the notable state"
        />
        <Metric label="Transport wind" value={transportWind} na={transportWind == null} />
        <Metric
          label="Haines index"
          value={nws.hainesIndex?.value != null ? fmt(nws.hainesIndex.value) : null}
          bands={HAINES}
          bandValue={nws.hainesIndex?.value}
          chipTitle="Potential for large fire growth"
        />
        <Metric label="Prob. of thunder" value={nws.probabilityOfThunder?.value != null ? fmt(nws.probabilityOfThunder.value) : null} unit="%" />
        <Q label="Wet-bulb globe T" q="temperature" si={wbgtC} system={system} />
        <Metric label="Dispersion index" value={nws.dispersionIndex?.value != null ? fmt(nws.dispersionIndex.value) : null} />
      </div>

      <div className="diag-section-title">Open-Meteo GFS (thermodynamic)</div>
      <div className="diag-grid">
        <Q label="CAPE" q="cape" si={gfs.cape} system={system} info={CAPE_NOTE} bands={CAPE} />
        <Q
          label="CIN"
          q="cin"
          si={gfs.cin}
          system={system}
          info={CAPE_NOTE}
          bands={CIN_MAG}
          bandValue={gfs.cin == null ? null : Math.abs(gfs.cin)}
          chipTitle="Cap strength — an UNCAPPED column is the notable state"
        />
        <Q
          label="Lifted index"
          q="index"
          si={gfs.liftedIndex}
          system={system}
          bands={LIFTED_INDEX_NEG}
          bandValue={gfs.liftedIndex == null ? null : -gfs.liftedIndex}
        />
        <Q
          label="Precipitable water"
          q="pwat"
          si={gfs.pwatMm}
          system={system}
          bands={PWAT_RATIO}
          bandValue={pwatRatio}
          chipTitle={
            pwatNormal
              ? `Relative to the ${pwatNormal.toFixed(2)} in seasonal normal for this region — PWAT is only meaningful against season and airmass`
              : undefined
          }
        />
        <Q label="Boundary-layer ht" q="height" si={gfs.blHeight} system={system} bands={MIXING_HEIGHT} />
        <Q
          label="Freezing level"
          q="height"
          si={gfs.freezingLevel}
          system={system}
          bands={FREEZING_LEVEL}
          chipTitle="A LOW freezing level is the notable state; read against local terrain"
        />
        <Q label="850 hPa temp" q="temperature" si={gfs.t850} system={system} />
        <Q label="700 hPa temp" q="temperature" si={gfs.t700} system={system} />
        <Q label="500 hPa temp" q="temperature" si={gfs.t500} system={system} />
        <Q label="850 hPa height" q="height" si={gfs.z850} system={system} />
        <Q label="700 hPa height" q="height" si={gfs.z700} system={system} />
        <Q label="500 hPa height" q="height" si={gfs.z500} system={system} />
      </div>
      {!capeTipSeen && (
        <div className="cape-tip">
          <span>{CAPE_NOTE}</span>
          <button type="button" onClick={dismissCapeTip}>
            Got it
          </button>
        </div>
      )}

      <div className="diag-section-title">Derived (computed in-app)</div>
      <div className="diag-grid">
        <Q label="850–700 lapse rate" q="lapseRate" si={derived.lapse850_700} system={system} bands={LAPSE_LOW} />
        <Q label="700–500 lapse rate" q="lapseRate" si={derived.lapse700_500} system={system} bands={LAPSE_MID} />
        <Q label="Dewpoint depression" q="tempDelta" si={derived.dewpointDepression} system={system} />
        <Q label="PWAT" q="pwat" si={gfs.pwatMm} system={system} bands={PWAT_RATIO} bandValue={pwatRatio} />
        <Metric label="Ventilation rate" value={derived.ventilationRate != null ? fmt(derived.ventilationRate) : null} unit="m²/s" />
      </div>
      {gfs?.validTime && (
        <div className="obs-note">GFS valid {gfs.validTime.replace('T', ' ')} (local)</div>
      )}
    </>
  );
}
