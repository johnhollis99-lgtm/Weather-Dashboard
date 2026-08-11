// RainViewer — public weather-maps index (CORS-friendly, keyless).
//
// Two jobs in the consolidated radar panel:
//   1. the selectable ALTERNATE layer (global coverage, real animation);
//   2. the NETWORK-LEVEL freshness signal for the IEM layer, because RainViewer
//      publishes absolute per-frame timestamps and IEM publishes none.
//
// Job 2 is a different pipeline from IEM's, so it is always labelled as a check
// on the radar network rather than on IEM's own cache. Frame adaptation lives in
// lib/radar.js (buildRainviewerFrames) so the shape logic stays testable.

/** The raw index: `{ host, radar: { past, nowcast } }`. */
export async function getRainviewerIndex(signal) {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal });
  if (!res.ok) throw new Error(`RainViewer ${res.status}`);
  return res.json();
}
