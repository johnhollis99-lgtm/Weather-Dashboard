// Active NWS alerts.
//
// "No alerts" and "the alerts fetch failed" used to render identically (both
// `return null`), which is the most dangerous silent failure on the dashboard:
// an absent banner reads as "nothing is wrong" when it may mean "we don't
// know". Failure is now stated explicitly; the all-clear is stated quietly.
export default function AlertsBanner({ alerts }) {
  const { data, loading, error } = alerts || {};

  if (error && !data) {
    return (
      <div className="alerts-banner alerts-banner-error">
        <div className="alert-item">
          <span className="alert-event">⚠ Alert feed unavailable</span>
          <span className="alert-sev">
            Could not reach api.weather.gov — this is <strong>not</strong> an all-clear. Check NWS directly.
          </span>
          <div className="alert-desc">{String(error)}</div>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="alerts-banner alerts-banner-quiet">
        <div className="state">
          <span className="spinner" /> Checking for active NWS alerts…
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="alerts-banner alerts-banner-quiet">
        <span className="alerts-clear">✓ No active NWS alerts for this location</span>
      </div>
    );
  }

  return (
    <div className="alerts-banner">
      {data.map((a) => (
        <div className="alert-item" key={a.id}>
          <span className="alert-event">⚠ {a.event}</span>
          <span className="alert-sev">
            {a.severity} · {a.areaDesc}
          </span>
          {a.headline && <div className="alert-desc">{a.headline}</div>}
        </div>
      ))}
    </div>
  );
}
