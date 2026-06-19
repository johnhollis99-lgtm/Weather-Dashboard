import Panel, { ResourceState } from './Panel.jsx';
import { pickGridValue, nearestHourIndex } from '../lib/diagnostics.js';
import { fmt, mToFt } from '../lib/units.js';
import { TAHOE_LAKE_FT, TAHOE_PASSES, isTahoeArea } from '../lib/locations.js';

// Snowfall, snow depth, and snow/freezing level — Open-Meteo GFS hourly + NWS
// gridpoint snowfallAmount/snowLevel. For Tahoe, compares snow level to lake
// level (6,225 ft) and the major passes.
export default function Snow({ gfs, grid, location }) {
  const data = gfs?.data;
  let body = null;

  if (data?.hourly?.time?.length) {
    const h = data.hourly;
    const i = nearestHourIndex(h.time, data.utc_offset_seconds);
    const i18 = Math.min(h.time.length, i + 18);

    const snow18cm = (h.snowfall || []).slice(i, i18).reduce((a, b) => a + (b || 0), 0);
    const depthM = h.snow_depth?.[i] ?? null;
    const fzM = h.freezing_level_height?.[i] ?? null;

    // Daily snowfall totals (cm) from the model.
    const daily = {};
    for (let k = 0; k < h.time.length; k++) {
      const day = h.time[k].slice(0, 10);
      daily[day] = (daily[day] || 0) + (h.snowfall?.[k] || 0);
    }
    const days = Object.entries(daily).filter(([, v]) => v > 0.05);

    // NWS gridpoint snow fields.
    const snowLevel = grid?.data ? pickGridValue(grid.data, 'snowLevel') : null;
    const snowAmt = grid?.data ? pickGridValue(grid.data, 'snowfallAmount') : null;

    // Snow level (ft) — prefer NWS snowLevel, fall back to GFS freezing level.
    const snowLevelFt = snowLevel?.value != null ? mToFt(snowLevel.value) : fzM != null ? mToFt(fzM) : null;
    const snowLevelSrc = snowLevel?.value != null ? 'NWS snow level' : 'GFS freezing level (proxy)';

    body = (
      <>
        <div className="diag-grid">
          <Metric label="Snow next 18h" value={fmt(snow18cm / 2.54, 1)} unit="in" />
          <Metric label="Current snow depth" value={depthM != null ? fmt(depthM * 39.37, 1) : null} unit="in" />
          <Metric label="Snow level" value={snowLevelFt != null ? Math.round(snowLevelFt).toLocaleString() : null} unit="ft" sub={snowLevelSrc} />
          <Metric label="Freezing level" value={fzM != null ? Math.round(mToFt(fzM)).toLocaleString() : null} unit="ft" />
          <Metric label="NWS snowfall (period)" value={snowAmt?.value != null ? fmt(snowAmt.value / 25.4, 1) : null} unit="in" />
        </div>

        {days.length > 0 && (
          <>
            <div className="diag-section-title">Daily snowfall (GFS)</div>
            <div className="diag-grid">
              {days.map(([day, cm]) => (
                <Metric
                  key={day}
                  label={new Date(day + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                  value={fmt(cm / 2.54, 1)}
                  unit="in"
                />
              ))}
            </div>
          </>
        )}

        {isTahoeArea(location.lat, location.lon) && snowLevelFt != null && (
          <>
            <div className="diag-section-title">Tahoe snow-level context</div>
            <div className="snow-context">
              <SnowRow name={`Lake level (${TAHOE_LAKE_FT.toLocaleString()} ft)`} ft={TAHOE_LAKE_FT} snowLevelFt={snowLevelFt} />
              {TAHOE_PASSES.map((p) => (
                <SnowRow key={p.name} name={`${p.name} (${p.ft.toLocaleString()} ft)`} ft={p.ft} snowLevelFt={snowLevelFt} />
              ))}
            </div>
            <div className="obs-note">Snow level ≈ {Math.round(snowLevelFt).toLocaleString()} ft: locations at/above it see snow; below it, rain.</div>
          </>
        )}
      </>
    );
  }

  return (
    <Panel title="Snow" sub="Open-Meteo GFS + NWS gridpoint">
      <ResourceState resource={gfs}>{body}</ResourceState>
    </Panel>
  );
}

function Metric({ label, value, unit, sub }) {
  if (value == null) {
    return (
      <div className="metric na">
        <div className="m-label">{label}</div>
        <div className="m-value">n/a</div>
      </div>
    );
  }
  return (
    <div className="metric">
      <div className="m-label">{label}</div>
      <div className="m-value">{value}{unit ? <span className="m-unit"> {unit}</span> : null}</div>
      {sub ? <div className="m-sub">{sub}</div> : null}
    </div>
  );
}

function SnowRow({ name, ft, snowLevelFt }) {
  const snow = snowLevelFt <= ft;
  return (
    <div className="snow-row">
      <span>{name}</span>
      <span className={snow ? 'tag-snow' : 'tag-rain'}>{snow ? '❄ snow' : '🌧 rain'}</span>
    </div>
  );
}
