import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import SoundingDemo from './SoundingDemo.jsx';
import { UnitsProvider } from './lib/unitsContext.jsx';
import './index.css';
import 'leaflet/dist/leaflet.css';

// Lightweight hash "route": #sounding-demo renders the offline Skew-T gallery.
const isDemo = () => window.location.hash.replace(/^#\/?/, '') === 'sounding-demo';
window.addEventListener('hashchange', () => window.location.reload());

// index.css is fully scoped under `.wx-dash` so nothing leaks when the dashboard
// is mounted inside Conductor. The page-level reset (body background/margin) is
// therefore opt-in, and only this standalone entry point opts in. A host app
// importing <App /> gets the dashboard's styles and none of its page styles.
document.body.classList.add('wx-standalone');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UnitsProvider>{isDemo() ? <SoundingDemo /> : <App />}</UnitsProvider>
  </React.StrictMode>,
);

// Service worker registration TEMPORARILY DISABLED. The SW only ran in production
// (this is the main environmental difference vs. localhost dev), so it's commented
// out to make the deployed build behave like dev while we rule it out as the cause
// of embeds degrading to fallback links. Original block preserved below:
//
// if (import.meta.env.PROD && 'serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/sw.js').catch(() => {});
//   });
// }
//
// Proactively remove any service worker a prior production build already installed,
// so returning visitors drop the old SW on their next load (runs in dev and prod).
//
// STANDALONE ONLY. The guard is load-bearing — do not "simplify" it away.
//
// getRegistrations() is scoped to the ORIGIN, not to this app's path. Conductor
// serves this dashboard same-origin from /weather/, so when this runs there the
// list it iterates is CONDUCTOR'S: its own service worker, registered at /sw.js
// with scope /, unregistered on every open of the weather module — silently
// costing the host its offline shell and installability until its next full page
// load, since it only re-registers on a top-level load.
//
// It cannot be fixed by filtering. Conductor registers the same '/sw.js' path and
// therefore gets the same default scope '/', so on that origin the two
// registrations are identical in scriptURL and in scope and nothing at runtime
// says which is ours. The guard has to be a build-time one.
//
// BASE_URL is '/weather/' under `npm run build:conductor` and '/' otherwise, so
// this reads "am I served from a subpath" as a proxy for "am I embedded". The two
// coincide today because one CONDUCTOR_BUILD flag sets both. The proxy also fails
// in the safe direction: a wrong answer here can only skip a cleanup, never
// unregister a host's worker — that would need BASE_URL === '/' while embedded,
// which the Conductor build cannot produce.
if (import.meta.env.BASE_URL === '/' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
}
