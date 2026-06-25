import { useState } from 'react';
import DiagnosticSounding from './components/DiagnosticSounding.jsx';
import { sampleProfiles } from './lib/sampleProfiles.js';

// Offline demo "route" (open #sounding-demo). Renders all three sample
// profiles, with dark/light and imperial/metric switches so both themes and
// unit systems can be verified without the dashboard's live data.
export default function SoundingDemo() {
  const [theme, setTheme] = useState('dark');
  const [units, setUnits] = useState('imperial');

  // The dashboard's .panel chrome is dark-only; re-theme it inline so the light
  // demo doesn't frame a light chart in a dark card.
  const light = theme === 'light';
  const panelStyle = { marginBottom: 16, ...(light ? { background: '#fff', borderColor: '#d4dde4' } : {}) };
  const headStyle = light ? { background: '#f3f6f8', borderColor: '#d4dde4' } : undefined;
  const titleStyle = light ? { color: '#1a2530' } : undefined;

  return (
    <div style={{ background: light ? '#eef2f5' : 'var(--bg)', minHeight: '100vh' }}>
      <header className="app-header" style={{ position: 'static' }}>
        <div>
          <div className="app-title">
            Skew-T <span>Diagnostic Demo</span>
          </div>
          <div className="app-sub">soundingMath.js + DiagnosticSounding · offline samples</div>
        </div>
        <div className="header-spacer" />
        <div className="unit-toggle" role="group" aria-label="Units">
          <button aria-pressed={units === 'imperial'} className={units === 'imperial' ? 'active' : ''} onClick={() => setUnits('imperial')}>
            °F · ft
          </button>
          <button aria-pressed={units === 'metric'} className={units === 'metric' ? 'active' : ''} onClick={() => setUnits('metric')}>
            °C · m
          </button>
        </div>
        <div className="unit-toggle" role="group" aria-label="Theme">
          <button aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
            Dark
          </button>
          <button aria-pressed={theme === 'light'} className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>
            Light
          </button>
        </div>
        <a href="#" style={{ fontSize: 13 }}>← dashboard</a>
      </header>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '14px 18px 60px' }}>
        {Object.entries(sampleProfiles).map(([key, { label, profile }]) => (
          <section key={key} className="panel" style={panelStyle}>
            <div className="panel-head" style={headStyle}>
              <span className="panel-title" style={titleStyle}>
                {label}
              </span>
            </div>
            <div className="panel-body">
              <DiagnosticSounding profile={profile} units={units} theme={theme} title={label} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
