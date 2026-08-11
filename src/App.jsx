import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCATION } from './lib/locations.js';
import { reverseGeocode } from './api/geocoding.js';
import { computeDiagnostics, summarize18h } from './lib/diagnostics.js';
import { assessHazards, briefing } from './lib/analysis.js';
import { computeEnsembleDays, confidenceSummary } from './lib/ensemble.js';
import {
  getPoints,
  getForecast,
  getHourly,
  getGridData,
  getLatestObservation,
  getActiveAlerts,
} from './api/nws.js';
import { getGfs, getAirQuality, getEnsemble } from './api/openMeteo.js';

import LocationPicker from './components/LocationPicker.jsx';
import UnitToggle from './components/UnitToggle.jsx';
import AlertsBanner from './components/AlertsBanner.jsx';
import Summary from './components/Summary.jsx';
import CurrentConditions from './components/CurrentConditions.jsx';
import HourlyStrip from './components/HourlyStrip.jsx';
import Diagnostics from './components/Diagnostics.jsx';
import Analysis from './components/Analysis.jsx';
import Hazards from './components/Hazards.jsx';
import Wind from './components/Wind.jsx';
import Snow from './components/Snow.jsx';
import RadarPanel from './components/RadarPanel.jsx';
import Satellite from './components/Satellite.jsx';
import ZoomEarth from './components/ZoomEarth.jsx';
import { WindyRadar, WindyWind, WindyWaves } from './components/WindyMaps.jsx';
import ModelMaps from './components/ModelMaps.jsx';
import AirQuality from './components/AirQuality.jsx';
import Confidence from './components/Confidence.jsx';
import Roads from './components/Roads.jsx';
import DiagnosticSoundingPanel from './components/DiagnosticSoundingPanel.jsx';
import ExtendedForecast from './components/ExtendedForecast.jsx';
import Section from './components/Section.jsx';
import ConditionStrip from './components/ConditionStrip.jsx';
import SpcOutlook from './components/SpcOutlook.jsx';

const REFRESH_MS = 5 * 60 * 1000; // auto-refresh every 5 minutes

function useAsync(fn, deps, enabled = true) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ loading: true, error: null, data: s.data }));
      return;
    }
    let cancelled = false;
    setState((s) => ({ loading: true, error: null, data: s.data }));
    Promise.resolve()
      .then(fn)
      .then((data) => !cancelled && setState({ loading: false, error: null, data }))
      .catch((e) => !cancelled && setState({ loading: false, error: e.message || String(e), data: null }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export default function App() {
  // Starts on Lake Tahoe so panels populate instantly, then snaps to the user's
  // actual location once geolocation resolves (falls back to Tahoe if denied).
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [tick, setTick] = useState(0);
  const [locating, setLocating] = useState(false);

  const locateMe = useCallback(() => {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = +pos.coords.latitude.toFixed(4);
        const lon = +pos.coords.longitude.toFixed(4);
        let name = 'Current location';
        const rev = await reverseGeocode(lat, lon);
        if (rev) name = rev;
        setLocation({ name, lat, lon });
        setLocating(false);
      },
      () => setLocating(false), // denied / unavailable → keep current location
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  }, []);

  // Auto-detect current location once on load.
  useEffect(() => {
    locateMe();
  }, [locateMe]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const { lat, lon } = location;

  const points = useAsync(() => getPoints(lat, lon), [lat, lon, tick]);
  const pd = points.data;
  const forecast = useAsync(() => getForecast(pd.forecast), [pd?.forecast, tick], !!pd?.forecast);
  const hourly = useAsync(() => getHourly(pd.forecastHourly), [pd?.forecastHourly, tick], !!pd?.forecastHourly);
  const grid = useAsync(() => getGridData(pd.forecastGridData), [pd?.forecastGridData, tick], !!pd?.forecastGridData);
  const obs = useAsync(
    () => getLatestObservation(pd.observationStations, lat, lon),
    [pd?.observationStations, lat, lon, tick],
    !!pd?.observationStations,
  );
  const alerts = useAsync(() => getActiveAlerts(lat, lon), [lat, lon, tick]);

  const gfs = useAsync(() => getGfs(lat, lon), [lat, lon, tick]);
  const airQuality = useAsync(() => getAirQuality(lat, lon), [lat, lon, tick]);
  const ensemble = useAsync(() => getEnsemble(lat, lon), [lat, lon, tick]);

  // Derived computations.
  const diag = useMemo(
    () => (grid.data || gfs.data ? computeDiagnostics(grid.data, gfs.data) : null),
    [grid.data, gfs.data],
  );
  const diagLoading = grid.loading || gfs.loading;
  const diagError = grid.error || gfs.error;

  const sum18 = useMemo(() => summarize18h(gfs.data, grid.data), [gfs.data, grid.data]);
  const hazards = useMemo(() => (diag ? assessHazards(diag, sum18) : []), [diag, sum18]);
  const confidence = useMemo(
    () => confidenceSummary(ensemble.data ? computeEnsembleDays(ensemble.data) : []),
    [ensemble.data],
  );
  const brief = useMemo(
    () =>
      diag
        ? briefing({ diag, hazards, sum: sum18, confidence, obs: obs.data, location, alerts: alerts.data })
        : null,
    [diag, hazards, sum18, confidence, obs.data, location, alerts.data],
  );

  // Stamped once per refresh tick (not per render) so the header doesn't churn
  // and the "as of" time actually corresponds to the data on screen.
  const lastUpdated = useMemo(
    () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, lat, lon],
  );

  // Freshness of the underlying fetches, for the header indicator.
  const anyLoading =
    points.loading || forecast.loading || grid.loading || obs.loading || gfs.loading || alerts.loading;
  const anyError = points.error || grid.error || gfs.error || alerts.error;
  const freshness = anyError ? 'error' : anyLoading ? 'updating' : 'live';

  return (
    <div className="wx-dash">
      <header className="app-header">
        <div>
          <div className="app-title">
            WX <span>Dashboard</span>
          </div>
          <div className="app-sub">
            {lat.toFixed(3)}, {lon.toFixed(3)}
          </div>
        </div>
        <LocationPicker location={location} onChange={setLocation} />
        <button onClick={locateMe} title="Use my current location" disabled={locating}>
          {locating ? '📍…' : '📍 My location'}
        </button>
        <div className="header-spacer" />
        <UnitToggle />
        <span className={`freshness freshness-${freshness}`} title={anyError ? String(anyError) : undefined}>
          <span className="freshness-dot" aria-hidden="true" />
          {freshness === 'error' ? 'Some sources failed' : freshness === 'updating' ? 'Updating…' : 'Live'}
        </span>
        <span className="refresh-note">as of {lastUpdated} · auto-refresh 5 min</span>
        <button onClick={() => setTick((x) => x + 1)}>↻ Refresh</button>
      </header>

      <AlertsBanner alerts={alerts} />

      {/* Signature element: the next 18 hours as one color-encoded band —
          precipitation in the radar ramp over a temperature tint, hatched
          where gusts run high. Sits directly under the header so the shape of
          the day is the first thing read. */}
      <ConditionStrip gfs={gfs} />

      {/* Ordered the way a person actually reads weather: what's happening now,
          what it means, what's coming, then the evidence behind it. */}
      <main className="wx-main">
        {/* ── 1. NOW ───────────────────────────────────────────────── */}
        <Section
          id="now"
          title="Now"
          kicker="observed"
          note="Measured values from official stations and sensors — no interpretation."
        >
          <div className="col-8">
            <CurrentConditions obs={obs} forecast={forecast} points={points} gfs={gfs} />
          </div>
          <div className="col-4">
            <AirQuality airQuality={airQuality} />
          </div>
        </Section>

        {/* ── 2. THE READ — the point of the whole dashboard ────────── */}
        <Section
          id="the-read"
          title="The Read"
          kicker="interpretation"
          note="Plain-language analysis derived in-app from the numbers below. This is interpretation, not an official NWS forecast."
        >
          <div className="col-12">
            <Summary briefing={brief} loading={diagLoading} error={diagError} />
          </div>
          <div className="col-6">
            <Analysis diag={diag} sum={sum18} location={location} loading={diagLoading} error={diagError} />
          </div>
          <div className="col-6">
            <Hazards alerts={alerts} sum={sum18} hazards={hazards} />
          </div>
        </Section>

        {/* ── 3. WHAT'S COMING ─────────────────────────────────────── */}
        <Section
          id="whats-coming"
          title="What's Coming"
          kicker="forecast"
          note="Official NWS forecast periods, plus model-derived wind, snow and ensemble spread."
        >
          <div className="col-12">
            <HourlyStrip hourly={hourly} />
          </div>
          <div className="col-6">
            <Wind gfs={gfs} grid={grid} diag={diag} />
          </div>
          <div className="col-6">
            <Snow gfs={gfs} grid={grid} location={location} />
          </div>
          <div className="col-8">
            <ExtendedForecast forecast={forecast} />
          </div>
          <div className="col-4">
            <Confidence ensemble={ensemble} />
          </div>
        </Section>

        {/* ── 4. DIAGNOSTICS — the evidence ────────────────────────── */}
        <Section
          id="diagnostics"
          title="Diagnostics"
          kicker="derived · thermodynamic"
          note="The raw parameters the analysis above is built from. Values marked “derived” are computed in-app; the rest come straight from NWS gridpoint or Open-Meteo GFS output."
        >
          <div className="col-12">
            <Diagnostics diag={diag} location={location} loading={diagLoading} error={diagError} />
          </div>
          <div className="col-12">
            <DiagnosticSoundingPanel location={location} refreshKey={tick} />
          </div>
        </Section>

        {/* ── 5. IMAGERY — heavy; collapsible ──────────────────────── */}
        <Section
          id="imagery"
          title="Imagery"
          kicker="radar · satellite · models"
          note="Live remote-sensing and model graphics. Heavy to load — collapse this to keep the top of the page fast."
          collapsible
        >
          {/* One interactive radar, full width — it replaced a pair of half-width
              panels (IEM without animation, RainViewer with it) that each mounted
              their own Leaflet map. Source selection lives inside it. */}
          <div className="col-12">
            <RadarPanel location={location} refreshKey={tick} />
          </div>
          <div className="col-6">
            <Satellite location={location} refreshKey={tick} />
          </div>
          <div className="col-6">
            <ModelMaps location={location} refreshKey={tick} />
          </div>
          <div className="col-4">
            <WindyRadar location={location} />
          </div>
          <div className="col-4">
            <WindyWind location={location} />
          </div>
          <div className="col-4">
            <WindyWaves location={location} />
          </div>
          {/* National-scale official graphic, so it closes the section: the
              imagery reads local radar -> regional satellite/model -> national
              outlook. Full width because it is a CONUS map. */}
          <div className="col-12">
            <SpcOutlook />
          </div>
        </Section>

        {/* ── 6. TRAVEL & EXTERNAL ─────────────────────────────────── */}
        <Section
          id="travel"
          title="Travel &amp; External"
          kicker="third-party"
          note="Official DOT maps and links out. These are other people's services embedded here — they can block embedding at any time."
          collapsible
          defaultOpen={false}
        >
          <div className="col-8">
            <Roads location={location} />
          </div>
          <div className="col-4">
            <ZoomEarth location={location} />
          </div>
        </Section>
      </main>

      <footer className="footer">
        <div>
          <strong>Sources:</strong> NWS / api.weather.gov · Open-Meteo (GFS, Air Quality, Ensemble, Geocoding) ·
          RainViewer · Iowa State Mesonet (NEXRAD N0Q) · NOAA/NESDIS/STAR GOES-18 · Zoom Earth (satellite &amp; storms) ·
          Windy.com (radar/wind/waves embeds) · Tropical Tidbits (model maps) · NOAA SPC (convective &amp; fire-weather
          outlooks) · Caltrans QuickMap · Nevada DOT 511.
        </div>
        <div>
          SPC outlooks, model maps, and NDOT 511 are routed through the bundled local Express proxy so they render
          inline. Probabilities are labeled official vs. derived; the “derived” hazard assessment is Claude's
          interpretation, not an official forecast.
        </div>
        <div className="disclaimer">
          ⚠ For situational awareness and educational use only. NOT for operational, aviation, marine, or life-safety
          decisions. Always consult official NWS forecasts and warnings.
        </div>
      </footer>
    </div>
  );
}
