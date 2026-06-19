// Active NWS alerts banner — only renders when alerts are present.

export default function AlertsBanner({ alerts }) {
  const data = alerts?.data;
  if (!data || data.length === 0) return null;
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
