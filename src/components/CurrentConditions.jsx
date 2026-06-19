import Panel, { ResourceState } from './Panel.jsx';
import { tempBoth, fmt, windDir, kmhToMph, localTime } from '../lib/units.js';

// Current conditions. Headline number is the ACTUAL OBSERVED temperature from
// the nearest station's latest observation — not the hour-0 forecast.
export default function CurrentConditions({ obs, forecast, points }) {
  const meta = points?.data;
  const sub = meta ? `${meta.city ?? ''}${meta.state ? ', ' + meta.state : ''}` : '';
  const cond = forecast?.data?.[0];

  return (
    <Panel title="Current Conditions" sub={sub}>
      <ResourceState resource={obs}>
        {obs?.data && <Body o={obs.data} cond={cond} />}
      </ResourceState>
    </Panel>
  );
}

function Body({ o, cond }) {
  return (
    <>
      <div className="cc-main">
        <div className="cc-temp">{fmt(cToFsafe(o.temperatureC))}°</div>
        <div>
          <div className="cc-cond">{o.textDescription || cond?.shortForecast || '—'}</div>
          <div className="obs-note">Observed at {o.station} · {localTime(o.timestamp, { hour: 'numeric', minute: '2-digit' })}</div>
        </div>
      </div>
      <div className="cc-grid">
        <Row k="Temperature" v={tempBoth(o.temperatureC)} />
        <Row k="Dewpoint" v={tempBoth(o.dewpointC)} />
        <Row k="Humidity" v={o.humidity != null ? `${fmt(o.humidity)}%` : '—'} />
        <Row
          k="Wind"
          v={
            o.windSpeedKmh != null
              ? `${windDir(o.windDir)} ${fmt(kmhToMph(o.windSpeedKmh))} mph`
              : '—'
          }
        />
      </div>
    </>
  );
}

const cToFsafe = (c) => (c == null ? null : (c * 9) / 5 + 32);

function Row({ k, v }) {
  return (
    <div className="cc-row">
      <span className="k">{k}</span>
      <span>{v}</span>
    </div>
  );
}
