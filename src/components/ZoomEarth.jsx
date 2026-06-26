import Panel from './Panel.jsx';

// Zoom Earth — live satellite imagery with active tropical storm / hurricane
// tracks. Great for basin-scale storm tracking, which the GOES-West sector panel
// doesn't cover. zoom.earth sends X-Frame-Options, so it's routed through the
// local proxy (/api/zoomearth, mirrors the NDOT approach); the map view is
// steered client-side via the URL hash. A basin-scale zoom (~5z) is a good
// default for watching a storm relative to the coastline.
export default function ZoomEarth({ location }) {
  const view = `view=${location.lat.toFixed(2)},${location.lon.toFixed(2)},5z`;
  const iframeSrc = `/api/zoomearth#${view}`;
  const ext = `https://zoom.earth/#${view}`;

  return (
    <Panel title="Zoom Earth — Satellite & Storms" sub="Live satellite · tropical storm/hurricane tracking">
      <div className="btn-row" style={{ marginBottom: 8 }}>
        <a href="https://zoom.earth/storms/" target="_blank" rel="noreferrer" style={{ alignSelf: 'center', fontSize: 13 }}>
          Active storms list ↗
        </a>
        <a href={ext} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 13 }}>
          Open full site ↗
        </a>
      </div>

      {/* Proxying strips X-Frame-Options/CSP, which also removes the guard that
          would stop zoom.earth's frame-busting JS from navigating the TOP window
          to https://zoom.earth/ (it was hijacking the whole dashboard). Sandbox
          the frame and deliberately OMIT allow-top-navigation so the embedded
          SPA can still run/render but can't redirect the parent. */}
      <iframe
        key={iframeSrc}
        title="Zoom Earth"
