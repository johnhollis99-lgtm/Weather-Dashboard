import Panel, { ResourceState } from './Panel.jsx';
import Sparkline from './Sparkline.jsx';
import WindDial from './WindDial.jsx';
import { displayParts, kmhToMs, windDir, localTime } from '../lib/units.js';
import { useUnits } from '../lib/unitsContext.jsx';
import { tempFill, textSafeOn } from '../lib/palette.js';
import { seriesAround } from '../lib/series.js';

// The card these values sit on — the reference background for any contrast
// decision made at runtime (see the headline tint below).
const CARD_BG = '#1a202a';

// Current conditions. Headline number is the ACTUAL OBSERVED temperature from
// the nearest reporting station — not the hour-0 forecast.
//
// Units policy: every value here is held in SI and formatted through the
// per-quantity registry in units.js, so the header's °F·ft / °C·m toggle
// governs temperature, wind, pressure AND visibility. (This panel previously
// hardcoded °F and mph, silently ignoring the toggle.)
export default function CurrentConditions({ obs, forecast, points, gfs }) {
  const meta = points?.data;
  const sub = meta ? `${meta.city ?? ''}${meta.state ? ', ' + meta.state : ''}` : '';
  const cond = forecast?.data?.[0];

  return (
    <Panel title="Current Conditions" sub={sub} kind="official">
      <ResourceState resource={obs}>
        {obs?.data && <Body o={obs.data} cond={cond} gfs={gfs} />}
      </ResourceState>
    </Panel>
  );
}

function Body({ o, cond, gfs }) {
  const { system } = useUnits();
  const km = o.stationDistanceKm;
  const temp = displayParts('temperature', o.temperatureC, system);
  const g = gfs?.data;

  // Trailing 24 h for each stat that has hourly history. Model series, since
  // observations are single-valued — labelled as such in the sparkline title.
  const tTrend = seriesAround(g, 'temperature_2m');
  const dTrend = seriesAround(g, 'dewpoint_2m');
  const hTrend = seriesAround(g, 'relative_humidity_2m');
  const wTrend = seriesAround(g, 'wind_speed_10m');
  const pTrend = seriesAround(g, 'surface_pressure');

  // The headline may carry its own ramp color, but ONLY where that specific
  // stop is legible as text on this card — the ramp fails at both extremes, and
  // tinting unconditionally would make the most extreme readings the least
  // readable. Everything else falls back to --ink-value.
  const headlineTint = textSafeOn(tempFill(o.temperatureC), CARD_BG, 4.5);

  return (
    <>
      <div className="cc-main">
        {/* Signature: the station model. Sky cover in the centre disc, wind
            barb on its shaft, temperature upper-left, dewpoint lower-left —
            the plotting convention every forecaster already reads. */}
        <StationModel o={o} system={system} />
        <div className="cc-headline">
          <div className="cc-temp" style={headlineTint ? { color: headlineTint } : undefined}>
            {temp.num}
            <span className="cc-temp-unit">{temp.unit}</span>
          </div>
          <div className="cc-spark-slot">
            {tTrend && (
              <Sparkline
                values={tTrend.values}
                nowIndex={tTrend.nowIndex}
                label="Temperature, past 24 h (model)"
                tint={tempFill(o.temperatureC)}
                height={30}
              />
            )}
          </div>
          <div className="cc-cond">{o.textDescription || cond?.shortForecast || '—'}</div>
        </div>

        {/* Circular data gets a dial. Numbers stay as text inside it. */}
        <WindDial
          speedKmh={o.windSpeedKmh}
          dirDeg={o.windDir}
          gustKmh={o.windGustKmh}
          system={system}
        />
      </div>

      <div className="cc-grid">
        <Row
          k="Temperature"
          q="temperature"
          si={o.temperatureC}
          system={system}
          src={o.fieldSources?.temperatureC}
          spark={tTrend}
          sparkTint={tempFill(o.temperatureC)}
          sparkLabel="Temperature, past 24 h"
        />
        <Row
          k="Dewpoint"
          q="temperature"
          si={o.dewpointC}
          system={system}
          src={o.fieldSources?.dewpointC}
          spark={dTrend}
          sparkTint={tempFill(o.dewpointC)}
          sparkLabel="Dewpoint, past 24 h"
        />
        <Row
          k="Humidity"
          plain={o.humidity != null ? `${Math.round(o.humidity)}%` : null}
          src={o.fieldSources?.humidity}
          spark={hTrend}
          sparkLabel="Relative humidity, past 24 h"
        />
        <Row
          k="Wind"
          plain={
            o.windSpeedKmh != null
              ? `${windDir(o.windDir)} ${displayParts('windSurface', kmhToMs(o.windSpeedKmh), system).text}`
              : null
          }
          src={o.fieldSources?.windSpeedKmh}
          spark={wTrend}
          sparkLabel="Wind speed, past 24 h"
        />
        <Row
          k="Pressure"
          q="pressureSurface"
          si={o.pressurePa}
          system={system}
          src={o.fieldSources?.pressurePa}
          spark={pTrend}
          sparkLabel="Surface pressure, past 24 h (model)"
        />
        <Row k="Visibility" q="visibility" si={o.visibilityM} system={system} src={o.fieldSources?.visibilityM} />
      </div>

      <div className="obs-note">
        Observed at {o.station}
        {km != null ? ` · ${km < 10 ? km.toFixed(1) : Math.round(km)} km` : ''} ·{' '}
        {localTime(o.timestamp, { hour: 'numeric', minute: '2-digit' })}
        {o.stationRank > 0 && (
          <>
            {' '}
            · {o.stationRank} nearer station{o.stationRank > 1 ? 's' : ''} had no usable observation
          </>
        )}
      </div>

      {/* Per-field sourcing. When no single nearby station publishes the whole
          picture we composite, and the panel must say so rather than implying
          one station reported everything. */}
      {o.composited && (
        <div className="obs-note cc-composite">
          Composited from {o.stationsUsed.length} stations —{' '}
          {o.stationsUsed
            .map((s) => `${s.id}${s.distanceKm != null ? ` ${Math.round(s.distanceKm)} km` : ''}`)
            .join(', ')}
          . Fields marked <span className="cc-src">⇱</span> came from a station other than {o.station}.
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Station model — meteorology's own glyph, five variables in one mark.
// ---------------------------------------------------------------------------
// Sky cover is drawn as the classic filled fraction of the centre disc; the
// wind barb extends FROM the disc toward the direction the wind is coming from,
// with standard 10 kt full barbs and 5 kt half barbs.
function StationModel({ o, system }) {
  const t = displayParts('temperature', o.temperatureC, system);
  const td = displayParts('temperature', o.dewpointC, system);
  const knots = o.windSpeedKmh == null ? null : o.windSpeedKmh * 0.539957;
  const dir = o.windDir;
  const cover = skyCover(o.textDescription);

  const cx = 52;
  const cy = 44;
  const r = 13;

  return (
    <svg className="station-model" viewBox="0 0 104 88" role="img" aria-label={stationModelLabel(o, t, td)}>
      <title>{stationModelLabel(o, t, td)}</title>
      {/* Sky-cover disc */}
      <circle cx={cx} cy={cy} r={r} className="sm-disc" />
      {cover === 'overcast' && <circle cx={cx} cy={cy} r={r} className="sm-fill" />}
      {cover === 'broken' && <path d={arcWedge(cx, cy, r, 270)} className="sm-fill" />}
      {cover === 'scattered' && <path d={arcWedge(cx, cy, r, 180)} className="sm-fill" />}
      {cover === 'few' && <path d={arcWedge(cx, cy, r, 90)} className="sm-fill" />}
      {cover !== 'clear' && <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} className="sm-divider" />}

      {/* Wind barb */}
      {knots != null && dir != null && knots >= 1 && <WindBarb cx={cx} cy={cy} r={r} dir={dir} knots={knots} />}
      {knots != null && knots < 1 && <circle cx={cx} cy={cy} r={r + 5} className="sm-calm" />}

      {/* Temperature upper-left, dewpoint lower-left — plotting convention */}
      <text x={cx - r - 6} y={cy - 6} className="sm-temp" textAnchor="end">
        {t.num}
      </text>
      <text x={cx - r - 6} y={cy + 16} className="sm-dew" textAnchor="end">
        {td.num}
      </text>
    </svg>
  );
}

function stationModelLabel(o, t, td) {
  return `Station model: temperature ${t.text}, dewpoint ${td.text}, ${
    o.windSpeedKmh != null ? `wind ${windDir(o.windDir)} ` : ''
  }${o.textDescription ? `, sky ${o.textDescription}` : ''}`;
}

function skyCover(text) {
  const s = (text || '').toLowerCase();
  if (!s) return 'unknown';
  if (/overcast/.test(s)) return 'overcast';
  if (/mostly cloudy|broken/.test(s)) return 'broken';
  if (/partly (cloudy|sunny)|scattered/.test(s)) return 'scattered';
  if (/mostly (clear|sunny)|few/.test(s)) return 'few';
  if (/clear|sunny|fair/.test(s)) return 'clear';
  return 'unknown';
}

// A pie wedge from 12 o'clock, clockwise, `deg` wide.
function arcWedge(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);
  const large = deg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x} ${y} Z`;
}

// Standard barb: shaft points INTO the wind, 10 kt full barbs, 5 kt half.
function WindBarb({ cx, cy, r, dir, knots }) {
  const len = 26;
  const rad = ((dir - 90) * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const x0 = cx + ux * r;
  const y0 = cy + uy * r;
  const x1 = cx + ux * (r + len);
  const y1 = cy + uy * (r + len);

  const marks = [];
  let remaining = Math.round(knots / 5) * 5;
  let pos = r + len;
  const px = -uy; // perpendicular
  const py = ux;
  const step = 5;
  while (remaining >= 10 && pos > r + 6) {
    marks.push(
      <line
        key={`f${pos}`}
        x1={cx + ux * pos}
        y1={cy + uy * pos}
        x2={cx + ux * (pos - 3) + px * 9}
        y2={cy + uy * (pos - 3) + py * 9}
        className="sm-barb"
      />,
    );
    remaining -= 10;
    pos -= step;
  }
  if (remaining >= 5 && pos > r + 4) {
    marks.push(
      <line
        key="h"
        x1={cx + ux * pos}
        y1={cy + uy * pos}
        x2={cx + ux * (pos - 2) + px * 5}
        y2={cy + uy * (pos - 2) + py * 5}
        className="sm-barb"
      />,
    );
  }
  return (
    <>
      <line x1={x0} y1={y0} x2={x1} y2={y1} className="sm-barb" />
      {marks}
    </>
  );
}

// `src` names the station a value was composited from (or "derived from RH").
// `spark` is a {values, nowIndex} window from series.js — every stat that has
// hourly history carries one, so a number is never shown without its trend.
function Row({ k, q, si, system, plain, src, spark, sparkTint, sparkLabel }) {
  const parts = q ? displayParts(q, si, system) : null;
  const empty = plain == null && (parts == null || parts.num === '—');
  return (
    <div className="cc-row">
      <span className="k">{k}</span>
      <span className="v">
        {empty ? (
          <span className="cc-na">—</span>
        ) : plain != null ? (
          plain
        ) : (
          <>
            {parts.num}
            {parts.unit ? <span className="m-unit"> {parts.unit}</span> : null}
          </>
        )}
        {src ? (
          <span className="cc-src" title={`from ${src}`} aria-label={`from ${src}`}>
            {' '}
            ⇱
          </span>
        ) : null}
      </span>
      {/* Fixed-height slot whether or not a sparkline lands in it, so the row
          height is identical before and after data arrives — no shift on the
          5-minute refresh. Hidden below 700px to keep phone rows compact. */}
      <span className="cc-row-spark">
        {spark && !empty && (
          <Sparkline values={spark.values} nowIndex={spark.nowIndex} label={sparkLabel} tint={sparkTint} height={18} />
        )}
      </span>
    </div>
  );
}
