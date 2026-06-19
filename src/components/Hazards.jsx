import { useState } from 'react';
import Panel, { ResourceState } from './Panel.jsx';
import { fmt, localTime } from '../lib/units.js';

// All-hazards panel with three clearly-labeled layers:
//  1. Official NWS active alerts
//  2. Official probabilistic fields (NWS PoP/PoT + SPC outlooks)
//  3. DERIVED 18-hour hazard assessment (explicitly not an official probability)

const SEV_CLASS = { Extreme: 'warn', Severe: 'warn', Moderate: 'watch', Minor: 'info', Unknown: 'info' };
const LEVEL_CLASS = { High: 'warn', Moderate: 'watch', Low: 'info', None: 'good' };

const SPC_IMAGES = [
  { key: 'day1cat', label: 'Day 1 Convective' },
  { key: 'day2cat', label: 'Day 2 Convective' },
  { key: 'day1fire', label: 'Day 1 Fire Wx' },
  { key: 'day2fire', label: 'Day 2 Fire Wx' },
];

export default function Hazards({ alerts, sum, hazards }) {
  const [spc, setSpc] = useState('day1cat');
  const [spcErr, setSpcErr] = useState(false);
  const s = sum || {};

  return (
    <Panel title="Hazards & Warnings" sub="official + derived · next 18h">
      {/* ---- Layer 1: official active alerts ---- */}
      <div className="diag-section-title">① Official NWS active alerts</div>
      <ResourceState resource={alerts}>
        {alerts?.data?.length ? (
          alerts.data.map((a) => (
            <div className={`finding ${SEV_CLASS[a.severity] || 'info'}`} key={a.id}>
              <div className="f-title">{a.event} <span className="m-unit">· {a.severity}</span></div>
              <div className="obs-note">
                {a.areaDesc}
                {a.onset || a.expires ? ` · ${localTime(a.onset, { month: 'short', day: 'numeric', hour: 'numeric' })} → ${localTime(a.expires, { month: 'short', day: 'numeric', hour: 'numeric' })}` : ''}
              </div>
              {a.headline && <div style={{ fontSize: 13, marginTop: 4 }}>{a.headline}</div>}
            </div>
          ))
        ) : (
          <div className="finding good"><div className="f-title">No active alerts</div></div>
        )}
      </ResourceState>

      {/* ---- Layer 2: official probabilistic fields ---- */}
      <div className="diag-section-title">② Official probabilistic fields</div>
      <div className="diag-grid">
        <div className="metric">
          <div className="m-label">NWS thunder prob (max 18h)</div>
          <div className="m-value">{s.maxPoT != null ? `${fmt(s.maxPoT)}%` : 'n/a'}</div>
        </div>
        <div className="metric">
          <div className="m-label">NWS precip prob (max 18h)</div>
          <div className="m-value">{s.maxPoP != null ? `${fmt(s.maxPoP)}%` : 'n/a'}</div>
        </div>
      </div>
      <div className="btn-row" style={{ margin: '10px 0' }}>
        {SPC_IMAGES.map((x) => (
          <button key={x.key} className={spc === x.key ? 'active' : ''} onClick={() => { setSpc(x.key); setSpcErr(false); }}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="img-frame">
        {spcErr ? (
          <div className="state error">⚠ SPC outlook failed to load via proxy (/api/spc-outlook?img={spc})</div>
        ) : (
          <img src={`/api/spc-outlook?img=${spc}`} alt={`SPC ${spc}`} onError={() => setSpcErr(true)} />
        )}
      </div>
      <div className="obs-note">SPC national convective &amp; fire-weather outlooks (categorical), proxied inline.</div>

      {/* ---- Layer 3: derived assessment ---- */}
      <div className="diag-section-title">③ Derived 18-hour hazard assessment</div>
      <div className="derived-banner">
        🧠 Claude's derived assessment — <strong>not an official probability</strong>. Rule-based read of the raw diagnostics.
      </div>
      {(hazards || []).map((h) => (
        <div className={`finding ${LEVEL_CLASS[h.level] || 'info'}`} key={h.hazard}>
          <div className="f-title">
            {h.hazard}: {h.level} <span className="m-unit">(~{h.pct}%)</span>
          </div>
          <div style={{ fontSize: 13 }}>{h.reason}</div>
        </div>
      ))}
      {!hazards?.length && <div className="state">Awaiting diagnostics…</div>}
    </Panel>
  );
}
