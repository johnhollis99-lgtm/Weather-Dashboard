import Panel from './Panel.jsx';
import { analyze } from '../lib/analysis.js';

// Meteorological analysis — interprets the diagnostics into plain language.
export default function Analysis({ diag, loading, error }) {
  const result = diag ? analyze(diag) : null;

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
