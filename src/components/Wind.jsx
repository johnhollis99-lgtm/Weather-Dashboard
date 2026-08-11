import Panel, { ResourceState } from './Panel.jsx';
import Sparkline from './Sparkline.jsx';
import { pickGridValue, nearestHourIndex } from '../lib/diagnostics.js';
import { fmt, kmhToMph, windDir, wallHour } from '../lib/units.js';
import { seriesAround } from '../lib/series.js';

// Wind: NWS gridpoint + Open-Meteo 10m winds/gusts, transport wind, 500 mb wind,
// an 18-hour gust timeline, and wind-advisory-threshold flags.
function advisory(maxGustMph, maxSustainedMph) {
  if (maxGustMph >= 58 || maxSustainedMph >= 40)
    return { level: 'warn', text: 'High Wind Warning criteria (gusts ≥58 mph / sustained ≥40 mph)' };
  if (maxGustMph >= 46 || maxSustainedMph >= 31)
    return { level: 'watch', text: 'Wind Advisory criteria (gusts ≥46 mph / sustained ≥31 mph)' };
  return null;
}

export default function Wind({ gfs, grid, diag }) {
  const data = gfs?.data;
  let body = null;

  if (data?.hourly?.time?.length) {
    const h = data.hourly;
    const i = nearestHourIndex(h.time, data.utc_offset_seconds);
    const i18 = Math.min(h.time.length, i + 18);
    const gustSeries = h.wind_gusts_10m || [];
    const next18 = [];
    for (let k = i; k < i18; k++) next18.push({ t: h.time[k], gust: gustSeries[k], spd: h.wind_speed_10m?.[k] });

    const maxGustMph = kmhToMph(Math.max(...next18.map((x) => x.gust || 0)));
    const maxSustainedMph = kmhToMph(Math.max(...next18.map((x) => x.spd || 0)));
    const adv = advisory(maxGustMph, maxSustainedMph);
    const gmax = Math.max(...next18.map((x) => x.gust || 0), 1);

    // NWS gridpoint surface wind.
    const nSpd = grid?.data ? pickGridValue(grid.data, 'windSpeed') : null;
    const nGust = grid?.data ? pickGridValue(grid.data, 'windGust') : null;
    const nDir = grid?.data ? pickGridValue(grid.data, 'windDirection') : null;

    // Trailing 24 h for the stat cards that have hourly history (mph, so the
    // sparkline shape matches the number above it).
    const spdTrend = seriesAround(data, 'wind_speed_10m', 24, kmhToMph);
    const gustTrend = seriesAround(data, 'wind_gusts_10m', 24, kmhToMph);
    const w500Trend = seriesAround(data, 'wind_speed_500hPa', 24, kmhToMph);

    // From diagnostics: transport wind + 500 mb wind.
    const tws = diag?.nws?.transportWindSpeed;
    const twd = diag?.nws?.transportWindDirection;
    const w500 = diag?.gfs?.windSpeed500;
    const d500 = diag?.gfs?.windDir500;

    body = (
      <>
        {adv && <div className={`finding ${adv.level}`} style={{ marginBottom: 12 }}><div className="f-title">⚠ {adv.text}</div></div>}
        <div className="diag-grid">
          <Metric label="Surface wind (Open-Meteo)" value={data.hourly.wind_speed_10m?.[i] != null ? `${windDir(h.wind_direction_10m?.[i])} ${fmt(kmhToMph(h.wind_speed_10m[i]))}` : null} unit="mph" spark={spdTrend} sparkLabel="Surface wind, past 24 h" />
          <Metric label="Surface gust (Open-Meteo)" value={h.wind_gusts_10m?.[i] != null ? fmt(kmhToMph(h.wind_gusts_10m[i])) : null} unit="mph" spark={gustTrend} sparkLabel="Surface gusts, past 24 h" />
          <Metric label="Surface wind (NWS)" value={nSpd?.value != null ? `${windDir(nDir?.value)} ${fmt(kmhToMph(nSpd.value))}` : null} unit="mph" />
          <Metric label="Wind gust (NWS)" value={nGust?.value != null ? fmt(kmhToMph(nGust.value)) : null} unit="mph" />
          <Metric label="Transport wind" value={tws?.value != null ? `${windDir(twd?.value)} ${fmt(kmhToMph(tws.value))}` : null} unit="mph" />
          <Metric label="500 mb wind" value={w500 != null ? `${windDir(d500)} ${fmt(kmhToMph(w500))}` : null} unit="mph" spark={w500Trend} sparkLabel="500 mb wind, past 24 h" />
        </div>

        <div className="diag-section-title">Next 18 hours — gusts (mph)</div>
        <div className="hourly">
          {next18.map((x, k) => {
            const mph = kmhToMph(x.gust);
            const advHr = mph >= 46;
            return (
              <div className="hour" key={k}>
                <div className="h-time">{wallHour(x.t)}</div>
                <div className="h-temp" style={advHr ? { color: 'var(--warn)' } : null}>{fmt(mph)}</div>
                <div className="h-bar" style={{ width: `${20 + ((x.gust || 0) / gmax) * 80}%`, marginInline: 'auto', background: advHr ? 'var(--warn)' : 'var(--accent)' }} />
              </div>
            );
          })}
        </div>
        <div className="obs-note">Peak next-18h: gusts {fmt(maxGustMph)} mph, sustained {fmt(maxSustainedMph)} mph.</div>
      </>
    );
  }

  return (
    <Panel title="Wind" sub="NWS + Open-Meteo · transport · 500 mb">
      <ResourceState resource={gfs}>{body}</ResourceState>
    </Panel>
  );
}

// `spark` is a {values, nowIndex} window from series.js. The slot is rendered
// at a fixed height whether or not a series lands in it, so a card is the same
// height before and after data arrives — no shift on the 5-minute refresh.
function Metric({ label, value, unit, spark, sparkLabel }) {
  if (value == null) {
    return (
      <div className="metric na">
        <div className="m-label">{label}</div>
        <div className="m-value">n/a</div>
        <div className="m-spark" />
      </div>
    );
  }
  return (
    <div className="metric">
      <div className="m-label">{label}</div>
      <div className="m-value">{value}{unit ? <span className="m-unit"> {unit}</span> : null}</div>
      <div className="m-spark">
        {spark && <Sparkline values={spark.values} nowIndex={spark.nowIndex} label={sparkLabel} height={20} />}
      </div>
    </div>
  );
}
