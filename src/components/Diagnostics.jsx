import Panel from './Panel.jsx';
import { fmt, windDir, cToF, kmhToMph, mmToIn, deltaCToF, feet } from '../lib/units.js';

// Diagnostic parameters from NWS gridpoint + Open-Meteo GFS, plus in-app
// derived values. `diag` is the output of computeDiagnostics(); `loading` /
// `error` reflect the combined grid+gfs fetch state.
export default function Diagnostics({ diag, loading, error }) {
  return (
    <Panel title="Diagnostic Parameters" sub="NWS gridpoint · Open-Meteo GFS · derived">
      {loading && !diag ? (
        <div className="state"><span className="spinner" /> Loading…</div>
      ) : error && !diag ? (
        <div className="state error">⚠ {String(error)}</div>
      ) : !diag ? (
        <div className="state">No data.</div>
      ) : (
        <Body diag={diag} />
      )}
    </Panel>
  );
}

function Metric({ label, value, unit, na }) {
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
    </div>
  );
}

function Body({ diag }) {
  const { nws, gfs, derived } = diag;
  // Imperial display helpers (all underlying math stays SI; we convert here).
  const tempF = (c, d = 0) => (c != null ? fmt(cToF(c), d) : null);
  const wbgt = nws.wetBulbGlobeTemperature;
  const wbgtF = wbgt?.value == null ? null : wbgt.uom === '°F' ? fmt(wbgt.value, 1) : fmt(cToF(wbgt.value), 1);

  return (
    <>
      <div className="diag-section-title">NWS Gridpoint (fire/dispersion)</div>
      <div className="diag-grid">
        <Metric label="Mixing height" value={feet(nws.mixingHeight?.value)} unit="ft" />
        <Metric
          label="Transport wind"
          value={
            nws.transportWindSpeed
              ? `${windDir(nws.transportWindDirection?.value)} ${fmt(kmhToMph(nws.transportWindSpeed.value))}`
              : null
          }
          unit="mph"
        />
        <Metric label="Haines index" value={nws.hainesIndex?.value != null ? fmt(nws.hainesIndex.value) : null} />
        <Metric label="Prob. of thunder" value={nws.probabilityOfThunder?.value != null ? fmt(nws.probabilityOfThunder.value) : null} unit="%" />
        <Metric label="Wet-bulb globe T" value={wbgtF} unit="°F" />
        <Metric label="Dispersion index" value={nws.dispersionIndex?.value != null ? fmt(nws.dispersionIndex.value) : null} />
      </div>

      <div className="diag-section-title">Open-Meteo GFS (thermodynamic)</div>
      <div className="diag-grid">
        <Metric label="CAPE" value={gfs.cape != null ? fmt(gfs.cape) : null} unit="J/kg" />
        <Metric label="CIN" value={gfs.cin != null ? fmt(gfs.cin) : null} unit="J/kg" />
        <Metric label="Lifted index" value={gfs.liftedIndex != null ? fmt(gfs.liftedIndex, 1) : null} />
        <Metric label="Precipitable water" value={gfs.pwatMm != null ? fmt(mmToIn(gfs.pwatMm), 2) : null} unit="in" />
        <Metric label="Boundary-layer ht" value={feet(gfs.blHeight)} unit="ft" />
        <Metric label="Freezing level" value={feet(gfs.freezingLevel)} unit="ft" />
        <Metric label="850 hPa temp" value={tempF(gfs.t850, 1)} unit="°F" />
        <Metric label="700 hPa temp" value={tempF(gfs.t700, 1)} unit="°F" />
        <Metric label="500 hPa temp" value={tempF(gfs.t500, 1)} unit="°F" />
        <Metric label="850 hPa height" value={feet(gfs.z850)} unit="ft" />
        <Metric label="700 hPa height" value={feet(gfs.z700)} unit="ft" />
        <Metric label="500 hPa height" value={feet(gfs.z500)} unit="ft" />
      </div>

      <div className="diag-section-title">Derived (computed in-app)</div>
      <div className="diag-grid">
        <Metric label="850–700 lapse rate" value={derived.lapse850_700 != null ? fmt(derived.lapse850_700, 1) : null} unit="°C/km" />
        <Metric label="700–500 lapse rate" value={derived.lapse700_500 != null ? fmt(derived.lapse700_500, 1) : null} unit="°C/km" />
        <Metric label="Dewpoint depression" value={derived.dewpointDepression != null ? fmt(deltaCToF(derived.dewpointDepression), 1) : null} unit="°F" />
        <Metric label="PWAT" value={derived.pwatIn != null ? fmt(derived.pwatIn, 2) : null} unit="in" />
        <Metric label="Ventilation rate" value={derived.ventilationRate != null ? fmt(derived.ventilationRate) : null} unit="m²/s" />
      </div>
      {gfs?.validTime && (
        <div className="obs-note">GFS valid {gfs.validTime.replace('T', ' ')} (local)</div>
      )}
    </>
  );
}
