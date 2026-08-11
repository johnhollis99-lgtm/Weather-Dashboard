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

// --- superseded by getRainviewerIndex + lib/radar.js -------------------------
// Still consumed by the outgoing Radar.jsx panel, which the next commit removes.
// Kept here so this commit stands on its own: the refactor is additive, and the
// old surface disappears together with its last caller rather than before it.

export async function getRadarFrames() {
  const json = await getRainviewerIndex();
  const host = json.host;
  const past = json.radar?.past || [];
  const nowcast = json.radar?.nowcast || [];
  const frames = [
    ...past.map((f) => ({ ...f, kind: 'past' })),
    ...nowcast.map((f) => ({ ...f, kind: 'nowcast' })),
  ];
  return { host, frames };
}

export function tileUrl(host, frame, { size = 256, color = 6, options = '1_1' } = {}) {
  return `${host}${frame.path}/${size}/{z}/{x}/{y}/${color}/${options}.png`;
}
