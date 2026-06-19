# WX Dashboard — local meteorological dashboard

A standalone weather/meteorology dashboard for the western U.S. (default: **Lake
Tahoe**). It pulls live data straight from NWS, Open-Meteo, RainViewer and the
GOES-18 CDN in the browser, and routes the two sources that block hotlinking
(**SPC mesoanalysis** and **University of Wyoming soundings**) through a tiny
bundled Express proxy so they render as **real inline images**.

> This fixes the "every panel is empty" problem from running inside a sandbox:
> running standalone, the browser can reach the open APIs directly, and the local
> proxy handles the rest.

---

## Quick start

```bash
npm install
npm run dev
```

Then open:

### → http://localhost:5173

`npm run dev` starts **both** processes together (via `concurrently`):

| Process | Port | What it does |
| ------- | ---- | ------------ |
| `web` (Vite + React) | **5173** | the dashboard UI you open in the browser |
| `proxy` (Express)    | **3001** | inline-image proxy for SPC + UWyo |

Vite forwards `/api/*` to the proxy automatically, so you only ever open
`http://localhost:5173`. If port 5173 is busy, Vite picks the next free port —
watch the terminal for the actual URL it prints.

Stop everything with `Ctrl+C`.

### One-click launch (Windows)
Double-click **`start-dashboard.bat`** — it installs deps on first run, starts both
servers, and opens the browser. Right-click it → *Send to → Desktop (create
shortcut)* for a desktop icon. (Stays local to this PC.)

---

## Deploy it (one URL on any device) + install as a phone app

In production the **Express server serves the built UI *and* the `/api` proxy on
one port**, so the whole thing is a single deployable service.

### Deploy to Render (free)
1. Put this folder on GitHub:
   ```bash
   gh repo create wx-dashboard --private --source . --push
   # or: create an empty repo on github.com, then:
   #   git remote add origin https://github.com/<you>/wx-dashboard.git && git push -u origin main
   ```
2. On [render.com](https://render.com): **New → Blueprint**, pick the repo. It reads
   `render.yaml` (build `npm install && npm run build`, start `node server/index.js`).
3. You get a permanent `https://wx-dashboard-xxxx.onrender.com` URL — bookmark it
   anywhere. (Free tier sleeps after ~15 min idle; first hit then takes ~30 s.)

Locally you can test the exact production artifact with:
```bash
npm run build && npm start      # serves UI + API on http://localhost:3001
```

### Install as a mobile (or desktop) app — PWA
Once it's at an HTTPS URL, open that URL on your phone:
- **iPhone (Safari):** Share → **Add to Home Screen**.
- **Android (Chrome):** menu → **Install app** (or the install prompt).
- **Desktop (Chrome/Edge):** install icon in the address bar.

You get a full-screen home-screen app with the radar icon. The service worker
caches the app shell for instant launch but **always fetches live weather data
fresh** (never serves stale obs/radar). Regenerate icons with
`node scripts/gen-icons.mjs`.

> Security note: a public URL exposes the proxy routes. They're all whitelisted
> (no open proxy), but if you want it private, deploy with Render's access
> controls or add basic auth.

---

---

## Prerequisites

- **Node.js 18+** (this was built and tested on Node 25). Check with:

  ```bash
  node --version
  ```

### Installing Node, by OS

- **Windows** (this machine): `winget install OpenJS.NodeJS.LTS`
  *(Node was already installed here, so you can skip this.)*
  Alternatively download the LTS installer from <https://nodejs.org>.
- **macOS:** `brew install node` (or the installer from nodejs.org).
- **Linux (Debian/Ubuntu):** `sudo apt install nodejs npm`, or use
  [nvm](https://github.com/nvm-sh/nvm): `nvm install --lts`.

---

## Panels & data sources

| Panel | Source | Notes |
| ----- | ------ | ----- |
| **Briefing (top)** | *computed in-app* | plain-language synthesis: current setup, next 18–24 h, main hazards + likelihood, ensemble confidence read, what to watch |
| Current conditions | NWS `api.weather.gov` | **actual observed** temp/dewpoint from the nearest station, plus alerts banner |
| Next 24 hours | NWS forecastHourly | temperature + precip probability |
| Diagnostic parameters | NWS gridpoint + Open-Meteo **GFS** | mixing height, transport wind, Haines, PoT, WBGT, dispersion; CAPE/CIN/LI/PWAT/BL height/freezing level; 850/700/500 hPa temps & heights |
| Meteorological analysis | *computed in-app* | rule-based interpretation of the raw numbers (instability, cap, lapse rates, moisture, mixing, ventilation, fire weather) + plain-language synthesis |
| **Hazards & warnings** | NWS + SPC + *derived* | ① official NWS active alerts ② official probabilistic (NWS PoP/PoT + SPC Day-1/2 convective & fire outlooks, proxied) ③ **derived** 18-h likelihood for thunder / dry lightning / gusty-downburst winds / snow / fire — clearly marked *not official* |
| **Wind** | NWS gridpoint + Open-Meteo | surface wind/gusts (both), transport wind, 500 mb wind; 18-h gust timeline; wind-advisory/high-wind flags |
| **Snow** | Open-Meteo GFS + NWS gridpoint | snowfall (18 h + daily), snow depth, snow/freezing level; Tahoe lake-level (6,225 ft) + pass comparison |
| Live radar | RainViewer + Leaflet | animated past + nowcast frames, play/pause, scrubber; **NWS-style (NEXRAD Level-III) palette** |
| **High-res radar** | Iowa State Mesonet (NEXRAD N0Q) + Leaflet | interactive base-reflectivity composite, pan/zoom, nearest WSR-88D marked |
| GOES-West satellite | NOAA/NESDIS/STAR GOES-18 | band switcher (GeoColor / WV08 default / WV09 / IR13 / Air Mass), regional sector ↔ full disk |
| **Model forecast maps** | Tropical Tidbits (GFS / NAM / ECMWF) | latest full model run, proxied inline; fields: precip+MSLP, precip type (sim. radar), 10 m wind, total precip; Western-US/CONUS; 3-hourly forecast-hour slider + play |
| Air quality | Open-Meteo air-quality | US AQI, PM2.5/PM10/ozone, color category, 24h trend |
| Forecast confidence | Open-Meteo **ensemble** (gfs_seamless) | daily precip member spread = confidence |
| **Road conditions** | Caltrans QuickMap + NDOT 511 | embedded official maps; Caltrans default (CA), NDOT toggle (NV, via header-stripping proxy); CA/NV only |
| Upper-air & severe | **proxied** UWyo skew-T + SPC mesoanalysis | inline images; SPC parameter picker |
| Extended forecast | NWS multi-day periods | with icons |

**Derived values computed in-app:** 850–700 & 700–500 mb lapse rates (°C/km),
surface dewpoint depression, ventilation rate (mixing height × transport wind),
and PWAT in inches.

### Location handling
Default **Lake Tahoe (39.0968, −120.0324)**. Use the preset dropdown (Tahoe, San
Francisco, Reno, Seattle, Denver) or the free-text search box (Open-Meteo
geocoding) to jump anywhere. Changing location updates every panel, the GOES
sector, the nearest sounding station, and the SPC sector.

### Behavior
Dark theme · auto-refresh every 5 minutes (or the **↻ Refresh** button) · every
fetch is wrapped in try/catch with a per-panel loading/error state so you can see
exactly what failed and why.

---

## Architecture

```
browser  ──►  NWS / Open-Meteo / RainViewer / GOES CDN      (CORS-friendly, direct)
   │
   └──►  Vite dev server (5173)  ──/api/*──►  Express proxy (3001)  ──►  SPC, UWyo
                                                (pipes images back inline)
```

- Direct-from-browser: `src/api/*.js`
- Proxy + inline-image logic: `server/index.js`
- Diagnostics math: `src/lib/diagnostics.js` · Analysis engine: `src/lib/analysis.js`
- Per-location source selection (GOES sector, sounding station, SPC sector): `src/lib/locations.js`

### Notes on upstream quirks handled here
- Open-Meteo GFS uses `total_column_integrated_water_vapour` for PWAT (the older
  `precipitable_water` name is rejected by the GFS endpoint).
- UWyo's `GIF:SKEWT` endpoint returns an HTML wrapper now; the proxy fetches the
  real GIF at `/upperair/images/{YYYYMMDDHH}.{STNM}.skewt.parc.gif` and falls back
  through earlier 00Z/12Z cycles until it finds one that exists.
- SPC mesoanalysis images live at `/exper/mesoanalysis/s{N}/{parm}/{parm}.gif`;
  SPC outlooks are now `.png` (`day1otlk.png`, `fire_wx/day1otlk_fire.png`, …).
- GOES `wus` sector publishes 1000×1000 images while `psw`/`pnw` publish 1200×1200.
- High-res radar uses the IEM NEXRAD **N0Q** tile cache (keyless, `Access-Control-Allow-Origin: *`).
- Model maps: NOAA **MAG** is now fully access-blocked (HTTP 403) to non-browser clients, so model graphics come from **Tropical Tidbits** (`mslp_pcpn`, `ref_frzn`, `mslp_wind`, `apcpn`). TT hotlink-protects images, so `/api/model` fetches them with a `Referer` and resolves the latest available run; `/api/model-info` reports the run + frame count. Inputs are whitelisted (model/field/region/frame) — not an open proxy. NAM has no `wus` region, so the panel offers CONUS/N. America for NAM.
- **NDOT 511 (nvroads.com)** sends `X-Frame-Options: SAMEORIGIN`, so it's served
  through `/api/ndot`, which strips that header and injects `<base href>` so the
  map loads inline. Its live-incident data layer may still be blocked by the
  upstream's cross-origin policy — if it doesn't paint, use "Open full site ↗".
  Caltrans QuickMap has no such header and is embedded directly.
- **Derived hazard probabilities are Claude's interpretation, not official.**
  Official NWS/SPC products are always labeled as such alongside them.

---

## Troubleshooting

- **A panel shows a red error box** — that's by design; it prints the failing URL
  / status. NWS occasionally rate-limits or a gridpoint omits a field ("not
  provided"); hit **↻ Refresh** or wait for the 5-min cycle.
- **Sounding panel shows an error** — UWyo skips some cycles for some stations;
  the proxy walks back up to ~3 days. If a station is simply down, try another
  location. (UWyo also rate-limits aggressive reloading.)
- **Port already in use** — Vite auto-bumps the web port; for the proxy set
  `PORT=3002` and update `vite.config.js`'s proxy target to match.

## Production build (optional)

```bash
npm run build     # outputs dist/
npm run preview   # serve the built UI (still needs the proxy: npm run dev:server)
```

---

## ⚠ Disclaimer

For situational awareness and educational use only. **NOT** for operational,
aviation, marine, or life-safety decisions. Always consult official NWS forecasts
and warnings. Data © their respective providers (NWS/NOAA, Open-Meteo, RainViewer, Tropical Tidbits,
NOAA/NESDIS/STAR, NOAA SPC, University of Wyoming).
