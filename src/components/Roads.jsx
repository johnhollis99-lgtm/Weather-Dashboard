import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import { roadState } from '../lib/locations.js';

// Road conditions via official embedded maps (no parsed API):
//  - Caltrans QuickMap (quickmap.dot.ca.gov) — embeds directly (no X-Frame-Options)
//  - NDOT 511 (nvroads.com) — sends X-Frame-Options, so it's routed through the
//    local proxy (/api/ndot) which strips that header and injects <base>.
// Tahoe straddles both → default Caltrans (most passes are CA-side) with an NDOT
// toggle. Outside CA/NV we note that road data is only wired for CA/NV.
export default function Roads({ location }) {
  const state = roadState(location.lat, location.lon, location.name);
  const [src, setSrc] = useState(state === 'NV' ? 'ndot' : 'caltrans');

  useEffect(() => {
    setSrc(roadState(location.lat, location.lon, location.name) === 'NV' ? 'ndot' : 'caltrans');
  }, [location.lat, location.lon, location.name]);

  const wired = state === 'CA' || state === 'NV';
  const ext = src === 'caltrans' ? 'https://quickmap.dot.ca.gov/' : 'https://www.nvroads.com/';
  const iframeSrc = src === 'caltrans' ? 'https://quickmap.dot.ca.gov/' : '/api/ndot';

  return (
    <Panel title="Road Conditions" sub={src === 'caltrans' ? 'Caltrans QuickMap (CA)' : 'NDOT 511 (NV)'}>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        <button className={src === 'caltrans' ? 'active' : ''} onClick={() => setSrc('caltrans')}>Caltrans QuickMap (CA)</button>
        <button className={src === 'ndot' ? 'active' : ''} onClick={() => setSrc('ndot')}>NDOT 511 (NV)</button>
        <a href={ext} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 13 }}>
          Open full site ↗
        </a>
      </div>

      {!wired && (
        <div className="finding watch" style={{ marginBottom: 8 }}>
          <div className="f-title">Road data is wired for CA/NV only</div>
          <div style={{ fontSize: 13 }}>
            You're viewing <strong>{location.name}</strong> ({state || 'outside CA/NV'}). Showing the CA/NV maps below; for
            this state, consult its DOT/511 service.
          </div>
        </div>
      )}

      <iframe
        key={src}
        title={src === 'caltrans' ? 'Caltrans QuickMap' : 'NDOT 511'}
        src={iframeSrc}
        className="road-frame"
        loading="lazy"
      />
      {src === 'ndot' && (
        <div className="obs-note">
          NDOT blocks direct embedding; shown via the local proxy. If the live incident layer doesn't paint (their data
          API may block cross-origin requests), use “Open full site ↗”.
        </div>
      )}
    </Panel>
  );
}
