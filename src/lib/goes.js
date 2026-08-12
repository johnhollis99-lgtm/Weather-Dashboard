// GOES-West (GOES-18) time-lapse frame construction.
//
// The still image the Satellite panel used to show is a stable alias the CDN
// keeps pointing at the newest scan (`600x600.jpg`). A loop needs the frames
// BEHIND that alias, and those are only addressable by their timestamped
// filenames:
//
//   20262240211_GOES18-ABI-psw-GEOCOLOR-600x600.jpg
//   └────┬────┘
//    YYYY DDD HHMM, all UTC — DDD is day-of-year, not month/day.
//
// Two ways to learn which stamps exist, and only one of them is usable:
//
//   1. Read the CDN's directory listing. It is authoritative, CORS-open, and
//      1.8 MB of HTML per band — larger than the imagery it indexes, with no
//      Range support (a `Range: bytes=-4000` request returns all 1.8 MB and a
//      200, not a 206). Paying that on every band switch is absurd.
//   2. Compute the stamps from the scan cadence. Costs nothing, and the frame
//      time is still OBSERVED rather than derived: the stamp is part of the URL
//      we ask for, so if the image loads, that IS its valid time. Contrast with
//      IEM in radar.js, whose frames are relative offsets with no published
//      product time and are therefore marked `timeBasis: 'derived'`.
//
// So: compute, and let 404s prune. The cadences below were read off the live
// CDN listings rather than assumed, because they are NOT uniform — a single
// 5-minute rule would produce nothing but 404s for two of the four views.
//
// A computed stamp is a PREDICTION that a scan exists. The panel drops any frame
// whose image fails to load, which is what makes this safe: NOAA shifting a scan
// schedule degrades the loop to the frames that do exist instead of breaking it.

export const GOES_BASE = 'https://cdn.star.nesdis.noaa.gov/GOES18/ABI';

/** Full-disk sentinel. Uppercase in both the CDN path and the filename. */
export const FULL_DISK = 'FD';

/**
 * Per-view scan cadence and loop frame size.
 *
 * `phaseMin` is the minute-of-hour the cadence lands on: psw/pnw scan at :01,
 * :06, :11 … while wus and full disk land on :00, :10, :20 …
 *
 * `size` is deliberately NOT the size the still used (psw was 1200x1200). A
 * 12-frame GEOCOLOR loop at 1200x1200 is ~8 MB; at 600x600 it is ~2.7 MB. The
 * still traded nothing for its resolution because it was one image — a loop
 * does. Raise these if you want detail more than you want the loop to start.
 */
export const GOES_VIEWS = {
  psw: { cadenceMin: 5, phaseMin: 1, size: '600x600' },
  pnw: { cadenceMin: 5, phaseMin: 1, size: '600x600' },
  wus: { cadenceMin: 10, phaseMin: 0, size: '500x500' },
  [FULL_DISK]: { cadenceMin: 10, phaseMin: 0, size: '678x678' },
};

/** Frames per loop. 12 → one hour of psw/pnw, two hours of wus/full disk. */
export const FRAME_COUNT = 12;

/** Day-of-year (1-based) for a UTC instant. */
export function dayOfYearUTC(ms) {
  const d = new Date(ms);
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const startOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((startOfDay - startOfYear) / 86_400_000) + 1;
}

/** UTC instant → the CDN's `YYYYDDDHHMM` stamp. */
export function goesStamp(ms) {
  const d = new Date(ms);
  const yyyy = String(d.getUTCFullYear());
  const ddd = String(dayOfYearUTC(ms)).padStart(3, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}${ddd}${hh}${mm}`;
}

/**
 * `YYYYDDDHHMM` → UTC instant. The inverse of goesStamp, so a frame can report
 * its own valid time without the caller having to carry it alongside.
 */
export function parseGoesStamp(stamp) {
  const m = /^(\d{4})(\d{3})(\d{2})(\d{2})$/.exec(String(stamp));
  if (!m) return null;
  const [, yyyy, ddd, hh, mm] = m;
  // Day-of-year N is (N - 1) days after Jan 1, which Date.UTC normalises for us.
  return Date.UTC(Number(yyyy), 0, Number(ddd), Number(hh), Number(mm), 0, 0);
}

/**
 * The most recent scan slot at or before `ms`.
 *
 * Both cadences divide 60, so aligning within the hour is sound. `min - back`
 * can go negative (00:00 against a :01 phase → -4); Date.UTC rolls that into the
 * previous hour, which is the correct slot, so the underflow is load-bearing
 * rather than a bug waiting to be "fixed".
 */
export function alignToSlot(ms, cadenceMin, phaseMin) {
  const d = new Date(ms);
  const back = (((d.getUTCMinutes() - phaseMin) % cadenceMin) + cadenceMin) % cadenceMin;
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes() - back,
    0,
    0,
  );
}

/** The CDN key for a view: full disk lives under FD/, sectors under SECTOR/<id>/. */
export function goesFrameUrl({ view, band, size, stamp }) {
  const dir = view === FULL_DISK ? `${GOES_BASE}/FD/${band}` : `${GOES_BASE}/SECTOR/${view}/${band}`;
  return `${dir}/${stamp}_GOES18-ABI-${view}-${band}-${size}.jpg`;
}

/** The stable newest-scan alias — no stamp, always current, one image. */
export function goesLatestUrl({ view, band, size }) {
  const dir = view === FULL_DISK ? `${GOES_BASE}/FD/${band}` : `${GOES_BASE}/SECTOR/${view}/${band}`;
  return `${dir}/${size}.jpg`;
}

/**
 * The loop, oldest frame first — the direction every satellite loop the reader
 * has ever seen runs, and the direction the scrubber therefore reads.
 *
 * The newest slot is included even though the CDN publishes ~3–5 minutes behind
 * the scan time, so the one or two newest frames may not exist yet. That is
 * intentional: pruning a 404 costs nothing, while back-dating the window by a
 * fixed guess would throw away real frames every time the CDN ran ahead of the
 * guess. Freshness is worth more than a clean first paint here.
 */
export function buildGoesFrames({ now, view, band, count = FRAME_COUNT }) {
  const cfg = GOES_VIEWS[view];
  if (!cfg) return [];
  const t = now instanceof Date ? now.getTime() : now;
  const newest = alignToSlot(t, cfg.cadenceMin, cfg.phaseMin);
  const frames = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const time = newest - i * cfg.cadenceMin * 60_000;
    const stamp = goesStamp(time);
    frames.push({
      view,
      band,
      stamp,
      time,
      timeBasis: 'observed',
      url: goesFrameUrl({ view, band, size: cfg.size, stamp }),
    });
  }
  return frames;
}

/**
 * How old the newest frame may be before the loop is calling itself current
 * under false pretences.
 *
 * Cadence-relative, not a flat number: a missed scan on the 10-minute full disk
 * is ordinary at an age that would be genuinely alarming on the 5-minute
 * sectors. Two cadences of slack plus the CDN's own publish latency.
 */
export function staleThresholdMin(view) {
  const cfg = GOES_VIEWS[view];
  if (!cfg) return 20;
  return cfg.cadenceMin * 2 + 10;
}

// --- load bookkeeping --------------------------------------------------------

/**
 * Reduce the per-URL load outcomes into what the panel actually renders.
 *
 * `status` maps frame URL → 'ok' | 'fail'. Keyed by URL rather than timestamp
 * because one stamp is shared across all five bands (the 04:11 psw scan exists
 * for every product), so a stamp-keyed map would carry one band's verdict into
 * another's.
 *
 * `settled` means every candidate has ANSWERED — loaded or failed — not that
 * every candidate succeeded. Gating playback on it is what stops the loop from
 * stuttering through frames that are still downloading, and it must remain true
 * for a window where some frames 404: the newest slot is routinely unpublished,
 * so requiring all-success would mean the loop never starts.
 */
export function summarizeFrameLoad(frames, status) {
  const usable = frames.filter((f) => status[f.url] === 'ok');
  const resolved = frames.filter((f) => status[f.url]).length;
  return {
    usable,
    resolved,
    settled: frames.length > 0 && resolved === frames.length,
  };
}

/**
 * Drop outcomes for frames that have left the window.
 *
 * This is also the whole reset story: a band or view switch changes every URL,
 * so nothing carries over by accident, while a refresh tick KEEPS the verdicts
 * it already earned — a given URL's bytes never change, so an 'ok' stays true
 * and the eleven overlapping frames are not re-fetched.
 *
 * Returns the original object when nothing was dropped, so React can skip the
 * re-render.
 */
export function pruneFrameStatus(frames, status) {
  const live = new Set(frames.map((f) => f.url));
  const kept = Object.entries(status).filter(([url]) => live.has(url));
  return kept.length === Object.keys(status).length ? status : Object.fromEntries(kept);
}
