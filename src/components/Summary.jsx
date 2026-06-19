// Top-of-dashboard written briefing — synthesizes everything into a short,
// plain-language read. Fed by the rule-based analysis engine (briefing()).
export default function Summary({ briefing, loading, error }) {
  return (
    <section className="panel summary-panel">
      <div className="panel-head">
        <span className="panel-title">📋 Briefing</span>
        <span className="panel-sub">Claude's interpretation — what's happening, what's next, why</span>
      </div>
      <div className="panel-body">
        {loading && !briefing ? (
          <div className="state"><span className="spinner" /> Building briefing…</div>
        ) : error && !briefing ? (
          <div className="state error">⚠ {String(error)}</div>
        ) : !briefing ? (
          <div className="state">Awaiting data…</div>
        ) : (
          <div className="briefing">
            <p className="brief-setup">{briefing.setup}</p>
            <div className="brief-grid">
              <Block label="Next 18–24 h" text={briefing.outlook} />
              <Block label="Main hazards (derived)" text={briefing.hazards} />
              <Block label="Active alerts" text={briefing.alerts} />
              <Block label="Forecast confidence" text={briefing.confidence} />
            </div>
            <p className="brief-watch">{briefing.watch}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function Block({ label, text }) {
  if (!text) return null;
  return (
    <div className="brief-block">
      <div className="brief-label">{label}</div>
      <div className="brief-text">{text}</div>
    </div>
  );
}
