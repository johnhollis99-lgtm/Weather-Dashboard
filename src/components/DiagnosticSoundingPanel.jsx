import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import DiagnosticSounding from './DiagnosticSounding.jsx';
import { getSoundingProfile } from '../api/soundingProfile.js';
import { cappedSevere } from '../lib/sampleProfiles.js';
import { useUnits } from '../lib/unitsContext.jsx';

// Dashboard wrapper. Attempts a live numeric profile (Open-Meteo GFS pressure
// levels); if that fails or returns too few levels, falls back to the
// capped-severe teaching sample and shows a "sample data" badge — so the panel
// is always populated and always honest about what it's showing.
export default function DiagnosticSoundingPanel({ location, refreshKey }) {
  const { system } = useUnits();
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ loading: true, error: null, data: s.data }));
    getSoundingProfile(location.lat, location.lon)
      .then((d) => !cancelled && setState({ loading: false, error: null, data: d }))
      .catch((e) => !cancelled && setState({ loading: false, error: e.message || String(e), data: null }));
    return () => {
      cancelled = true;
    };
  }, [location.lat, location.lon, refreshKey]);

  const live = state.data?.profile;
  const usingSample = !live;
  const profile = live || cappedSevere;
  // Stale-while-revalidate: previous data stays visible during a refetch, so
  // signal the in-flight update in the subtitle rather than flashing a spinner.
  const updating = state.loading && state.data;
  const sub =
    (usingSample
      ? 'derived · sample data'
      : `Open-Meteo GFS · valid ${String(state.data.validTime).replace('T', ' ')}`) +
    (updating ? ' · updating…' : '');

  return (
    <Panel title="Diagnostic Sounding — annotated Skew-T" sub={sub}>
      {state.loading && !state.data ? (
        <div className="state">
          <span className="spinner" /> Building sounding…
        </div>
      ) : (
        <>
          {usingSample && (
            <div className="state" style={{ paddingTop: 0 }}>
              <span className="skt-badge">SAMPLE DATA</span>
              <span>
                Live numeric profile unavailable{state.error ? ` (${state.error})` : ''} — showing the
                capped-severe teaching example.
              </span>
            </div>
          )}
          <DiagnosticSounding profile={profile} units={system} theme="dark" />
        </>
      )}
    </Panel>
  );
}
