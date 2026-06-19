import { useState } from 'react';
import Panel from './Panel.jsx';
import { goesSectorConfig } from '../lib/locations.js';

// GOES-West (GOES-18) imagery from the NOAA/NESDIS/STAR CDN. Loaded directly as
// <img> (the CDN serves images fine cross-site). Band switcher + sector/full-disk
// toggle. Default = upper-level water vapor (band 08).
const BANDS = [
  { code: 'GEOCOLOR', label: 'GeoColor' },
  { code: '08', label: 'Upper WV (08)' },
  { code: '09', label: 'Mid WV (09)' },
  { code: '13', label: 'Clean IR (13)' },
  { code: 'AirMass', label: 'Air Mass RGB' },
];

export default function Satellite({ location, refreshKey }) {
  const [band, setBand] = useState('08'); // upper-level WV default
  const [fullDisk, setFullDisk] = useState(false);
  const [errored, setErrored] = useState(false);

  const { code: sector, size } = goesSectorConfig(location.lat, location.lon);
  const base = 'https://cdn.star.nesdis.noaa.gov/GOES18/ABI';
  const url = fullDisk
    ? `${base}/FD/${band}/1808x1808.jpg?t=${refreshKey}`
    : `${base}/SECTOR/${sector}/${band}/${size}.jpg?t=${refreshKey}`;

  const sub = fullDisk ? 'GOES-18 · Full Disk (~16 km)' : `GOES-18 · sector "${sector}" (~4 km)`;

  return (
    <Panel title="GOES-West Satellite" sub={sub}>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        {BANDS.map((b) => (
          <button key={b.code} className={band === b.code ? 'active' : ''} onClick={() => { setBand(b.code); setErrored(false); }}>
            {b.label}
          </button>
        ))}
      </div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className={!fullDisk ? 'active' : ''} onClick={() => { setFullDisk(false); setErrored(false); }}>
          Regional ({sector})
        </button>
        <button className={fullDisk ? 'active' : ''} onClick={() => { setFullDisk(true); setErrored(false); }}>
          Full Disk
        </button>
      </div>
      {errored ? (
        <div className="state error">⚠ Image failed to load: {url}</div>
      ) : (
        <img
          className="sat-img"
          src={url}
          alt={`GOES-18 ${band} ${fullDisk ? 'full disk' : sector}`}
          onError={() => setErrored(true)}
          loading="lazy"
        />
      )}
    </Panel>
  );
}
