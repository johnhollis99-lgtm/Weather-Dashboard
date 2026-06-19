// Shared panel wrapper. Renders consistent loading / error / empty states so
// every panel visibly reports what failed and why.

export default function Panel({ title, sub, children, resource }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        {sub && <span className="panel-sub">{sub}</span>}
      </div>
      <div className="panel-body">
        {resource ? <ResourceState resource={resource}>{children}</ResourceState> : children}
      </div>
    </section>
  );
}

export function ResourceState({ resource, children }) {
  if (!resource) return children;
  if (resource.loading && !resource.data) {
    return (
      <div className="state">
        <span className="spinner" /> Loading…
      </div>
    );
  }
  if (resource.error && !resource.data) {
    return <div className="state error">⚠ {String(resource.error)}</div>;
  }
  if (!resource.data) {
    return <div className="state">No data.</div>;
  }
  return children;
}
