import { useEffect, useMemo, useState } from 'react';
import Panel from './Panel.jsx';
import { goesSectorConfig } from '../lib/locations.js';
import { evaluateStaleness } from '../lib/radar.js';
import {
  FULL_DISK,
  GOES_VIEWS,
  buildGoesFrames,
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

  // Animate only once every candidate has resolved, so the loop cannot stutter
  // through frames that are still downloading.
  useEffect(() => {
    if (!playing || !settled || usable.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % usable.length), FRAME_MS);
    return () => clearInterval(t);
  }, [playing, settled, usable.length]);

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
      {settled && usable.length > 0 && usable.length < 3 && (
        <div className="state error">
          ⚠ Only {usable.length} of {frames.length} frames loaded. This is a still
          picture, not a loop — do not read motion into it.
        </div>
      )}
      {settled && usable.length >= 3 && stale && (
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
          disabled={!settled || usable.length < 2}
          title={settled ? undefined : 'Buffering frames…'}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
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

      <div className="obs-note">
        GOES-18 ABI imagery © NOAA/NESDIS/STAR
        {usable.length > 1 && ` · ${span}-min loop at ${cfg.cadenceMin}-min scans`}
        {usable.length > 0 && ` · ${staleness.message}`}
        {' · '}
        <a href={goesLatestUrl({ view, band, size: cfg.size })} target="_blank" rel="noreferrer">
          newest frame
        </a>
      </div>
    </Panel>
  );
}
