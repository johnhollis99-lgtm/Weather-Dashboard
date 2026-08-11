// Shared panel wrapper. Renders consistent loading / error / empty states so
// every panel visibly reports what failed and why.
//
// `kind` carries the provenance device — the distinction that is the whole
// reason this dashboard exists:
//
//   'official' → measured or published by NWS / EPA / a model. Solid left rule.
//   'derived'  → computed or interpreted in-app. HATCHED left rule + a DERIVED
//                badge in the header.
//
// The hatch is borrowed from SPC's own convention for significant-severe areas,
// so the visual language comes from the subject rather than from a UI kit. It is
// a TEXTURE plus a TEXT badge, never a hue — the distinction therefore survives
// color-blindness, greyscale, and a monochrome printout.
export default function Panel({ title, sub, children, resource, kind = 'official' }) {
  return (
    <section className={`panel panel-${kind}`}>
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        {kind === 'derived' && (
          <span className="panel-badge" title="Computed or interpreted in-app — not official output">
            Derived
          </span>
        )}
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
