import Panel from './Panel.jsx';

// Zoom Earth — live satellite + active tropical storm / hurricane tracks.
//
// It used to be embedded via the /api/zoomearth proxy, but zoom.earth is a heavy
// SPA whose live imagery layer never reliably paints inside a cross-origin
// iframe (and its frame-busting JS fought the proxy). Rather than show an empty
// gray panel, it's now a compact set of links that open the real site in a new
// tab, pre-centered on the selected location. Sits next to the other maps.
export default function ZoomEarth({ location }) {
  const view = `view=${location.lat.toFixed(2)},${location.lon.toFixed(2)},6z`;
  const here = `https://zoom.earth/#${view}`;

  return (
    <Panel title="Zoom Earth — Satellite &amp; Storms" sub="opens in a new tab (doesn't embed)">
      <p className="link-note">
        Live global satellite with active tropical-storm and hurricane tracks — basin-scale coverage the GOES sector
        panel doesn't show. Zoom Earth blocks embedding, so these open the real site, centered on{' '}
        <strong>{location.name}</strong>.
      </p>
      <div className="link-row">
        <a className="link-cta" href={here} target="_blank" rel="noreferrer">
          🛰 Satellite over {location.name} ↗
        </a>
        <a className="link-cta" href="https://zoom.earth/storms/" target="_blank" rel="noreferrer">
          🌀 Active storms list ↗
        </a>
      </div>
    </Panel>
  );
}
