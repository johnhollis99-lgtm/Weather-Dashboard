import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import Panel from './Panel.jsx';
import { nearestRadar } from '../lib/locations.js';
import { getRainviewerIndex } from '../api/rainviewer.js';
import { sampleIemFreshness } from '../api/iem.js';
import {
  LEGEND_NOTE,
  buildIemFrames,
  buildLegend,
  buildRainviewerFrames,
  classifyFreshness,
  evaluateStaleness,
  reconcileFrameIndex,
} from '../lib/radar.js';

// The interactive radar: one panel, two selectable sources, an animated loop of
// the past hour, and an honest account of how old the picture is.
//
// Replaces the former split between RadarHiRes (IEM tiles, no animation) and
// Live Radar (RainViewer, animated) — two Leaflet maps stacked in the Imagery
// section, each missing what the other had.
//
// IEM is the default because its tiles ship the standard NWS reflectivity colors
// natively and step every 5 minutes; RainViewer is the alternate for global
// coverage. See lib/radar.js for why IEM frame times are labelled DERIVED and
// how staleness is established without a product time.

const SOURCES = {
  iem: {
    id: 'iem',
    label: 'NEXRAD (IEM)',
    attribution: 'NEXRAD N0Q base reflectivity © Iowa State Mesonet (IEM)',
    opacity: 0.8,
  },
  rainviewer: {
    id: 'rainviewer',
    label: 'RainViewer',
    attribution: 'Radar composite © RainViewer',
    opacity: 0.7,
  },
};

const SOURCE_KEY = 'wx.radar.source';
const FRAME_MS = 600;

// Live media-query hook, matching the pattern already used by WindDial — a
// preference change is honoured without a reload.
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

export default function RadarPanel({ location, refreshKey }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const siteRef = useRef(null);
  const layersRef = useRef([]); // one Leaflet layer per frame, all pre-added
  const site = nearestRadar(location.lat, location.lon);
  const reducedMotion = usePrefersReducedMotion();

  const [source, setSource] = useState(() => {
    try {
      const v = localStorage.getItem(SOURCE_KEY);
      return v && SOURCES[v] ? v : 'iem';
    } catch {
      return 'iem';
    }
  });
  const [frames, setFrames] = useState([]);
  const [idx, setIdx] = useState(0);
  // Paused by default under prefers-reduced-motion. The control still works —
  // the loop simply doesn't start moving on its own.
  const [playing, setPlaying] = useState(!reducedMotion);
  const [ready, setReady] = useState(0); // frames whose tiles have finished loading
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [freshness, setFreshness] = useState(null); // IEM self-test verdict
  const [network, setNetwork] = useState(null); // RainViewer-derived staleness
  const [tileError, setTileError] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  const legend = useMemo(() => buildLegend(), []);
  const cfg = SOURCES[source];

  const chooseSource = useCallback((next) => {
    setSource(next);
    try {
      localStorage.setItem(SOURCE_KEY, next);
    } catch {
      /* private mode — the choice just isn't remembered */
    }
  }, []);

  // --- map init: ONCE. Never re-run, so refresh can never reset the viewport --
  useEffect(() => {
    const map = L.map(mapEl.current, { zoomControl: true }).setView(
      [location.lat, location.lon],
      7, // ~150–250 km across at typical panel widths: the regional picture
    );
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CARTO',
      maxZoom: 19,
    }).addTo(map);
    markerRef.current = L.circleMarker([location.lat, location.lon], {
      radius: 6, color: '#4fc3f7', weight: 2, fillColor: '#4fc3f7', fillOpacity: 0.6,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter only when the LOCATION changes — not on refresh, not on source
  // change. Zoom 7 matches the mount zoom so the two can't fight (the old
  // RadarHiRes mounted at 7 and was immediately overridden to 8).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([location.lat, location.lon], 7);
    markerRef.current?.setLatLng([location.lat, location.lon]);
    if (siteRef.current) map.removeLayer(siteRef.current);
    siteRef.current = L.circleMarker([site.lat, site.lon], {
      radius: 7, color: '#e0b341', weight: 2, fillColor: '#e0b341', fillOpacity: 0.25,
    })
      .addTo(map)
      .bindTooltip(`WSR-88D ${site.id} — ${site.name}`, { permanent: false });
  }, [location.lat, location.lon, site.lat, site.lon, site.id, site.name]);

  // --- frame list: rebuilt on source change and on the refresh tick ----------
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setTileError(false);

    async function load() {
      try {
        let next;
        if (source === 'iem') {
          next = buildIemFrames(Date.now(), refreshKey);
        } else {
          const index = await getRainviewerIndex(ac.signal);
          next = buildRainviewerFrames(index);
          if (next.length === 0) throw new Error('no frames published');
        }
        if (cancelled) return;
        setFrames((prev) => {
          setIdx((i) => reconcileFrameIndex(prev, next, i));
          return next;
        });
        setLoading(false);
      } catch (e) {
        if (cancelled || ac.signal.aborted) return;
        setError(e.message || String(e));
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [source, refreshKey]);

  // --- honesty signals -------------------------------------------------------
  // Network-level: RainViewer's absolute timestamps. Fetched whichever source is
  // selected, because for IEM this is the only age signal that exists at all.
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    getRainviewerIndex(ac.signal)
      .then((index) => {
        if (cancelled) return;
        const rv = buildRainviewerFrames(index);
        const newest = rv.length ? Math.max(...rv.map((f) => f.time)) : null;
        setNetwork(evaluateStaleness({ newestTime: newest, now: Date.now(), basis: 'observed' }));
      })
      .catch(() => {
        if (!cancelled) setNetwork(null); // probe unavailable: say nothing rather than guess
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [refreshKey]);

  // IEM self-test: does the picture actually move across the loop window?
  useEffect(() => {
    if (source !== 'iem') {
      setFreshness(null);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    sampleIemFreshness({ cacheBust: refreshKey, signal: ac.signal })
      .then(({ newestHashes, oldestHashes }) => {
        if (cancelled) return;
        setFreshness(classifyFreshness(newestHashes, oldestHashes));
      })
      .catch(() => {
        if (!cancelled) setFreshness({ level: 'unknown', reason: 'Freshness probe unavailable.' });
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [source, refreshKey]);

  // --- PREFETCH: build every frame's layer up front, all added at opacity 0 ---
  // The old RainViewer panel created a layer per frame at display time and tore
  // down the previous one, so playing the loop downloaded it. Here the whole
  // window is resident before Play is offered.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || frames.length === 0) return;

    layersRef.current.forEach((l) => map.removeLayer(l));
    layersRef.current = [];
    setReady(0);

    let errors = 0;
    const layers = frames.map((f) =>
      L.tileLayer(f.url, {
        opacity: 0,
        zIndex: 500,
        attribution: cfg.attribution,
        crossOrigin: true,
      })
        .on('load', () => setReady((r) => r + 1))
        // A few 404s are normal where a source has no coverage; only a broad
        // failure means the layer is actually down.
        .on('tileerror', () => {
          errors += 1;
          if (errors >= 8) setTileError(true);
        })
        .addTo(map),
    );
    layersRef.current = layers;

    return () => {
      layers.forEach((l) => map.removeLayer(l));
      layersRef.current = [];
    };
  }, [frames, cfg.attribution]);

  // Show exactly one frame. Opacity swap on resident layers — no network work,
  // so stepping and scrubbing are instant.
  useEffect(() => {
    layersRef.current.forEach((l, i) => l.setOpacity(i === idx ? cfg.opacity : 0));
  }, [idx, frames, cfg.opacity]);

  // --- animation -------------------------------------------------------------
  const prefetched = frames.length > 0 && ready >= frames.length;
  useEffect(() => {
    if (!playing || frames.length === 0 || !prefetched) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % frames.length), FRAME_MS);
    return () => clearInterval(t);
  }, [playing, frames.length, prefetched]);

  // A preference change mid-session pauses a running loop.
  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  const cur = frames[idx];
  const derived = cur?.timeBasis === 'derived';
  const stale =
    freshness?.level === 'frozen' ||
    (source === 'rainviewer' && network?.level === 'stale');

  return (
    <Panel
      title="Radar"
      sub={`${cfg.label} · nearest WSR-88D ${site.id} · ${site.name}`}
      kind="official"
    >
      <div className="radar-bar">
        <div className="radar-sources" role="group" aria-label="Radar source">
          {Object.values(SOURCES).map((s) => (
            <button
              key={s.id}
              type="button"
              className={`radar-src${source === s.id ? ' is-active' : ''}`}
              aria-pressed={source === s.id}
              onClick={() => chooseSource(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="radar-legend-toggle"
          onClick={() => setLegendOpen((o) => !o)}
          aria-expanded={legendOpen}
        >
          {legendOpen ? 'Hide scale' : 'Scale'}
        </button>
      </div>

      {/* --- honest states, most severe first --- */}
      {error && (
        <div className="state error">
          ⚠ {cfg.label} frame list unavailable ({error}). The map below is real, but it is showing{' '}
          <strong>no precipitation data</strong>.
        </div>
      )}
      {!error && tileError && (
        <div className="state error">
          ⚠ Reflectivity tiles aren’t loading from {cfg.label}. The base map is real, but it is
          showing <strong>no radar data</strong>. Try ↻ Refresh; if it persists the tile service is
          likely down.
        </div>
      )}
      {!error && !tileError && freshness?.level === 'frozen' && (
        <div className="state error">
          ⚠ <strong>Radar may be stale.</strong> {freshness.reason} The loop below is showing the
          same picture it showed an hour ago — do not read it as current.
        </div>
      )}
      {!error && !tileError && source === 'rainviewer' && network?.level === 'stale' && (
        <div className="state error">
          ⚠ <strong>Radar is stale.</strong> {network.message}
        </div>
      )}
      {!error && loading && (
        <div className="state">
          <span className="spinner" /> Loading {cfg.label} frames…
        </div>
      )}
      {!error && !loading && !prefetched && frames.length > 0 && (
        <div className="state">
          <span className="spinner" /> Buffering loop — {ready}/{frames.length} frames…
        </div>
      )}

      <div ref={mapEl} className="map" />

      {legendOpen && (
        <div className="radar-legend" role="img" aria-label="Reflectivity scale in dBZ">
          <div className="radar-legend-ramp">
            {legend.map((b) => (
              <div key={b.dbz} className="radar-legend-band">
                <span className="radar-legend-swatch" style={{ background: b.fill }} />
                <span className="radar-legend-label">{b.label}</span>
              </div>
            ))}
          </div>
          <p className="radar-legend-note">{LEGEND_NOTE}</p>
        </div>
      )}

      <div className="timeline">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          disabled={!prefetched}
          title={prefetched ? undefined : 'Buffering frames…'}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={idx}
          aria-label="Radar frame"
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
        />
        <span className={`frame-label${stale ? ' is-stale' : ''}`}>
          {cur ? (
            <>
              {new Date(cur.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              {cur.kind === 'nowcast' && <span className="nowcast"> (forecast)</span>}
              {derived && (
                <span
                  className="frame-basis"
                  title="IEM serves frames as offsets from now, with no published product time. This clock time is computed from your device, not observed."
                >
                  {' '}derived
                </span>
              )}
            </>
          ) : (
            '—'
          )}
        </span>
      </div>

      <div className="obs-note">
        {cfg.attribution}
        {source === 'iem' && freshness?.level === 'unverifiable' && (
          <>
            {' · '}
            <span title={freshness.reason}>
              freshness unverifiable — no echo in the sample area
            </span>
          </>
        )}
        {source === 'iem' && network && (
          <>
            {' · '}radar network {network.level === 'stale' ? 'quiet' : 'active'}: {network.message}{' '}
            <span className="muted">(RainViewer — network-level check, not IEM’s cache)</span>
          </>
        )}
        {' · '}◯ amber = nearest radar site
      </div>
    </Panel>
  );
}
