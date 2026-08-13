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

// --- loop planning: duration → step, frame count, resolution -----------------
//
// Seventy-two hours at native cadence is 864 frames, so a duration control is
// really a decimation policy wearing a duration's clothes. Three quantities move
// together — how far back the window reaches, how coarsely it samples, and at
// what resolution — and they are decided here, together, so the panel exposes
// one control instead of three that can be set into combinations that make no
// sense (72 hours of 5-minute frames at 600x600 is 864 frames and 1.2 GB).

/**
 * Selectable window lengths, hours.
 *
 * The CDN retains ~240 h — measured, not assumed — so 72 is a chosen ceiling
 * rather than a limit of the data. Seven rungs is what fits one row at 380px.
 */
export const DURATION_PRESETS = [1, 3, 6, 12, 24, 48, 72];

/**
 * Sampling intervals the loop may use, minutes, coarsest last.
 *
 * A step is eligible for a view only if it is a whole multiple of that view's
 * scan cadence, which is the invariant that keeps every computed slot a real
 * scan: stepping a 5-minute sector by 15 lands on :01, :16, :31 — all of which
 * the CDN publishes — while stepping it by 7 would land almost entirely on
 * timestamps that have never existed. That also means 15 and 5 are available to
 * the sectors and not to the 10-minute views, which is correct rather than an
 * oversight. 45 is deliberately absent: it satisfies the frame cap at 72 h but
 * puts frames on minutes past the hour that no reader can anticipate.
 */
const STEP_LADDER_MIN = [5, 10, 15, 20, 30, 60];

/**
 * Frame ceiling, whatever the duration.
 *
 * Past this the loop costs more than it shows: decode time, resident memory, and
 * a scrubber on which a single pixel covers several frames.
 */
export const MAX_FRAMES = 96;

/**
 * Decoded-image budget in BYTES, decimal MB.
 *
 * Every frame stays mounted so the loop can animate by swapping opacity, which
 * means every frame stays painted and therefore stays decoded. `w × h × 4 ×
 * count` is a real resident figure here, not a pessimistic bound — it is the
 * direct price of stepping and scrubbing never touching the network, and it is
 * why this panel cannot be reasoned about like an ordinary image gallery that
 * lets the browser evict and re-decode at will.
 */
export const DECODED_BUDGET_BYTES = 70_000_000;

/**
 * The resolutions of each view worth loading, largest first.
 *
 * Retention is resolution-independent — every size in a CDN directory shares an
 * oldest stamp, measured across all four views — so this list costs nothing in
 * history depth and is purely a memory decision. The next tier up from these
 * (1200x1200 on the sectors) is 414 MB decoded at 72 frames and is never viable,
 * which is why each view offers exactly two.
 */
export const GOES_TIERS = {
  psw: ['600x600', '300x300'],
  pnw: ['600x600', '300x300'],
  wus: ['500x500', '250x250'],
  [FULL_DISK]: ['678x678', '339x339'],
};

/** Resident decoded bytes for `count` frames at a `WxH` size. */
export function decodedBytes(size, count) {
  const [w, h] = String(size).split('x').map(Number);
  return w * h * 4 * count;
}

/**
 * Resolve a chosen duration into the loop that will actually be built.
 *
 * Step first: the smallest eligible interval that keeps the count at or under
 * MAX_FRAMES. Resolution second: the largest tier that fits the decode budget at
 * that count. The order matters — resolution is chosen against the frame count
 * the step produced, so a duration that decimates harder is allowed to keep more
 * pixels per frame.
 */
export function planLoop({ view, durationH }) {
  const cfg = GOES_VIEWS[view];
  if (!cfg) return null;
  const totalMin = durationH * 60;
  const stepMin =
    STEP_LADDER_MIN.find(
      (s) => s % cfg.cadenceMin === 0 && Math.round(totalMin / s) <= MAX_FRAMES,
    ) ?? STEP_LADDER_MIN.at(-1);
  const count = Math.round(totalMin / stepMin);
  const tiers = GOES_TIERS[view] ?? [cfg.size];
  const size = tiers.find((s) => decodedBytes(s, count) <= DECODED_BUDGET_BYTES) ?? tiers.at(-1);
  return { durationH, stepMin, count, size, spanMin: (count - 1) * stepMin };
}

/**
 * The rung a view opens on: the first that is at least as dense as the
 * twelve-frame loop this panel shipped before the control existed.
 *
 * Derived rather than constant, because the same rung means different things
 * either side of the cadence split — one hour is twelve frames on a 5-minute
 * sector but six on the 10-minute views, and opening the full disk on six frames
 * would be a regression wearing a default's clothes.
 */
export function defaultDurationH(view) {
  const found = DURATION_PRESETS.find(
    (h) => (planLoop({ view, durationH: h })?.count ?? 0) >= FRAME_COUNT,
  );
  return found ?? DURATION_PRESETS[0];
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
 *
 * `stepMin` and `size` are additive and default to the view's own cadence and
 * size, so a call that omits them builds precisely the window this function
 * built before they existed. Two details of the decimated case are load-bearing:
 *
 *   • The newest slot is still aligned to the view's CADENCE, never to the step.
 *     Aligning to an hourly step would date the leading frame up to an hour back
 *     even when a scan from four minutes ago is sitting on the CDN, throwing
 *     away exactly the freshness the paragraph above argues for.
 *   • Every older slot is then `newest - i × step`, which stays on a real scan
 *     boundary only because a step is always a whole multiple of the cadence.
 *     planLoop enforces that; this function relies on it.
 */
export function buildGoesFrames({ now, view, band, count = FRAME_COUNT, stepMin, size }) {
  const cfg = GOES_VIEWS[view];
  if (!cfg) return [];
  const step = stepMin ?? cfg.cadenceMin;
  const px = size ?? cfg.size;
  const t = now instanceof Date ? now.getTime() : now;
  const newest = alignToSlot(t, cfg.cadenceMin, cfg.phaseMin);
  const frames = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const time = newest - i * step * 60_000;
    const stamp = goesStamp(time);
    frames.push({
      view,
      band,
      stamp,
      time,
      timeBasis: 'observed',
      url: goesFrameUrl({ view, band, size: px, stamp }),
    });
  }
  return frames;
}

/**
 * How old the newest frame may be before the loop is calling itself current
 * under false pretences.
 *
 * Interval-relative, not a flat number: a missed scan on the 10-minute full disk
 * is ordinary at an age that would be genuinely alarming on the 5-minute
 * sectors. Two intervals of slack plus the CDN's own publish latency.
 *
 * The interval is the loop's STEP, which equals the view's scan cadence only
 * while the loop runs natively. A loop that samples one slot per hour has a
 * newest frame up to an hour old BY CONSTRUCTION — judged against psw's
 * 5-minute cadence it would trip the stale banner on every render, turning the
 * panel's most severe state into noise. `stepMin` therefore defaults to the
 * cadence, which is exactly what a native-cadence caller means and reproduces
 * the previous behaviour for every existing one-argument call.
 */
export function staleThresholdMin(view, stepMin) {
  const cfg = GOES_VIEWS[view];
  const step = stepMin ?? cfg?.cadenceMin;
  if (step == null) return 20;
  return step * 2 + 10;
}

/** Above this span, minutes stop being a unit anyone can read at a glance. */
const SPAN_MIN_AS_HOURS = 120;

/**
 * The loop's one-line account of its own shape.
 *
 * Three things a template literal in the panel got wrong the moment the window
 * stopped being one hour long: a multi-day span rendered as four thousand
 * minutes; the interval quoted was the view's scan cadence rather than the
 * interval the loop actually samples at; and those two are the same number only
 * while the loop is native. "at 5-min scans" beside 60-minute steps advertises
 * imagery the reader is not being shown — the same class of self-contradiction
 * the surrounding panel was reworked to eliminate, so the cadence is named only
 * when the loop is genuinely running at it.
 */
export function describeLoop({ spanMin, stepMin, cadenceMin }) {
  const span =
    spanMin >= SPAN_MIN_AS_HOURS
      ? `${Math.round((spanMin / 60) * 10) / 10}-h`
      : `${spanMin}-min`;
  const rate = stepMin === cadenceMin ? `${cadenceMin}-min scans` : `${stepMin}-min steps`;
  return `${span} loop at ${rate}`;
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
 * How many frames may be in flight at once.
 *
 * The CDN negotiates h2 on a real request and advertises 128 concurrent streams,
 * so the browser's old six-connection ceiling does not apply and this number is
 * ours to choose. Measured, the choice barely matters: fetching 48 frames at
 * concurrency 4, 6, 12 and 24 differed by less than the run-to-run variance,
 * because the transfer is bandwidth-bound long before it is connection-bound.
 * Six is kept for the reasons that survive that finding — it saturates the link
 * with margin, and it strands fewer half-transferred frames when a band or
 * duration switch abandons the queue.
 */
export const LOAD_CONCURRENCY = 6;

/**
 * Frames that must land before the loop is allowed to start playing.
 *
 * A flat count rather than a fraction, and 24 specifically, because of how it
 * meets frameIntervalMs: below about 22 frames the 450 ms ceiling binds, so a
 * quorum any smaller would start the loop cycling faster than it will once full
 * and then visibly slow down. At 24 the cycle is already 10 s and stays there.
 */
export const LOAD_QUORUM = 24;

/**
 * Frames a window must want before quorum applies at all.
 *
 * At or below the quorum there is nothing to gain — waiting for 24 of 24 is
 * waiting for all of them — so short windows keep requiring `settled` and behave
 * exactly as they did before progressive loading existed.
 */
export function playbackQuorum(count) {
  return count > LOAD_QUORUM ? LOAD_QUORUM : null;
}

/**
 * The order frames are requested in: newest first, then coarse to fine.
 *
 * Sequential order would be actively wrong here. The first frames to land would
 * be the oldest contiguous handful — a subset that spans almost none of the
 * window and shows almost no motion — so the loop would sit at quorum showing
 * the first hour of a 72-hour span. Halving strides instead means the first
 * dozen frames are spread across the whole window, and every later frame
 * subdivides what is already there: the loop starts coarse over the full span
 * and densifies in place rather than growing from one end.
 *
 * The newest frame jumps the queue because it is what the panel displays at
 * rest, before playback is possible at all — it is the difference between a
 * first paint at 250 ms and one at quorum.
 *
 * summarizeFrameLoad filters `frames` in window order, so a scattered subset is
 * still time-ordered and plays as a valid coarse loop with no extra work.
 */
export function frameLoadOrder(n) {
  if (!(n > 0)) return [];
  const seen = new Set();
  const out = [];
  const push = (i) => {
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  };
  push(n - 1);
  for (let stride = 8; stride >= 1; stride = Math.floor(stride / 2)) {
    for (let i = 0; i < n; i += stride) push(i);
  }
  return out;
}

/** Wall-clock time one pass over the whole window should take. */
export const TARGET_CYCLE_MS = 10_000;

/**
 * How long each frame is held, from the number of frames ACTUALLY playable.
 *
 * Deriving this from the window's target count instead is the subtle failure:
 * playback begins at quorum, so a 96-frame target would hold each of the first
 * 24 frames for 104 ms and rip through the whole span in 2.5 s, then gradually
 * slow to 10 s as the rest arrived. Deriving it from what is on screen holds the
 * cycle at 10 s from the first played frame to the last — the coarse loop
 * crosses the window at the speed the full one will, just in bigger jumps.
 *
 * The 450 ms ceiling is the value this panel shipped with and preserves the
 * short windows exactly; the 100 ms floor is where further speed stops reading
 * as motion and starts costing paints.
 */
export function frameIntervalMs(usableCount, speed = 1) {
  const base = Math.min(450, Math.max(100, Math.round(TARGET_CYCLE_MS / Math.max(usableCount, 1))));
  return Math.max(60, Math.round(base / speed));
}

/**
 * Publish latency to allow for at the leading edge, minutes. GEOCOLOR renders
 * slower than the 3–5 minutes the raw bands take, so this is the generous end.
 */
const PUBLISH_LAG_MIN = 10;

/**
 * Share of a window's frames that may be missing from HISTORY before it is worth
 * mentioning. Measured loss over a trailing 72 h was 0.0% on band 08 across
 * every view and 0.69–1.39% on GEOCOLOR, so 3% is roughly twice the worst real
 * case — loose enough that an ordinary day stays silent, tight enough that the
 * note still means something when it appears.
 */
const HISTORICAL_GAP_RATE = 0.03;

/**
 * How many missing frames are ordinary for a window of this shape.
 *
 * Two terms, because the old flat constant conflated two things that scale in
 * opposite directions. The leading-edge term covers slots the CDN has not
 * published yet and SHRINKS as the step grows — at 5-minute steps the newest two
 * slots can plausibly be absent, at 60-minute steps only the current one can be.
 * The history term covers holes behind the leading edge and grows with the frame
 * count. Rounding rather than ceiling the history term is what makes a
 * twelve-frame native window come out at exactly 2, the constant this panel
 * shipped with, instead of quietly loosening it to 3.
 */
export function missingTolerance({ count, stepMin }) {
  const leadingEdge = Math.max(1, Math.ceil(PUBLISH_LAG_MIN / stepMin));
  return leadingEdge + Math.round(count * HISTORICAL_GAP_RATE);
}

/**
 * Where the holes are, not just how many.
 *
 * Six isolated missing frames and one six-frame hole are the same number and
 * different events. Scattered singletons make the loop marginally choppier;
 * a contiguous run removes a stretch of time, so the frames either side of it
 * abut and the reader sees cloud jump a distance it never travelled. The second
 * is the one that can be misread as weather, so the panel has to be able to say
 * which happened and where.
 *
 * Only an explicit 'fail' counts as missing — an unresolved frame is still in
 * flight, and treating it as a hole would make every window look broken while it
 * loaded.
 */
export function summarizeGaps(frames, status) {
  let missing = 0;
  let run = 0;
  let longestRun = 0;
  let longestEnd = -1;
  frames.forEach((f, i) => {
    if (status[f.url] === 'fail') {
      missing += 1;
      run += 1;
      if (run > longestRun) {
        longestRun = run;
        longestEnd = i;
      }
    } else {
      run = 0;
    }
  });
  const longestStart = longestRun ? longestEnd - longestRun + 1 : -1;
  return {
    missing,
    longestRun,
    longestStart,
    // The instant the hole opens: the last good frame before it is at
    // longestStart - 1, so the gap begins at the first absent slot.
    gapStartTime: longestStart >= 0 ? frames[longestStart].time : null,
  };
}

/**
 * Is the largest hole big enough that motion across it would mislead?
 *
 * Time, not frame count: three missing slots is fifteen minutes at native
 * cadence and three hours at hourly steps. Half an hour is the floor at which a
 * jump stops being a stutter, and two steps is the floor below which no gap can
 * exist at all.
 */
export function gapIsMisleading({ longestRun, stepMin }) {
  const gapMin = longestRun * stepMin;
  return gapMin >= Math.max(30, 2 * stepMin);
}

/** Two-digit UTC clock, and the date too once a window outlives one UTC day. */
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
export function formatStampUTC(ms, { withDate = false } = {}) {
  const d = new Date(ms);
  const clock = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
  return withDate ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${clock}` : clock;
}

/** Does this window straddle a UTC midnight? If so its stamps need dates. */
export function crossesUTCDay(aMs, bMs) {
  return Math.floor(aMs / 86_400_000) !== Math.floor(bMs / 86_400_000);
}

/**
 * Roughly how many day/night terminator passages a window contains.
 *
 * One dusk and one dawn per 24 hours, so a span divided by twelve. Deliberately
 * approximate — the true count moves with season, latitude and what time of day
 * the window starts — and the copy that uses it says "about".
 */
export function terminatorCrossings(durationH) {
  return Math.floor(durationH / 12);
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
