# WX Dashboard — project context for Claude

A local/standalone meteorological dashboard (default: **Lake Tahoe**). Use this
file as the project brief when extending or debugging it — drop it into a
claude.ai **Project** (alongside `README.md`) as knowledge, or keep it here for
Claude Code.

## What it is
Vite + React frontend + a small **Express proxy** (`server/index.js`). The proxy
exists because some sources block cross-origin/hotlinking; everything else is
fetched directly from the browser. All data sources are **keyless/public**.

## Run / build / deploy
- Dev (both processes): `npm install` then `npm run dev` → http://localhost:5173
  (Vite 5173 proxies `/api/*` → Express 3001).
- Prod single service: `npm run build` then `npm start` → Express serves the
  built UI **and** `/api/*` on one port (`process.env.PORT`).
- Deploy: `render.yaml` (free Render web service). Push to GitHub → Render →
  New → Blueprint.
- PWA: `public/manifest.webmanifest` + `public/sw.js` + icons (`public/*.png`,
  regenerate with `node scripts/gen-icons.mjs`). SW registers in prod only.

## Architecture
```
browser ──► NWS, Open-Meteo, RainViewer, GOES CDN, IEM tiles   (CORS-OK, direct)
   └──► /api/* ──► Express proxy ──► SPC, UWyo, NDOT 511, Tropical Tidbits
```
- Direct browser APIs: `src/api/*.js` (nws, openMeteo, geocoding, rainviewer)
- Proxy + inline-image/embeds: `server/index.js`
- Diagnostics math: `src/lib/diagnostics.js`
- Rule-based analysis, 18-h hazard assessment, briefing: `src/lib/analysis.js`
- Ensemble math: `src/lib/ensemble.js`
- Per-location source selection (GOES sector, sounding station, SPC sector,
  WSR-88D, Tahoe elevations, CA/NV road state): `src/lib/locations.js`
- Panels: `src/components/*.jsx`; orchestration/state/layout: `src/App.jsx`

## Proxy routes (server/index.js)
- `/api/sounding`, `/api/sounding-info` — UWyo skew-T (direct GIF + cycle fallback + cache)
- `/api/spc` — SPC mesoanalysis param image
- `/api/spc-outlook?img=day1cat|day2cat|day1fire|day2fire` — SPC outlooks
- `/api/ndot` — NDOT 511 reverse proxy (strips X-Frame-Options, injects `<base>`)
- `/api/model`, `/api/model-info?model=gfs|nam|ecmwf` — Tropical Tidbits model maps (Referer + latest-run resolution; whitelisted)

## Upstream gotchas (already handled — keep these in mind)
- Open-Meteo GFS PWAT var is `total_column_integrated_water_vapour` (not `precipitable_water`).
- UWyo `GIF:SKEWT` returns an HTML wrapper; real GIF is `/upperair/images/{YYYYMMDDHH}.{STNM}.skewt.parc.gif`; fall back through older 00Z/12Z cycles. UWyo rate-limits aggressive reloads.
- SPC meso: `/exper/mesoanalysis/s{N}/{parm}/{parm}.gif` (no `new/`); mid-lapse param=`laps`, sig-tornado=`stpc`. SPC sector legend: 11 NW, 12 SW, 13 N.Plains, 14 C.Plains, 19 National.
- SPC outlooks are now `.png` (`day1otlk.png`, `fire_wx/day1otlk_fire.png`).
- GOES `wus` sector is 1000×1000; `psw`/`pnw` are 1200×1200.
- High-res radar = IEM NEXRAD **N0Q** tile cache (keyless, CORS `*`).
- NDOT (nvroads.com) blocks framing (X-Frame-Options) → proxied; its live data layer may still be cross-origin-blocked (base map loads, incidents may not). Caltrans QuickMap embeds directly.
- **NOAA MAG is access-blocked (403)** to non-browser clients → model maps come from Tropical Tidbits (`mslp_pcpn`, `ref_frzn`, `mslp_wind`, `apcpn`; regions `us`/`wus`; NAM has no `wus`).

## Conventions / constraints
- Keyless sources only. NWS needs a descriptive User-Agent (browser supplies one; proxy sets its own).
- Every panel wraps fetches in try/catch with visible loading/error states.
- Probabilities are labeled **official vs. derived**; the 18-h hazard assessment is explicitly "derived, not an official probability."
- Dark theme; auto-refresh every 5 min.
- Not for operational/life-safety use (see footer disclaimer).

## Original build spec
The full feature spec the dashboard was built from lives in `docs/build-spec.md`.
