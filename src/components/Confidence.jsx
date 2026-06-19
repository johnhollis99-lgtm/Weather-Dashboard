import Panel, { ResourceState } from './Panel.jsx';
import { fmt, mmToIn } from '../lib/units.js';
import { computeEnsembleDays } from '../lib/ensemble.js';

// Forecast confidence from the GFS ensemble: daily precip spread across members.
// Tight spread = high confidence; wide spread = low confidence.
export default function Confidence({ ensemble }) {
  const data = ensemble?.data;
  let body = null;
  if (data?.hourly?.time?.length) {
    const days = computeEnsembleDays(data);
    const globalMax = Math.max(...days.map((d) => d.max), 1);
    const n = days[0]?.n ?? 0;
    body = (
      <>
        <div className="obs-note" style={{ marginBottom: 10 }}>
          GFS ensemble · {n} members · daily precip spread (in)
        </div>
        {days.map((d) => (
          <div className="conf-day" key={d.day}>
            <div className="conf-head">
              <span>{new Date(d.day + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              <span>
                <span className={`conf-tag ${d.conf}`}>{d.conf.toUpperCase()} confidence</span>{' '}
                {fmt(mmToIn(d.mean), 2)}″ avg
              </span>
            </div>
            <div className="conf-bar-track">
              <div
                className="conf-bar-range"
                style={{ left: `${(d.min / globalMax) * 100}%`, width: `${((d.max - d.min) / globalMax) * 100}%` }}
              />
              <div className="conf-bar-mean" style={{ left: `${(d.mean / globalMax) * 100}%` }} />
            </div>
            <div className="obs-note">range {fmt(mmToIn(d.min), 2)}–{fmt(mmToIn(d.max), 2)}″</div>
          </div>
        ))}
      </>
    );
  }
  return (
    <Panel title="Forecast Confidence" sub="Open-Meteo ensemble (gfs_seamless)">
      <ResourceState resource={ensemble}>{body}</ResourceState>
    </Panel>
  );
}
