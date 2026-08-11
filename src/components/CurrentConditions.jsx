import Panel, { ResourceState } from './Panel.jsx';
import { cToF, fmt, windDir, kmhToMph, localTime } from '../lib/units.js';

const degF = (c) => (c == null ? '—' : `${fmt(cToF(c))}°F`);

// Current conditions. Headline number is the ACTUAL OBSERVED temperature from
// the nearest reporting station — not the hour-0 forecast.
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

// Pa → inches of mercury (the conventional US surface-pressure unit).
const inHg = (pa) => (pa == null ? null : pa / 3386.389);
// m → statute miles, NWS visibility convention.
const miles = (m) => (m == null ? null : m / 1609.344);

function Body({ o, cond }) {
  const km = o.stationDistanceKm;
  return (
    <>
      <div className="cc-main">
        <div className="cc-temp">{fmt(cToFsafe(o.temperatureC))}°</div>
        <div>
          <div className="cc-cond">{o.textDescription || cond?.shortForecast || '—'}</div>
          <div className="obs-note">
            Observed at {o.station}
            {km != null ? ` (${km < 10 ? km.toFixed(1) : Math.round(km)} km)` : ''} ·{' '}
            {localTime(o.timestamp, { hour: 'numeric', minute: '2-digit' })}
            {o.stationRank > 0 && (
              <>
                {' '}
                · {o.stationRank} nearer station{o.stationRank > 1 ? 's' : ''} had no usable observation
              </>
            )}
          </div>
        </div>
      </div>
      <div className="cc-grid">
        <Row k="Temperature" v={degF(o.temperatureC)} src={o.fieldSources?.temperatureC} />
        <Row k="Dewpoint" v={degF(o.dewpointC)} src={o.fieldSources?.dewpointC} />
        <Row k="Humidity" v={o.humidity != null ? `${fmt(o.humidity)}%` : '—'} src={o.fieldSources?.humidity} />
        <Row
          k="Wind"
          v={
            o.windSpeedKmh != null
              ? `${windDir(o.windDir)} ${fmt(kmhToMph(o.windSpeedKmh))} mph`
              : '—'
          }
          src={o.fieldSources?.windSpeedKmh}
        />
        <Row
          k="Pressure"
          v={o.pressurePa != null ? `${fmt(inHg(o.pressurePa), 2)} inHg` : '—'}
          src={o.fieldSources?.pressurePa}
        />
        <Row
          k="Visibility"
          v={o.visibilityM != null ? `${fmt(miles(o.visibilityM), 1)} mi` : '—'}
          src={o.fieldSources?.visibilityM}
        />
      </div>
      {/* Per-field sourcing disclosure. When no single nearby station publishes
          the whole picture we composite, and the panel must say so rather than
          implying one station reported everything. */}
      {o.composited && (
        <div className="obs-note cc-composite">
          Composited from {o.stationsUsed.length} stations —{' '}
          {o.stationsUsed
            .map((s) => `${s.id}${s.distanceKm != null ? ` ${Math.round(s.distanceKm)} km` : ''}`)
            .join(', ')}
          . Fields marked ⇱ came from a station other than {o.station}.
        </div>
      )}
    </>
  );
}

const cToFsafe = (c) => (c == null ? null : (c * 9) / 5 + 32);

// `src` names the station a value was composited from (or "derived from RH").
// Marked inline so a mixed-station panel is honest field by field, not just in
// the footnote.
function Row({ k, v, src }) {
  return (
    <div className="cc-row">
      <span className="k">{k}</span>
      <span>
        {v}
        {src ? (
          <span className="cc-src" title={`from ${src}`} aria-label={`from ${src}`}>
            {' '}
            ⇱
          </span>
        ) : null}
      </span>
    </div>
  );
}
