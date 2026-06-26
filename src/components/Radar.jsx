import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import Panel from './Panel.jsx';
import { getRadarFrames, tileUrl } from '../api/rainviewer.js';

// Live radar — RainViewer animated tiles on a dark Leaflet map. Includes past
// frames + nowcast frames, play/pause, and a timeline scrubber.
export default function Radar({ location, refreshKey }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const radarLayerRef = useRef(null);
  const dataRef = useRef(null); // { host, frames }

  const [frames, setFrames] = useState([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Init map once.
  useEffect(() => {
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: true }).setView(
      [location.lat, location.lon],
      6,
    );
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CARTO',
      maxZoom: 19,
    }).addTo(map);
    markerRef.current = L.circleMarker([location.lat, location.lon], {
      radius: 6,
      color: '#4fc3f7',
      weight: 2,
      fillColor: '#4fc3f7',
      fillOpacity: 0.6,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter on location change.
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView([location.lat, location.lon], 6);
      markerRef.current?.setLatLng([location.lat, location.lon]);
    }
  }, [location.lat, location.lon]);

  // Fetch radar frame index (and refresh handled by App key remount / interval).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRadarFrames()
      .then((d) => {
        if (cancelled) return;
        dataRef.current = d;
        setFrames(d.frames);
        // Start near "now" — the last past frame.
        const lastPast = d.frames.filter((f) => f.kind === 'past').length - 1;
        setIdx(Math.max(0, lastPast));
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.lat, location.lon, refreshKey]);

  // Swap the radar tile layer when the frame index changes.
  useEffect(() => {
    const map = mapRef.current;
    const data = dataRef.current;
    if (!map || !data || !frames[idx]) return;
    const url = tileUrl(data.host, frames[idx]);
    const layer = L.tileLayer(url, { opacity: 0.7, zIndex: 500 });
    layer.addTo(map);
    const prev = radarLayerRef.current;
    radarLayerRef.current = layer;
    // Remove previous after the new one paints (reduces flicker).
    if (prev) setTimeout(() => map.removeLayer(prev), 120);
  }, [idx, frames]);

  // Animation loop.
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % frames.length);
    }, 600);
    return () => clearInterval(t);
  }, [playing, frames.length]);

  const cur = frames[idx];

  return (
    <Panel title="Live Radar" sub="RainViewer · past + nowcast">
      {error ? (
        <div className="state error">⚠ {error}</div>
      ) : loading ? (
        <div className="state"><span className="spinner" /> Loading radar frames…</div>
      ) : null}
      <div ref={mapEl} className="map" />
      <div className="timeline">
        <button onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ Pause' : '▶ Play'}</button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={idx}
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
        />
        <span className="frame-label">
          {cur ? (
            <>
              {new Date(cur.time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{' '}
              {cur.kind === 'nowcast' ? <span className="nowcast">(forecast)</span> : ''}
            </>
          ) : (
            '—'
          )}
        </span>
      </div>
    </Panel>
  );
}
