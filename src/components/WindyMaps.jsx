import Panel from './Panel.jsx';

// Windy.com embedded maps. Each map is the official keyless embed
// (embed.windy.com/embed2.html) centered on the selected city's coordinates —
// the same `location` state (pink/selected marker) the rest of the dashboard
// uses. The iframe `src` is rebuilt from location.lat/lon and keyed on it, so
// React remounts (re-centers) the embed whenever the selected city changes.
// Each overlay is its own component/panel so one failing iframe never affects
// the others (failure-isolation convention).

const ZOOM = 7;

function windySrc(lat, lon, overlay) {
  const params = new URLSearchParams({
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    detailLat: lat.toFixed(4),
    detailLon: lon.toFixed(4),
    zoom: String(ZOOM),
    level: 'surface',
    overlay,
    marker: 'true',
    message: 'true',
    calendar: 'now',
    type: 'map',
    location: 'coordinates',
    metricWind: 'mph',
    metricTemp: '°F',
  });
  return `https://embed.windy.com/embed2.html?${params.toString()}`;
}

function WindyEmbed({ location, overlay, title, sub }) {
  const src = windySrc(location.lat, location.lon, overlay);
  const ext = `https://www.windy.com/?${overlay},${location.lat.toFixed(3)},${location.lon.toFixed(3)},${ZOOM}`;

  return (
    <Panel title={title} sub={sub}>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        <a
          href={ext}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 13 }}
        >
          Open in Windy ↗
        </a>
      </div>
      <iframe
        key={src}
        title={title}
        src={src}
        className="road-frame"
        loading="lazy"
        allow="fullscreen"
        frameBorder="0"
      />
      <div className="obs-note">
        Windy.com embed centered on <strong>{location.name}</strong>.
      </div>
    </Panel>
  );
}

export function WindyRadar({ location }) {
  return (
    <WindyEmbed
      location={location}
      overlay="radar"
      title="Windy — Radar & Lightning"
      sub="Windy.com · radar + lightning overlay"
    />
  );
}

export function WindyWind({ location }) {
  return (
    <WindyEmbed
      location={location}
      overlay="wind"
      title="Windy — Wind"
      sub="Windy.com · wind overlay"
    />
  );
}

export function WindyWaves({ location }) {
  return (
    <WindyEmbed
      location={location}
      overlay="waves"
      title="Windy — Waves"
      sub="Windy.com · waves overlay"
    />
  );
}
