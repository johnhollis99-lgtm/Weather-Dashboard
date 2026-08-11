// IEM NEXRAD access: tile sampling for the frozen-cache self-test.
//
// Frame URLs themselves are built in lib/radar.js (pure). This module owns the
// only thing that needs the network: fetching a few tiles and hashing them, so
// classifyFreshness() can tell a moving radar picture from a stuck one.
//
// WHY HASH TILES AT ALL — IEM's relative products (`nexrad-n0q-mNNm`) carry no
// product time in any form we could find: no Last-Modified, no ETag, no WMS TIME
// dimension, no scans from the radar JSON API. Comparing the newest frame's
// pixels against the oldest is the only direct evidence available that IEM's
// cache is still advancing.

import { IEM_BASE, iemProduct, IEM_OFFSETS_MIN } from '../lib/radar.js';

// Sample tiles at zoom 5 spanning CONUS. Small (a few KB each), cached by IEM
// for 5 minutes, and wide enough that a continent-scale sample rarely contains
// zero echo — which is what keeps the 'unverifiable' verdict rare rather than
// routine.
const SAMPLE_TILES = [
  [5, 5, 11],
  [5, 6, 11],
  [5, 7, 11],
  [5, 8, 11],
  [5, 7, 12],
  [5, 8, 12],
];

const tileUrl = (product, [z, x, y], cacheBust) =>
  `${IEM_BASE}/${product}/${z}/${x}/${y}.png${cacheBust == null ? '' : `?_=${cacheBust}`}`;

// FNV-1a over the bytes. Not cryptographic — we only need "did these bytes
// change", and a 32-bit hash over a few-KB PNG is ample for that.
function hashBytes(buf) {
  const view = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < view.length; i++) {
    h ^= view[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

async function hashTile(product, tile, cacheBust, signal) {
  const res = await fetch(tileUrl(product, tile, cacheBust), { signal });
  if (!res.ok) throw new Error(`IEM ${product} ${res.status}`);
  return hashBytes(await res.arrayBuffer());
}

/**
 * Hashes of the sample tiles at the newest (offset 0) and oldest offsets.
 *
 * Feed the result straight to classifyFreshness(). Throws only if the whole
 * sample fails — a partial failure yields fewer pairs, and the classifier
 * reports 'unknown' rather than guessing from one tile.
 */
export async function sampleIemFreshness({ cacheBust, signal } = {}) {
  const oldest = IEM_OFFSETS_MIN[0]; // 55
  const pairs = await Promise.all(
    SAMPLE_TILES.map(async (tile) => {
      try {
        const [newestHash, oldestHash] = await Promise.all([
          hashTile(iemProduct(0), tile, cacheBust, signal),
          hashTile(iemProduct(oldest), tile, cacheBust, signal),
        ]);
        return [newestHash, oldestHash];
      } catch {
        return null; // drop this tile from the sample rather than failing the probe
      }
    }),
  );
  const usable = pairs.filter(Boolean);
  return {
    newestHashes: usable.map((p) => p[0]),
    oldestHashes: usable.map((p) => p[1]),
    sampled: usable.length,
    attempted: SAMPLE_TILES.length,
  };
}
