import { useEffect, useMemo, useRef, useState } from 'react';
import Panel from './Panel.jsx';
import { goesSectorConfig } from '../lib/locations.js';
import { evaluateStaleness } from '../lib/radar.js';
import {
  DURATION_PRESETS,
  FULL_DISK,
  GOES_VIEWS,
  LOAD_CONCURRENCY,
  buildGoesFrames,
  crossesUTCDay,
  defaultDurationH,
  describeLoop,
  formatStampUTC,
  frameIntervalMs,
  frameLoadOrder,
  gapIsMisleading,
  goesLatestUrl,
  missingTolerance,
  planLoop,
  playbackQuorum,
  pruneFrameStatus,
  staleThresholdMin,
  summarizeFrameLoad,
  summarizeGaps,
  terminatorCrossings,
} from '../lib/goes.js';

// GOES-West (GOES-18) imagery from the NOAA/NESDIS/STAR CDN, as an animated
// time-lapse rather than a single still — a still shows where the cloud IS, the
// loop shows where it is GOING, which is most of the reason to look at water
// vapour imagery at all.
//
// Frame addressing, the per-view scan cadences, and why the loop is computed
// rather than read from the CDN's directory index all live in lib/goes.js.
//
// Structurally this mirrors RadarPanel: hold the whole window before offering
// Play, then animate by swapping opacity on already-resident frames so stepping
// and scrubbing never touch the network. Two differences worth naming:
//
//   • No cache-busting. IEM's radar URLs are RELATIVE offsets, identical from
//     one refresh tick to the next, so radar MUST bust the cache or its loop
//     silently stops advancing. A GOES frame URL contains its own timestamp and
//     its bytes never change, so cache hits are the point rather than the enemy:
//     a refresh tick re-uses the eleven frames it already has and fetches only
//     the newly published one.
//   • Frame times are OBSERVED. The stamp is part of the URL we asked for, so a
//     frame that loaded has proven its own valid time. Radar's IEM frames can
//     only ever be 'derived', and are labelled so.

const BANDS = [
  { code: 'GEOCOLOR', label: 'GeoColor' },
  { code: '08', label: 'Upper WV (08)' },
  { code: '09', label: 'Mid WV (09)' },
  { code: '13', label: 'Clean IR (13)' },
  { code: 'AirMass', label: 'Air Mass RGB' },
];

// Playback speed multipliers, in the order the single cycling button steps
// through them. One button rather than three: at 380px the transport row has to
// hold Play, this, a scrubber and a stamp, and three more buttons is the item
// that does not fit. 1× is a ten-second pass over the window at any duration.
const SPEEDS = [1, 2, 0.5];
const SPEED_LABEL = { 1: '1×', 2: '2×', 0.5: '½×' };

// Below this duration a GeoColor window stays inside one day/night regime often
// enough not to warrant the note; at and above it the loop is crossing the
// terminator and the reader deserves to know before they read the flip as data.
const TERMINATOR_NOTE_FROM_H = 12;

// Fewest surviving frames that still constitute a LOOP rather than a picture.
//
// One constant, used by both the "this is a still picture" error and the gate on
// the animation interval, because those two previously disagreed: the error
// rendered below 3 frames while the interval kept running at 2, so the panel
// said "still picture, not a loop — do not read motion into it" over imagery
// that was visibly alternating. Anything that reads this threshold must read
// THIS name, so the message and the motion cannot drift apart again.
const MIN_LOOP_FRAMES = 3;

// How many missing frames are ordinary rather than a signal is no longer a
// constant — it depends on how many frames the window wants and how coarsely it
// steps. missingTolerance owns it, and still comes out at exactly 2 for the
// twelve-frame native window this used to hardcode.

// Live media-query hook, matching RadarPanel and WindDial: a preference change
// is honoured without a reload.
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

export default function Satellite({ location, refreshKey }) {
  const [band, setBand] = useState('08'); // upper-level WV default
  const [fullDisk, setFullDisk] = useState(false);
  // null is "not chosen yet", not a duration. While it holds, the view supplies
  // its own default and keeps supplying it as the view changes — so switching to
  // the full disk moves 1h → 3h rather than stranding it on a six-frame loop.
  // The first click pins the reader's choice, the way `playing` is pinned.
  const [durationH, setDurationH] = useState(null);
  const reducedMotion = usePrefersReducedMotion();

  const sector = goesSectorConfig(location.lat, location.lon).code;
  const view = fullDisk ? FULL_DISK : sector;
  const cfg = GOES_VIEWS[view];
  const activeDurationH = durationH ?? defaultDurationH(view);
  // Step, frame count and resolution all fall out of the duration together — see
  // planLoop for why they cannot be chosen independently.
  const plan = useMemo(
    () => planLoop({ view, durationH: activeDurationH }),
    [view, activeDurationH],
  );

  // Per-frame load outcome, URL → 'ok' | 'fail'. A 'fail' is normally just the
  // newest slot not published yet (the CDN runs 3–5 min behind the scan time,
  // and GEOCOLOR renders slower still), so it drops out of the loop rather than
  // being reported as a fault. See summarizeFrameLoad/pruneFrameStatus for why
  // the key is the URL and what "settled" is allowed to mean.
  const [status, setStatus] = useState({});
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion);
  const [speed, setSpeed] = useState(1);

  // Pure data — no fetching here; the <img> tags below do the loading.
  //
  // A duration change rewrites the window the same way a band or view change
  // does, so pruneFrameStatus drops the old verdicts on its own. One case does
  // better than that by accident and is worth not breaking: adjacent rungs that
  // share a step and a resolution (1h → 3h, both 5-minute 600x600) produce
  // overlapping URLs, so the twelve frames already loaded survive the switch.
  const frames = useMemo(
    () =>
      buildGoesFrames({
        now: Date.now(),
        view,
        band,
        count: plan.count,
        stepMin: plan.stepMin,
        size: plan.size,
      }),
    [view, band, refreshKey, plan],
  );

  useEffect(() => {
    setStatus((s) => pruneFrameStatus(frames, s));
  }, [frames]);

  const { usable, resolved, settled } = useMemo(
    () => summarizeFrameLoad(frames, status),
    [frames, status],
  );

  // Only a bounded prefix of the request order is mounted at a time, and the
  // prefix is derived from progress rather than tracked: an <img> is in flight
  // exactly while it is mounted and unresolved, so allowing `resolved +
  // LOAD_CONCURRENCY` mounts holds six requests open and no more. Unmounting the
  // rest is also what cancels them when a switch abandons the window.
  //
  // Nothing here touches frame construction. The order is an order OF `frames`;
  // the frames themselves, and their URLs, are exactly what buildGoesFrames
  // returned.
  const order = useMemo(() => frameLoadOrder(frames.length), [frames.length]);
  const mounted = useMemo(
    () => new Set(order.slice(0, Math.min(frames.length, resolved + LOAD_CONCURRENCY))),
    [order, frames.length, resolved],
  );

  // usable.indexOf per frame per render is quadratic, which was free at twelve
  // frames and is not at ninety-six while an animation is running.
  const usablePos = useMemo(() => new Map(usable.map((f, i) => [f.url, i])), [usable]);

  const quorum = playbackQuorum(frames.length);

  // "Is this a loop?" — asked once, here, and read by everything that has an
  // opinion about it: the animation timer, the Play control's label and its
  // disabled state, and whether the caption is allowed to call the window a
  // loop. Previously each of those decided separately and they disagreed, so
  // the panel could say "still picture, not a loop" above imagery that was
  // visibly alternating, beside a caption advertising a "5-min loop".
  //
  // The `settled` half is no longer the only way in. A long window reaches a
  // usable coarse loop long before its last frame answers, and holding playback
  // until then is the frozen panel this design exists to avoid — so a quorum of
  // landed frames also qualifies. Windows at or below the quorum have no quorum
  // to meet and still wait for `settled`, exactly as before.
  const canLoop =
    usable.length >= MIN_LOOP_FRAMES && (settled || (quorum != null && usable.length >= quorum));

  // While the loop cannot yet play, ride the newest frame that has loaded: the
  // reader has not chosen a position yet, and newest is what a satellite panel
  // should show at rest. Gated on canLoop rather than settled — the moment
  // playback is possible this must stop, or it would drag the index back to the
  // newest frame on every arrival for the whole remaining fill and fight the
  // timer for control of the playhead.
  useEffect(() => {
    if (canLoop) return;
    setIdx(Math.max(0, usable.length - 1));
  }, [usable, canLoop]);

  // The playhead is a TIME, not an index. Frames arrive coarse-to-fine, so each
  // one inserts into the MIDDLE of `usable` and shifts everything after it — a
  // preserved index would silently point at a different frame and the picture
  // would jump backwards on every arrival. Re-seeking to the nearest time also
  // gives continuity across a duration change for free.
  const playheadRef = useRef(null);
  useEffect(() => {
    if (!canLoop || usable.length === 0 || playheadRef.current == null) return;
    let best = 0;
    let bestDelta = Infinity;
    usable.forEach((f, i) => {
      const d = Math.abs(f.time - playheadRef.current);
      if (d < bestDelta) {
        bestDelta = d;
        best = i;
      }
    });
    setIdx(best);
    // Deliberately not keyed on the ref's value — it is read, never depended on.
  }, [usable, canLoop]);

  const safeIdx = Math.min(idx, Math.max(0, usable.length - 1));

  // Kept current after every render, and read only by the re-seek above — which
  // runs first on the render that changes `usable`, so it sees the time from
  // before the change, which is the one it needs.
  useEffect(() => {
    const cur = usable[safeIdx];
    if (cur) playheadRef.current = cur.time;
  });

  // The timer reads its delay and its length from refs, so it is built once per
  // play and never rebuilt by frames arriving. A setInterval keyed on the delay
  // would be torn down and restarted on every arrival — and since frames land
  // every few tens of milliseconds while the delay is several hundred, it would
  // be cleared before it ever fired and the loop would sit motionless for the
  // whole fill. That is the exact frozen panel progressive loading is for.
  const tickRef = useRef({ ms: 450, len: 0 });
  useEffect(() => {
    tickRef.current = { ms: frameIntervalMs(usable.length, speed), len: usable.length };
  });

  useEffect(() => {
    if (!playing || !canLoop) return undefined;
    let id;
    const tick = () => {
      setIdx((i) => (i + 1) % Math.max(1, tickRef.current.len));
      id = setTimeout(tick, tickRef.current.ms);
    };
    id = setTimeout(tick, tickRef.current.ms);
    return () => clearTimeout(id);
  }, [playing, canLoop]);

  // A preference change mid-session pauses a running loop.
  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  const cur = usable[safeIdx];
  const staleness = evaluateStaleness({
    newestTime: usable.length ? usable.at(-1).time : null,
    now: Date.now(),
    // The loop's step, not the view's cadence: a 60-minute-step window has a
    // newest frame up to an hour old by construction, and judging that against
    // psw's 20-minute cadence threshold would show the stale banner permanently.
    thresholdMin: staleThresholdMin(view, plan.stepMin),
    basis: 'observed',
  });
  const stale = staleness.level === 'stale';
  const span = usable.length > 1 ? Math.round((usable.at(-1).time - usable[0].time) / 60_000) : 0;
  // Meaningful only once `settled`, which is the only place any of this is read:
  // before that, an unanswered frame is still in flight rather than missing.
  const missing = frames.length - usable.length;
  const gaps = useMemo(() => summarizeGaps(frames, status), [frames, status]);
  const tolerance = missingTolerance({ count: frames.length, stepMin: plan.stepMin });
  const misleadingGap = gapIsMisleading({ longestRun: gaps.longestRun, stepMin: plan.stepMin });
  const gapMin = gaps.longestRun * plan.stepMin;
  const scatteredElsewhere = gaps.missing - gaps.longestRun;

  // A window that outlives a UTC day needs the date on every stamp; one that
  // does not would only be cluttered by it.
  const datedStamps =
    usable.length > 1 && crossesUTCDay(usable[0].time, usable.at(-1).time);

  const crossings = terminatorCrossings(activeDurationH);
  const showTerminatorNote =
    canLoop && band === 'GEOCOLOR' && activeDurationH >= TERMINATOR_NOTE_FROM_H && crossings > 0;

  const sub = fullDisk ? 'GOES-18 · Full Disk (~16 km)' : `GOES-18 · sector "${sector}" (~4 km)`;

  return (
    <Panel title="GOES-West Satellite" sub={sub}>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        {BANDS.map((b) => (
          <button
            key={b.code}
            className={band === b.code ? 'active' : ''}
            onClick={() => setBand(b.code)}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className={!fullDisk ? 'active' : ''} onClick={() => setFullDisk(false)}>
          Regional ({sector})
        </button>
        <button className={fullDisk ? 'active' : ''} onClick={() => setFullDisk(true)}>
          Full Disk
        </button>
      </div>
      {/* Duration sits with band and view, above the imagery, because all three
          change WHAT IS LOADED. The transport below the imagery changes only how
          you look at what is already loaded. Keeping those two classes on
          opposite sides of the picture is the grammar this panel already had.

          Seven rungs at ~42px is ~330px, so this holds one row at 380px; .btn-row
          is flex-wrap: wrap, so it falls to a second row rather than clipping if
          it ever does not. */}
      <div className="btn-row" style={{ marginBottom: 10 }}>
        {DURATION_PRESETS.map((h) => {
          const p = planLoop({ view, durationH: h });
          return (
            <button
              key={h}
              className={activeDurationH === h ? 'active' : ''}
              onClick={() => setDurationH(h)}
              // The consequences of the rung, which are otherwise invisible
              // until the picture softens: how many frames, how coarse, how big.
              title={`${p.count} frames · ${p.stepMin}-min steps · ${p.size}`}
            >
              {h}h
            </button>
          );
        })}
      </div>

      {/* --- honest states, most severe first --- */}
      {settled && usable.length === 0 && (
        <div className="state error">
          ⚠ No GOES-18 frames loaded for this product. The CDN may be down or this
          band may have stopped publishing — there is <strong>no imagery</strong> below.
        </div>
      )}
      {settled && usable.length > 0 && usable.length < MIN_LOOP_FRAMES && (
        <div className="state error">
          ⚠ Only {usable.length} of {frames.length} frames loaded. This is a still
          picture, not a loop — do not read motion into it.
        </div>
      )}
      {settled && usable.length >= MIN_LOOP_FRAMES && stale && (
        <div className="state error">
          ⚠ <strong>Imagery is stale.</strong> {staleness.message}
        </div>
      )}
      {/* Blocking only while the loop genuinely cannot play. Once quorum lands
          this gives way to the non-blocking footnote below the imagery — the
          panel's standing grammar, where a banner above means you cannot yet
          trust what you see and a caption below means it is true but partial.
          Determinate, because at 96 frames an indeterminate spinner tells the
          reader nothing about whether waiting is worth it. */}
      {!settled && !canLoop && frames.length > 0 && (
        <div className="state">
          <span className="spinner" /> Buffering loop — {resolved}/{frames.length} frames…
          <span className="load-bar">
            <i style={{ width: `${Math.round((resolved / frames.length) * 100)}%` }} />
          </span>
        </div>
      )}

      <div
        className="sat-loop"
        role="img"
        aria-label={
          `GOES-18 ${band} ${fullDisk ? 'full disk' : sector} time lapse` +
          (cur ? `, frame ${formatStampUTC(cur.time, { withDate: datedStamps })}` : '')
        }
      >
        {frames.map((f, i) => {
          if (!mounted.has(i)) return null;
          const pos = usablePos.has(f.url) ? usablePos.get(f.url) : -1;
          return (
            <img
              // A failed URL gets a new key on each refresh tick so React
              // remounts it and the browser actually retries; an unchanged src
              // on an existing element would never fire load or error again.
              key={status[f.url] === 'fail' ? `${f.url}#${refreshKey}` : f.url}
              className="sat-frame"
              style={{ opacity: pos !== -1 && pos === safeIdx ? 1 : 0 }}
              src={f.url}
              alt=""
              onLoad={() => setStatus((s) => (s[f.url] === 'ok' ? s : { ...s, [f.url]: 'ok' }))}
              onError={() => setStatus((s) => (s[f.url] === 'fail' ? s : { ...s, [f.url]: 'fail' }))}
            />
          );
        })}
        {/* On the imagery, not only in the transport row. Over 72 hours the
            stamp is the only thing that says which of three days you are
            looking at, and it has to be where the eye already is — which, while
            motion is playing, is the picture and not the controls. */}
        {cur && (
          <span className="sat-stamp">{formatStampUTC(cur.time, { withDate: datedStamps })}</span>
        )}
      </div>

      <div className="timeline">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          disabled={!canLoop}
          title={settled ? undefined : 'Buffering frames…'}
        >
          {/* Reads the ACTUAL state, not the intent. `playing` stays true across
              a window that drops below the loop threshold — it is the reader's
              standing preference, and it should survive so the loop resumes when
              frames come back — but rendering "⏸ Pause" over a motionless still
              would describe something that is not happening. */}
          {playing && canLoop ? '⏸ Pause' : '▶ Play'}
        </button>
        {/* One cycling button rather than a row of three. 1× is a ten-second
            pass over the window whatever its duration, so this is genuinely a
            preference and not a correction for long spans. */}
        <button
          type="button"
          onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
          disabled={!canLoop}
          title="Playback speed"
          aria-label={`Playback speed ${SPEED_LABEL[speed]}`}
        >
          {SPEED_LABEL[speed]}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, usable.length - 1)}
          value={safeIdx}
          aria-label="Satellite frame"
          disabled={usable.length < 2}
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
        />
        {/* UTC, and dated once the window outlives a day. Local time without a
            date cannot say which of three afternoons a 72-hour frame is from,
            and every timestamp elsewhere in this loop — the stamp in the URL,
            the gap times below — is UTC already. */}
        <span className={`frame-label${stale ? ' is-stale' : ''}`}>
          {cur ? formatStampUTC(cur.time, { withDate: datedStamps }) : '—'}
        </span>
      </div>

      {/* Degraded-but-usable loop. Deliberately a caption below the imagery
          rather than a banner above it: the loop still works and still means
          what it says, so this is a footnote about coverage, not a warning
          about validity. The hard error above owns the case where it stops
          being a loop at all. Without this line, losing a third of the window
          reads only as a quietly shorter loop — which is what a product rename
          or a sector going dark would look like. */}
      {canLoop && !settled && (
        <div className="obs-note sat-fill">
          Filling in — <strong>{resolved} of {frames.length}</strong> frames. The loop is playing
          the ones that have landed and will get finer as the rest arrive.
          <span className="load-bar">
            <i style={{ width: `${Math.round((resolved / frames.length) * 100)}%` }} />
          </span>
        </div>
      )}

      {/* Two independent triggers. Coverage asks whether more frames are missing
          than a window of this shape ordinarily loses. Continuity asks whether
          any single hole is big enough that the jump across it could be read as
          motion — which can be true while the total is entirely unremarkable,
          because three missing slots is fifteen minutes at native cadence and
          three hours at hourly steps. */}
      {settled && canLoop && (missing > tolerance || misleadingGap) && (
        <div className="obs-note sat-degraded">
          Running <strong>{usable.length} of {frames.length}</strong> frames —{' '}
          {misleadingGap ? (
            <>
              the CDN is missing a <strong>{gapMin}-minute stretch</strong> from{' '}
              {formatStampUTC(gaps.gapStartTime, { withDate: datedStamps })}
              {scatteredElsewhere > 0 &&
                `, plus ${scatteredElsewhere} scattered elsewhere`}
              . Cloud appears to jump across that hole; the movement is the gap, not weather.
            </>
          ) : (
            <>
              {missing} isolated {missing === 1 ? 'frame was' : 'frames were'} unavailable from the
              CDN. The loop is choppier for it but nothing is skipped over.
            </>
          )}
        </div>
      )}

      {/* GeoColor is two products, not one: true colour by day and an IR-based
          night rendering after dark, swapping over abruptly. Six of those flips
          in a 72-hour loop is a full-frame contrast change the eye re-baselines
          on, which is precisely what stops a local motion vector being readable.
          A note rather than an override — smoke, dust and snow cover are real
          reasons to want true colour over days, and silently switching a band
          the reader clicked would be the panel misreporting itself. */}
      {showTerminatorNote && (
        <div className="obs-note sat-terminator">
          GeoColor switches to a night rendering after dark, and this window crosses the
          terminator{' '}
          <strong>{crossings === 1 ? 'once' : `about ${crossings} times`}</strong> — motion does
          not read across {crossings === 1 ? 'that flip' : 'those flips'}.{' '}
          <em>Upper WV (08)</em> is one continuous product day and night.
        </div>
      )}

      <div className="obs-note">
        GOES-18 ABI imagery © NOAA/NESDIS/STAR
        {/* Gated on canLoop, not on `> 1`: two surviving frames do span five
            minutes, but advertising "a 5-min loop" here while the error above
            calls the same imagery a still picture is the panel contradicting
            itself in its own footnote. describeLoop owns the wording, including
            which interval is the honest one to quote. */}
        {canLoop &&
          ` · ${describeLoop({ spanMin: span, stepMin: plan.stepMin, cadenceMin: cfg.cadenceMin })}`}
        {/* Named only when the long-span budget has actually dropped a tier. The
            reader does not need telling that the picture is its normal size; they
            do need telling why it went soft when they reached for 24 hours. */}
        {canLoop && plan.size !== cfg.size && ` · ${plan.size.replace('x', '×')}`}
        {usable.length > 0 && ` · ${staleness.message}`}
        {' · '}
        <a href={goesLatestUrl({ view, band, size: cfg.size })} target="_blank" rel="noreferrer">
          newest frame
        </a>
      </div>
    </Panel>
  );
}
