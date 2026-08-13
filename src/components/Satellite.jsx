import { useEffect, useMemo, useState } from 'react';
import Panel from './Panel.jsx';
import { goesSectorConfig } from '../lib/locations.js';
import { evaluateStaleness } from '../lib/radar.js';
import {
  FULL_DISK,
  GOES_VIEWS,
  buildGoesFrames,
  describeLoop,
  goesLatestUrl,
  pruneFrameStatus,
  staleThresholdMin,
  summarizeFrameLoad,
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

const FRAME_MS = 450; // a little quicker than radar's 600 — satellite motion is slower

// Fewest surviving frames that still constitute a LOOP rather than a picture.
//
// One constant, used by both the "this is a still picture" error and the gate on
// the animation interval, because those two previously disagreed: the error
// rendered below 3 frames while the interval kept running at 2, so the panel
// said "still picture, not a loop — do not read motion into it" over imagery
// that was visibly alternating. Anything that reads this threshold must read
// THIS name, so the message and the motion cannot drift apart again.
const MIN_LOOP_FRAMES = 3;

// How many missing frames are ordinary rather than a signal.
//
// The newest one or two slots are routinely not published yet — the CDN runs
// 3–5 minutes behind the scan time and GEOCOLOR renders slower still, so a
// 10-or-11-of-12 window is the healthy steady state, not a fault. Losing MORE
// than that is the case worth surfacing: a product rename or a sector going
// dark would otherwise show up only as a quietly shorter loop.
const EXPECTED_MISSING = 2;

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
  const reducedMotion = usePrefersReducedMotion();

  const sector = goesSectorConfig(location.lat, location.lon).code;
  const view = fullDisk ? FULL_DISK : sector;
  const cfg = GOES_VIEWS[view];

  // Per-frame load outcome, URL → 'ok' | 'fail'. A 'fail' is normally just the
  // newest slot not published yet (the CDN runs 3–5 min behind the scan time,
  // and GEOCOLOR renders slower still), so it drops out of the loop rather than
  // being reported as a fault. See summarizeFrameLoad/pruneFrameStatus for why
  // the key is the URL and what "settled" is allowed to mean.
  const [status, setStatus] = useState({});
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion);

  // Pure data — no fetching here; the <img> tags below do the loading.
  const frames = useMemo(
    () => buildGoesFrames({ now: Date.now(), view, band }),
    [view, band, refreshKey],
  );

  useEffect(() => {
    setStatus((s) => pruneFrameStatus(frames, s));
  }, [frames]);

  const { usable, resolved, settled } = useMemo(
    () => summarizeFrameLoad(frames, status),
    [frames, status],
  );

  // While the window is still filling, ride the newest frame that has loaded:
  // the reader has not chosen a position yet, and newest is what a satellite
  // panel should show at rest. Once settled the index is theirs — play advances
  // it, scrub sets it, and nothing else moves it until the next rebuild.
  useEffect(() => {
    if (settled) return;
    setIdx(Math.max(0, usable.length - 1));
  }, [usable, settled]);

  const safeIdx = Math.min(idx, Math.max(0, usable.length - 1));

  // "Is this a loop?" — asked once, here, and read by everything that has an
  // opinion about it: the animation interval, the Play control's label and its
  // disabled state, and whether the caption is allowed to call the window a
  // loop. Previously each of those decided separately and they disagreed, so
  // the panel could say "still picture, not a loop" above imagery that was
  // visibly alternating, beside a caption advertising a "5-min loop".
  const canLoop = settled && usable.length >= MIN_LOOP_FRAMES;

  // Animate only once every candidate has resolved, so the loop cannot stutter
  // through frames that are still downloading, and only when there are enough
  // frames to be a loop at all.
  useEffect(() => {
    if (!playing || !canLoop) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % usable.length), FRAME_MS);
    return () => clearInterval(t);
  }, [playing, canLoop, usable.length]);

  // A preference change mid-session pauses a running loop.
  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  const cur = usable[safeIdx];
  const staleness = evaluateStaleness({
    newestTime: usable.length ? usable.at(-1).time : null,
    now: Date.now(),
    thresholdMin: staleThresholdMin(view),
    basis: 'observed',
  });
  const stale = staleness.level === 'stale';
  const span = usable.length > 1 ? Math.round((usable.at(-1).time - usable[0].time) / 60_000) : 0;
  // Meaningful only once `settled`, which is the only place it is read: before
  // that, an unanswered frame is still in flight rather than missing.
  const missing = frames.length - usable.length;
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
      {!settled && frames.length > 0 && (
        <div className="state">
          <span className="spinner" /> Buffering loop — {resolved}/{frames.length} frames…
        </div>
      )}

      <div
        className="sat-loop"
        role="img"
        aria-label={`GOES-18 ${band} ${fullDisk ? 'full disk' : sector} time lapse`}
      >
        {frames.map((f) => {
          const pos = usable.indexOf(f);
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
        <span className={`frame-label${stale ? ' is-stale' : ''}`}>
          {cur
            ? new Date(cur.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            : '—'}
        </span>
      </div>

      {/* Degraded-but-usable loop. Deliberately a caption below the imagery
          rather than a banner above it: the loop still works and still means
          what it says, so this is a footnote about coverage, not a warning
          about validity. The hard error above owns the case where it stops
          being a loop at all. Without this line, losing a third of the window
          reads only as a quietly shorter loop — which is what a product rename
          or a sector going dark would look like. */}
      {settled && usable.length >= MIN_LOOP_FRAMES && missing > EXPECTED_MISSING && (
        <div className="obs-note sat-degraded">
          Running <strong>{usable.length} of {frames.length}</strong> frames — {missing} were
          unavailable from the CDN.
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
          ` · ${describeLoop({ spanMin: span, stepMin: cfg.cadenceMin, cadenceMin: cfg.cadenceMin })}`}
        {usable.length > 0 && ` · ${staleness.message}`}
        {' · '}
        <a href={goesLatestUrl({ view, band, size: cfg.size })} target="_blank" rel="noreferrer">
          newest frame
        </a>
      </div>
    </Panel>
  );
}
