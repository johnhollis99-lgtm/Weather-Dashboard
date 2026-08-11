// Radar frame construction, honesty checks, and legend — the decision logic the
// radar panel renders. Pure functions only: no fetch, no Leaflet, no clock reads
// (callers pass `now`), so every rule below is testable without a browser.
//
// TWO SOURCES, TWO DIFFERENT KINDS OF TRUTH
// -----------------------------------------
// IEM (primary) serves NEXRAD N0Q through RELATIVE products: `nexrad-n0q` is
// "now", `nexrad-n0q-m05m` is "now minus 5 minutes", out to -m55m. Verified
// live: twelve products at 5-minute steps, keyless, CORS-open, and genuinely
// distinct frames (the same tile hashes differently across offsets).
//
// The catch, also verified: those tiles carry NO product time. No Last-Modified,
// no ETag, the WMS declares no TIME dimension, and the radar JSON API returns no
// scans for N0Q. The offset is computed server-side, so a frame's time is only
// ever "now minus N" BY ASSERTION. If IEM's ingest froze, `-m05m` would keep
// serving stale pixels and a naive panel would stamp them "5 minutes ago" —
// a dead cache rendered as clear skies, which is the exact failure this codebase
// already fixed once elsewhere.
//
// So IEM frame times are DERIVED and labelled as such, and staleness gets two
// independent signals instead of one false timestamp:
//
//   1. NETWORK-LEVEL (evaluateStaleness): RainViewer publishes absolute frame
//      times. If the radar network as a whole has gone quiet, that shows there.
//      It is a different pipeline, so it says nothing about IEM's own cache —
//      labelled accordingly, never presented as IEM's age.
//   2. IEM SELF-TEST (classifyFreshness): healthy IEM means the newest frame and
//      the oldest differ. If they are byte-identical, the cache is stuck.
//
// RainViewer (alternate) carries real per-frame timestamps, so its staleness is
// direct and needs none of this.

import { REFLECTIVITY_STOPS } from './palette.js';

// --- IEM frame construction -------------------------------------------------

export const IEM_BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';

// Newest first is the natural product order; frames are returned oldest-first so
// the timeline reads left-to-right like every radar loop the reader has seen.
export const IEM_OFFSETS_MIN = [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];

/** Product id for an offset: 0 → 'nexrad-n0q', 25 → 'nexrad-n0q-m25m'. */
export function iemProduct(offsetMin) {
  return offsetMin === 0 ? 'nexrad-n0q' : `nexrad-n0q-m${String(offsetMin).padStart(2, '0')}m`;
}

/**
 * Leaflet URL template for one IEM frame.
 *
 * `cacheBust` rides in the query string on the auto-refresh tick. The product
 * URL is identical from one tick to the next (the offsets are relative), so
 * without it the browser would serve the previous tick's tiles from cache and
 * the loop would silently stop advancing.
 */
export function iemTileUrl(offsetMin, cacheBust) {
  const q = cacheBust == null ? '' : `?_=${cacheBust}`;
  return `${IEM_BASE}/${iemProduct(offsetMin)}/{z}/{x}/{y}.png${q}`;
}

/**
 * The twelve IEM frames, oldest first.
 *
 * `time` is derived from the caller's clock minus the offset, and every frame is
 * marked `timeBasis: 'derived'` so the UI can never accidentally present it as an
 * observed valid-time.
 */
export function buildIemFrames(now, cacheBust) {
  const t = now instanceof Date ? now.getTime() : now;
  return IEM_OFFSETS_MIN.map((offsetMin) => ({
    source: 'iem',
    offsetMin,
    product: iemProduct(offsetMin),
    url: iemTileUrl(offsetMin, cacheBust),
    time: t - offsetMin * 60_000,
    timeBasis: 'derived',
    kind: 'past',
  }));
}

// --- RainViewer frame adaptation --------------------------------------------

/** RainViewer index → the same frame shape, with OBSERVED times. */
export function buildRainviewerFrames(index, { size = 256, color = 6, options = '1_1' } = {}) {
  if (!index?.host) return [];
  const past = (index.radar?.past || []).map((f) => ({ ...f, kind: 'past' }));
  const nowcast = (index.radar?.nowcast || []).map((f) => ({ ...f, kind: 'nowcast' }));
  return [...past, ...nowcast].map((f) => ({
    source: 'rainviewer',
    url: `${index.host}${f.path}/${size}/{z}/{x}/{y}/${color}/${options}.png`,
    time: f.time * 1000,
    timeBasis: 'observed',
    kind: f.kind,
  }));
}

// --- Staleness --------------------------------------------------------------

export const STALE_THRESHOLD_MIN = 15;

/**
 * Is the newest frame too old to trust?
 *
 * Returns a verdict the panel renders verbatim. `basis` travels with it so the
 * UI can say WHOSE freshness this describes — for IEM the answer comes from
 * RainViewer and therefore describes the network, not IEM's cache.
 */
export function evaluateStaleness({ newestTime, now, thresholdMin = STALE_THRESHOLD_MIN, basis = 'observed' }) {
  if (newestTime == null) {
    return { level: 'unknown', ageMin: null, basis, message: 'Frame age unavailable.' };
  }
  const t = now instanceof Date ? now.getTime() : now;
  const ageMin = (t - newestTime) / 60_000;
  if (ageMin < 0) {
    // A future frame means clock skew, not freshness. Say so rather than
    // reporting a negative age as if it were extra-fresh.
    return { level: 'unknown', ageMin, basis, message: 'Frame time is ahead of this device’s clock.' };
  }
  if (ageMin > thresholdMin) {
    return {
      level: 'stale',
      ageMin,
      basis,
      message: `Newest frame is ${Math.round(ageMin)} min old (threshold ${thresholdMin} min).`,
    };
  }
  return { level: 'fresh', ageMin, basis, message: `Newest frame ${Math.round(ageMin)} min old.` };
}

// --- IEM self-test: is the tile cache frozen? -------------------------------

/**
 * Compare hashes of the same tiles at the newest and oldest offsets.
 *
 * Healthy IEM: the two differ (weather moved across 55 minutes).
 * Frozen IEM:  they match, AND there is actually content to have moved.
 * Quiet day:   they match because every sampled tile is EMPTY — no echo anywhere
 *              in the sample. That is indistinguishable from a frozen cache by
 *              this test, so it reports `unverifiable` rather than crying stale.
 *              Calling a clear afternoon a radar outage would train the reader to
 *              ignore the warning, which costs more than the missed detection.
 *
 * Emptiness is inferred without decoding pixels: an all-transparent PNG is
 * byte-identical wherever it appears, so if every sampled CURRENT tile shares one
 * hash, the sample carries no echo. Self-calibrating — no magic byte sizes.
 *
 * @param {string[]} newestHashes hashes of sample tiles at offset 0
 * @param {string[]} oldestHashes hashes of the SAME tiles at the oldest offset
 */
export function classifyFreshness(newestHashes, oldestHashes) {
  const n = newestHashes?.length ?? 0;
  if (!n || n !== (oldestHashes?.length ?? 0)) {
    return { level: 'unknown', reason: 'No usable tile sample.' };
  }

  const anyChanged = newestHashes.some((h, i) => h !== oldestHashes[i]);
  if (anyChanged) {
    return { level: 'live', reason: 'Reflectivity differs across the loop window.' };
  }

  const allSameTile = new Set(newestHashes).size === 1;
  if (allSameTile) {
    return {
      level: 'unverifiable',
      reason: 'No echo anywhere in the sampled area — cannot tell a quiet sky from a stuck cache.',
    };
  }

  return {
    level: 'frozen',
    reason: 'Reflectivity is present but identical across 55 minutes — IEM’s tile cache appears stuck.',
  };
}

// --- Frame reconciliation across a refresh ----------------------------------

/**
 * Which frame should stay selected when the frame list is replaced?
 *
 * The 5-minute refresh rebuilds the list; it must not yank the reader back to a
 * different point in the loop, and must never touch the map view. Position is
 * preserved from the END of the list (the newest frame stays the newest frame)
 * because these lists are rolling windows — index 0 means a different moment
 * after every refresh, but "2 frames back from now" doesn't.
 *
 * A viewer parked on the live frame therefore stays on the live frame, which is
 * exactly where the refresh is meant to carry them forward.
 */
export function reconcileFrameIndex(prevFrames, nextFrames, prevIdx) {
  const nextLen = nextFrames?.length ?? 0;
  if (nextLen === 0) return 0;
  const prevLen = prevFrames?.length ?? 0;
  if (prevLen === 0) return nextLen - 1; // first load → newest

  const clampedPrev = Math.min(Math.max(prevIdx ?? 0, 0), prevLen - 1);
  const fromEnd = prevLen - 1 - clampedPrev;
  return Math.min(Math.max(nextLen - 1 - fromEnd, 0), nextLen - 1);
}

// --- Legend -----------------------------------------------------------------

/**
 * dBZ legend entries, built from palette.js — the single source of truth for
 * these hexes. Never redeclared here.
 *
 * SCOPE, STATED HONESTLY: REFLECTIVITY_STOPS covers 20–65 dBZ, the
 * decision-relevant range. The tiles also paint returns below 20 dBZ in blues and
 * cyans that this scale does not enumerate, and IEM's PNGs are anti-aliased, so
 * pixels blend BETWEEN stops. This legend is therefore a key to the significant-
 * return range, not a byte-exact lookup — and it says so on the panel rather than
 * implying a precision it can't have.
 */
export function buildLegend(stops = REFLECTIVITY_STOPS) {
  return stops.map((s, i) => ({
    dbz: s.dbz,
    fill: s.fill,
    // Top stop is open-ended: 65+ dBZ is hail country, not a bounded band.
    label: i === stops.length - 1 ? `${s.dbz}+` : `${s.dbz}`,
  }));
}

export const LEGEND_NOTE =
  'dBZ — significant returns (20+). Lighter echoes render below this scale.';
