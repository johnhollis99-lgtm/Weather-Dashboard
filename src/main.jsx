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
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
}
