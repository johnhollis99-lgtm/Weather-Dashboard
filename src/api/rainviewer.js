// RainViewer — public weather-maps index (CORS-friendly). Returns the list of
// past radar frames plus nowcast frames, and the tile host to build tile URLs.

export async function getRadarFrames() {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!res.ok) throw new Error(`RainViewer ${res.status}`);
  const json = await res.json();
  const host = json.host;
  const past = json.radar?.past || [];
  const nowcast = json.radar?.nowcast || [];
  // Mark nowcast frames so the timeline can style them differently.
  const frames = [
    ...past.map((f) => ({ ...f, kind: 'past' })),
    ...nowcast.map((f) => ({ ...f, kind: 'nowcast' })),
  ];
  return { host, frames };
}

// Build a tile-layer URL template for a given frame.
//   {host}{frame.path}/{size}/{z}/{x}/{y}/{color}/{options}.png
// color 6 = NEXRAD Level-III (traditional NWS reflectivity palette);
// options 1_1 = smooth + snow.
export function tileUrl(host, frame, { size = 256, color = 6, options = '1_1' } = {}) {
  return `${host}${frame.path}/${size}/{z}/{x}/{y}/${color}/${options}.png`;
}
