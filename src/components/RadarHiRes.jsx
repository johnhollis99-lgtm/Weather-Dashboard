import { useEffect, useRef } from 'react';
import L from 'leaflet';
import Panel from './Panel.jsx';
import { nearestRadar } from '../lib/locations.js';

// High-resolution interactive base-reflectivity radar using the Iowa State
// Mesonet (IEM) NEXRAD N0Q tile cache — keyless, CORS-enabled, traditional
// NWS reflectivity coloring. Real pan/zoom Leaflet layer centered on location,
// with the nearest WSR-88D site marked.
const N0Q = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';

export default function RadarHiRes({ location, refreshKey }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const radarRef = useRef(null);
  const markerRef = useRef(null);
  const siteRef = useRef(null);
  const site = nearestRadar(location.lat, location.lon);

  useEffect(() => {
    const map = L.map(mapEl.current, { zoomControl: true }).setView([location.lat, location.lon], 7);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CARTO',
      maxZoom: 19,
    }).addTo(map);
    radarRef.current = L.tileLayer(N0Q, {
      opacity: 0.8,
      zIndex: 500,
      attribution: 'NEXRAD N0Q © Iowa State Mesonet (IEM)',
    }).addTo(map);
    markerRef.current = L.circleMarker([location.lat, location.lon], {
      radius: 6, color: '#4fc3f7', weight: 2, fillColor: '#4fc3f7', fillOpacity: 0.6,
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter + move location marker + (re)place the WSR-88D site marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([location.lat, location.lon], 8);
    markerRef.current?.setLatLng([location.lat, location.lon]);
    if (siteRef.current) map.removeLayer(siteRef.current);
    siteRef.current = L.circleMarker([site.lat, site.lon], {
      radius: 7, color: '#e0b341', weight: 2, fillColor: '#e0b341', fillOpacity: 0.25,
    })
      .addTo(map)
      .bindTooltip(`WSR-88D ${site.id} — ${site.name}`, { permanent: false });
  }, [location.lat, location.lon, site.lat, site.lon, site.id, site.name]);

  // Refresh the reflectivity tiles on the auto-refresh tick.
  useEffect(() => {
    const layer = radarRef.current;
    if (layer) layer.setUrl(`${N0Q}?_=${refreshKey}`);
  }, [refreshKey]);

  return (
    <Panel title="High-Res Radar (NEXRAD N0Q)" sub={`nearest: WSR-88D ${site.id} · ${site.name}`}>
      <div ref={mapEl} className="map" />
      <div className="obs-note" style={{ marginTop: 8 }}>
        Base reflectivity composite via Iowa State Mesonet · interactive pan/zoom · ◯ amber = nearest radar site.
      </div>
    </Panel>
  );
}
