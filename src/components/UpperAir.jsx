import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import { nearestSounding, spcSector } from '../lib/locations.js';

// SPC mesoanalysis parameters (code → label). Codes are SPC's file names.
const SPC_PARMS = [
  { code: 'mucp', label: 'MUCAPE' },
  { code: 'mlcp', label: 'MLCAPE' },
  { code: 'sbcp', label: 'SBCAPE' },
  { code: 'laps', label: 'Mid lapse rate' }, // 700–500 mb lapse rate
  { code: 'lllr', label: 'Low lapse rate' }, // 0–3 km lapse rate
  { code: 'pwtr', label: 'PWAT' },
  { code: 'eshr', label: 'Effective shear' },
  { code: 'effh', label: 'Effective SRH' },
  { code: 'scp', label: 'Supercell comp.' },
  { code: 'stpc', label: 'Sig-tornado' }, // sig-tornado (effective layer)
];

// Both images are served through the local Express proxy (/api/...) because the
// upstream hosts (UWyo, SPC) block hotlinking/CORS. That's what makes them
// render as REAL INLINE IMAGES here.
export default function UpperAir({ location, refreshKey }) {
  const station = nearestSounding(location.lat, location.lon);
  const sector = spcSector(location.lat, location.lon);

  const [parm, setParm] = useState('mucp');
  const [soundingErr, setSoundingErr] = useState(false);
  const [spcErr, setSpcErr] = useState(false);
  const [soundingInfo, setSoundingInfo] = useState(null);

  useEffect(() => {
    setSoundingErr(false);
  }, [station.id, refreshKey]);
  useEffect(() => {
    setSpcErr(false);
  }, [parm, sector, refreshKey]);

  useEffect(() => {
    fetch(`/api/sounding-info?station=${station.id}`)
      .then((r) => r.json())
      .then(setSoundingInfo)
      .catch(() => setSoundingInfo(null));
  }, [refreshKey, station.id]);

  const soundingUrl = `/api/sounding?station=${station.id}&t=${refreshKey}`;
  const spcUrl = `/api/spc?sector=${sector}&parm=${parm}&t=${refreshKey}`;

  return (
    <Panel title="Upper-Air & Severe Analysis" sub="proxied · inline images">
      <div className="diag-section-title">
        Skew-T Sounding — {station.label}
        {soundingInfo?.found ? ` · ${soundingInfo.label} (most recent)` : ''}
      </div>
      <div className="img-frame">
        {soundingErr ? (
          <div className="state error">⚠ Sounding failed to load via proxy ({soundingUrl})</div>
        ) : (
          <img src={soundingUrl} alt={`Skew-T sounding ${station.label}`} onError={() => setSoundingErr(true)} />
        )}
      </div>

      <div className="diag-section-title" style={{ marginTop: 16 }}>
        SPC Mesoanalysis — sector {sector}
      </div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        {SPC_PARMS.map((p) => (
          <button key={p.code} className={parm === p.code ? 'active' : ''} onClick={() => setParm(p.code)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="img-frame">
        {spcErr ? (
          <div className="state error">⚠ SPC image failed to load via proxy ({spcUrl})</div>
        ) : (
          <img src={spcUrl} alt={`SPC mesoanalysis ${parm}`} onError={() => setSpcErr(true)} />
        )}
      </div>
    </Panel>
  );
}
