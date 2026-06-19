import { useEffect, useRef, useState } from 'react';
import Panel from './Panel.jsx';

// Model forecast maps — latest full model runs (precip, precip type, wind) from
// Tropical Tidbits, routed through the local proxy (/api/model) which adds the
// required Referer and resolves the latest available run. Frame slider steps the
// forecast hour (3-hourly); play animates the run.
const MODELS = [
  { code: 'gfs', label: 'GFS' },
  { code: 'nam', label: 'NAM' },
  { code: 'ecmwf', label: 'ECMWF' },
];
const FIELDS = [
  { code: 'mslp_pcpn', label: 'Precip + MSLP' },
  { code: 'ref_frzn', label: 'Precip type (radar)' },
  { code: 'mslp_wind', label: '10 m Wind' },
  { code: 'apcpn', label: 'Total precip' },
];
const REGIONS = {
  gfs: [{ code: 'wus', label: 'Western US' }, { code: 'us', label: 'CONUS' }],
  ecmwf: [{ code: 'wus', label: 'Western US' }, { code: 'us', label: 'CONUS' }],
  nam: [{ code: 'us', label: 'CONUS' }, { code: 'namer', label: 'N. America' }],
};

export default function ModelMaps({ location, refreshKey }) {
  const western = location.lon <= -104;
  const [model, setModel] = useState('gfs');
  const [field, setField] = useState('mslp_pcpn');
  const [region, setRegion] = useState(western ? 'wus' : 'us');
  const [frame, setFrame] = useState(3);
  const [playing, setPlaying] = useState(false);
  const [info, setInfo] = useState(null); // { run, label, maxFrame }
  const [err, setErr] = useState(false);
  const [infoErr, setInfoErr] = useState(false);
  const regionOpts = REGIONS[model];
  const maxFrame = info?.maxFrame || 41;

  // Keep region valid for the selected model.
  useEffect(() => {
    if (!regionOpts.some((r) => r.code === region)) setRegion(regionOpts[0].code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Resolve the latest run for the selected model.
  useEffect(() => {
    let cancel = false;
    setInfoErr(false);
    fetch(`/api/model-info?model=${model}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (j.found) {
          setInfo(j);
          setFrame((f) => Math.min(f, j.maxFrame));
        } else setInfoErr(true);
      })
      .catch(() => !cancel && setInfoErr(true));
    return () => { cancel = true; };
  }, [model, refreshKey]);

  useEffect(() => setErr(false), [model, field, region, frame, info?.run]);

  // Animation.
  const timer = useRef(null);
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setFrame((f) => (f >= maxFrame ? 1 : f + 1)), 700);
    return () => clearInterval(timer.current);
  }, [playing, maxFrame]);

  const fhr = (frame - 1) * 3;
  const run = info?.run;
  const src = run
    ? `/api/model?model=${model}&field=${field}&region=${region}&frame=${frame}&run=${run}`
    : null;

  return (
    <Panel title="Model Forecast Maps" sub={info?.label ? `${model.toUpperCase()} ${info.label} run` : 'latest model run'}>
      <div className="btn-row" style={{ marginBottom: 6 }}>
        {MODELS.map((m) => (
          <button key={m.code} className={model === m.code ? 'active' : ''} onClick={() => setModel(m.code)}>{m.label}</button>
        ))}
        <span style={{ width: 12 }} />
        {regionOpts.map((r) => (
          <button key={r.code} className={region === r.code ? 'active' : ''} onClick={() => setRegion(r.code)}>{r.label}</button>
        ))}
      </div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        {FIELDS.map((f) => (
          <button key={f.code} className={field === f.code ? 'active' : ''} onClick={() => setField(f.code)}>{f.label}</button>
        ))}
      </div>

      {infoErr ? (
        <div className="state error">⚠ Could not resolve the latest {model.toUpperCase()} run via proxy.</div>
      ) : !run ? (
        <div className="state"><span className="spinner" /> Finding latest run…</div>
      ) : (
        <>
          <div className="img-frame">
            {err ? (
              <div className="state error">⚠ Map unavailable for {model.toUpperCase()} {field} f{fhr.toString().padStart(3, '0')} ({src})</div>
            ) : (
              <img src={src} alt={`${model} ${field} f${fhr}`} onError={() => setErr(true)} />
            )}
          </div>
          <div className="timeline">
            <button onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ Pause' : '▶ Play'}</button>
            <input type="range" min={1} max={maxFrame} value={frame} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} />
            <span className="frame-label">f{fhr.toString().padStart(3, '0')} · +{fhr} h</span>
          </div>
          <div className="obs-note">
            {model.toUpperCase()} {info.label} run · Tropical Tidbits (proxied inline) · frame steps 3-hourly.
          </div>
        </>
      )}
    </Panel>
  );
}
