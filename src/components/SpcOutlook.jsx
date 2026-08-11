import { useState } from 'react';
import Panel from './Panel.jsx';

// SPC national convective & fire-weather categorical outlooks.
//
// Split out of the Hazards panel for layout reasons: the outlook map is a
// tall, fixed-aspect national graphic, and keeping it inside Hazards made that
// column roughly 2.5x the height of the Meteorological Analysis card beside it
// — the grid stretched Analysis to match, leaving a large empty card. As its
// own panel it sits with the other national map products, and both columns of
// "The Read" size to their content.
//
// This is an OFFICIAL SPC product (proxied inline because SPC blocks
// hotlinking), so it keeps the solid provenance rule, not the derived hatch.
const SPC_IMAGES = [
  { key: 'day1cat', label: 'Day 1 Convective' },
  { key: 'day2cat', label: 'Day 2 Convective' },
  { key: 'day1fire', label: 'Day 1 Fire Wx' },
  { key: 'day2fire', label: 'Day 2 Fire Wx' },
];

export default function SpcOutlook() {
  const [spc, setSpc] = useState('day1cat');
  const [spcErr, setSpcErr] = useState(false);

  return (
    <Panel title="SPC Convective &amp; Fire Outlook" sub="NOAA SPC · categorical · proxied inline" kind="official">
      <div className="btn-row" style={{ marginBottom: 10 }}>
        {SPC_IMAGES.map((x) => (
          <button
            key={x.key}
            className={spc === x.key ? 'active' : ''}
            onClick={() => {
              setSpc(x.key);
              setSpcErr(false);
            }}
          >
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
      <div className="obs-note">
        National categorical outlooks from NOAA/NWS Storm Prediction Center. Local hazard detail is in the Hazards
        &amp; Warnings panel.
      </div>
    </Panel>
  );
}
