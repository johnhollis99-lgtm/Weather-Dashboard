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

// Register the service worker only in production builds (keeps dev HMR clean and
// avoids caching live data while developing). Enables PWA install on the
// deployed HTTPS URL.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
