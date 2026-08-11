import Panel from './Panel.jsx';
import { analyze } from '../lib/analysis.js';

// Meteorological analysis — interprets the diagnostics into plain language.
//
// `sum` (18-hour summary) and `location` are not optional in spirit: they carry
// the LIFT and SEASONAL-MOISTURE ingredients that gate every precipitation
// sentence. Without them the engine falls back to "lift unknown" and withholds
// rainfall claims rather than guessing.
export default function Analysis({ diag, sum, location, loading, error }) {
  const result = diag ? analyze(diag, sum, location) : null;

  return (
    <Panel title="Meteorological Analysis" sub="rule-based interpretation of the raw numbers">
      {loading && !diag ? (
        <div className="state"><span className="spinner" /> Loading…</div>
      ) : error && !diag ? (
        <div className="state error">⚠ {String(error)}</div>
      ) : !result ? (
        <div className="state">No data.</div>
      ) : (
        <>
          <div className="synthesis">{result.synthesis}</div>
          {result.findings.map((f, i) => (
            <div className={`finding ${f.level}`} key={i}>
              <div className="f-title">{f.title}</div>
              <div>{f.text}</div>
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}
