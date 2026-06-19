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
import AlertsBanner from './components/AlertsBanner.jsx';
import Summary from './components/Summary.jsx';
import CurrentConditions from './components/CurrentConditions.jsx';
import HourlyStrip from './components/HourlyStrip.jsx';
import Diagnostics from './components/Diagnostics.jsx';
import Analysis from './components/Analysis.jsx';
import Hazards from './components/Hazards.jsx';
import Wind from './components/Wind.jsx';
import Snow from './components/Snow.jsx';
import Radar from './components/Radar.jsx';
import RadarHiRes from './components/RadarHiRes.jsx';
import Satellite from './components/Satellite.jsx';
import ModelMaps from './components/ModelMaps.jsx';
import AirQuality from './components/AirQuality.jsx';
import Confidence from './components/Confidence.jsx';
import Roads from './components/Roads.jsx';
import UpperAir from './components/UpperAir.jsx';
import ExtendedForecast from './components/ExtendedForecast.jsx';

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
    () => getLatestObservation(pd.observationStations),
    [pd?.observationStations, tick],
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

  const lastUpdated = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <>
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
        <span className="refresh-note">updated {lastUpdated} · auto-refresh 5 min</span>
        <button onClick={() => setTick((x) => x + 1)}>↻ Refresh</button>
      </header>

      <AlertsBanner alerts={alerts} />

      <div className="grid">
        <div className="col-12">
          <Summary briefing={brief} loading={diagLoading} error={diagError} />
        </div>

        <div className="col-4">
          <CurrentConditions obs={obs} forecast={forecast} points={points} />
        </div>
        <div className="col-8">
          <Diagnostics diag={diag} loading={diagLoading} error={diagError} />
        </div>

        <div className="col-6">
          <Hazards alerts={alerts} sum={sum18} hazards={hazards} />
        </div>
        <div className="col-6">
          <Analysis diag={diag} loading={diagLoading} error={diagError} />
        </div>

        <div className="col-12">
          <HourlyStrip hourly={hourly} />
        </div>

        <div className="col-6">
          <Wind gfs={gfs} grid={grid} diag={diag} />
        </div>
        <div className="col-6">
          <Snow gfs={gfs} grid={grid} location={location} />
        </div>

        <div className="col-6">
          <Radar location={location} refreshKey={tick} />
        </div>
        <div className="col-6">
          <RadarHiRes location={location} refreshKey={tick} />
        </div>

        <div className="col-6">
          <Satellite location={location} refreshKey={tick} />
        </div>
        <div className="col-6">
          <ModelMaps location={location} refreshKey={tick} />
        </div>

        <div className="col-12">
          <Confidence ensemble={ensemble} />
        </div>

        <div className="col-4">
          <AirQuality airQuality={airQuality} />
        </div>
        <div className="col-8">
          <ExtendedForecast forecast={forecast} />
        </div>

        <div className="col-12">
          <Roads location={location} />
        </div>

        <div className="col-12">
          <UpperAir location={location} refreshKey={tick} />
        </div>
      </div>

      <footer className="footer">
        <div>
          <strong>Sources:</strong> NWS / api.weather.gov · Open-Meteo (GFS, Air Quality, Ensemble, Geocoding) ·
          RainViewer · Iowa State Mesonet (NEXRAD N0Q) · NOAA/NESDIS/STAR GOES-18 · Tropical Tidbits (model maps) · NOAA SPC (mesoanalysis &amp;
          outlooks) · University of Wyoming Upper-Air · Caltrans QuickMap · Nevada DOT 511.
        </div>
        <div>
          SPC, UWyo soundings, and NDOT 511 are routed through the bundled local Express proxy so they render inline.
          Probabilities are labeled official vs. derived; the “derived” hazard assessment is Claude's interpretation, not
          an official forecast.
        </div>
        <div className="disclaimer">
          ⚠ For situational awareness and educational use only. NOT for operational, aviation, marine, or life-safety
          decisions. Always consult official NWS forecasts and warnings.
        </div>
      </footer>
    </>
  );
}
