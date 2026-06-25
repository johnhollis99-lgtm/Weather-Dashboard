import { Component, useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import DiagnosticSounding from './DiagnosticSounding.jsx';
import { getSoundingProfile } from '../api/soundingProfile.js';
import { cappedSevere } from '../lib/sampleProfiles.js';
import { useUnits } from '../lib/unitsContext.jsx';

const msg = (e) => (e && e.message) || String(e);

// analyzeSounding() and the Skew-T draw both run *during render*, so a malformed
// profile throws in render — not in the fetch promise. There is no app-wide
// error boundary, so an unguarded throw here blanks the entire dashboard, not
// just this panel. This boundary contains any render-time failure and shows the
// supplied fallback instead. It resets when `resetKey` changes (new location /
// refresh) so a transient bad profile doesn't pin the panel in the error state.
class RenderGuard extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

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

  const resetKey = `${location.lat},${location.lon},${refreshKey},${usingSample}`;
  const chart = (p) => <DiagnosticSounding profile={p} units={system} theme="dark" />;

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
          {/* If the (live) profile can't be analyzed/drawn, fall back to the
              teaching sample; if even that throws, show a visible error rather
              than blanking the panel — and, lacking an app-level boundary, the
              whole dashboard. */}
          <RenderGuard
            resetKey={resetKey}
            fallback={() => (
              <RenderGuard
                resetKey={resetKey}
                fallback={(e) => (
                  <div className="state">
                    <span className="skt-badge">RENDER ERROR</span>
                    <span>Couldn’t render this sounding ({msg(e)}).</span>
                  </div>
                )}
              >
                {!usingSample && (
                  <div className="state" style={{ paddingTop: 0 }}>
                    <span className="skt-badge">SAMPLE DATA</span>
                    <span>Live profile couldn’t be rendered — showing the capped-severe teaching example.</span>
                  </div>
                )}
                {chart(cappedSevere)}
              </RenderGuard>
            )}
          >
            {chart(profile)}
          </RenderGuard>
        </>
      )}
    </Panel>
  );
}
