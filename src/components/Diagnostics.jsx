import Panel from './Panel.jsx';
import { fmt, windDir } from '../lib/units.js';

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
  const gv = (n, k, d = 0) => (n?.[k] != null ? `${fmt(n[k], d)}` : null);

  return (
    <>
      <div className="diag-section-title">NWS Gridpoint (fire/dispersion)</div>
      <div className="diag-grid">
        <Metric label="Mixing height" value={gv(nws.mixingHeight, 'value')} unit={nws.mixingHeight?.uom} />
        <Metric
          label="Transport wind"
          value={
            nws.transportWindSpeed
              ? `${windDir(nws.transportWindDirection?.value)} ${fmt(nws.transportWindSpeed.value)}`
              : null
          }
          unit={nws.transportWindSpeed?.uom}
        />
        <Metric label="Haines index" value={gv(nws.hainesIndex, 'value')} />
        <Metric label="Prob. of thunder" value={gv(nws.probabilityOfThunder, 'value')} unit={nws.probabilityOfThunder?.uom} />
        <Metric label="Wet-bulb globe T" value={gv(nws.wetBulbGlobeTemperature, 'value', 1)} unit={nws.wetBulbGlobeTemperature?.uom} />
        <Metric label="Dispersion index" value={gv(nws.dispersionIndex, 'value')} unit={nws.dispersionIndex?.uom} />
      </div>

      <div className="diag-section-title">Open-Meteo GFS (thermodynamic)</div>
      <div className="diag-grid">
        <Metric label="CAPE" value={gv(gfs, 'cape')} unit="J/kg" />
        <Metric label="CIN" value={gv(gfs, 'cin')} unit="J/kg" />
        <Metric label="Lifted index" value={gv(gfs, 'liftedIndex', 1)} />
        <Metric label="Precipitable water" value={gv(gfs, 'pwatMm', 1)} unit="mm" />
        <Metric label="Boundary-layer ht" value={gv(gfs, 'blHeight')} unit="m" />
        <Metric label="Freezing level" value={gv(gfs, 'freezingLevel')} unit="m" />
        <Metric label="850 hPa temp" value={gv(gfs, 't850', 1)} unit="°C" />
        <Metric label="700 hPa temp" value={gv(gfs, 't700', 1)} unit="°C" />
        <Metric label="500 hPa temp" value={gv(gfs, 't500', 1)} unit="°C" />
        <Metric label="850 hPa height" value={gv(gfs, 'z850')} unit="m" />
        <Metric label="700 hPa height" value={gv(gfs, 'z700')} unit="m" />
        <Metric label="500 hPa height" value={gv(gfs, 'z500')} unit="m" />
      </div>

      <div className="diag-section-title">Derived (computed in-app)</div>
      <div className="diag-grid">
        <Metric label="850–700 lapse rate" value={gv(derived, 'lapse850_700', 1)} unit="°C/km" />
        <Metric label="700–500 lapse rate" value={gv(derived, 'lapse700_500', 1)} unit="°C/km" />
        <Metric label="Dewpoint depression" value={gv(derived, 'dewpointDepression', 1)} unit="°C" />
        <Metric label="PWAT" value={gv(derived, 'pwatIn', 2)} unit="in" />
        <Metric label="Ventilation rate" value={gv(derived, 'ventilationRate')} unit="m²/s" />
      </div>
      {gfs?.validTime && (
        <div className="obs-note">GFS valid {gfs.validTime.replace('T', ' ')} (local)</div>
      )}
    </>
  );
}
