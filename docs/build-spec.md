# WX Dashboard — build specification

The feature set the dashboard implements. Useful as Claude Project knowledge for
extending it consistently.

## Goal
A standalone, keyless meteorological dashboard. Running locally/deployed (not in
a sandbox) so the browser can fetch external APIs directly; sources that block
CORS/hotlinking are routed through the bundled Express proxy and rendered as
**real inline images/maps**, never click-out links.

## Location handling
- Default **Lake Tahoe (39.0968, −120.0324)**.
- Preset dropdown: Lake Tahoe, San Francisco, Reno, Seattle, Denver.
- Free-text search via Open-Meteo geocoding.
- Changing location updates every panel + GOES sector + sounding station + SPC
  sector + nearest WSR-88D + road state.

## Panels
1. **Briefing (top)** — plain-language synthesis: setup, next 18–24 h, main
   hazards + likelihood, ensemble-confidence read, what to watch.
2. **Current conditions** — NWS; ACTUAL observed temp/dewpoint from nearest
   station + alerts banner.
3. **Hourly** — next 24 h temp + precip probability (NWS forecastHourly).
4. **Diagnostics** — NWS gridpoint (mixing height, transport wind, Haines, PoT,
   WBGT, dispersion) + Open-Meteo GFS (CAPE/CIN/LI/PWAT/BL height/freezing
   level, 850/700/500 hPa temps & heights) + in-app derived (lapse rates,
   dewpoint depression, ventilation, PWAT in inches).
5. **Meteorological analysis** — rule-based interpretation of the raw numbers.
6. **Hazards & warnings** — ① official NWS alerts ② official probabilistic (NWS
   PoP/PoT + SPC Day-1/2 convective & fire outlooks) ③ DERIVED 18-h assessment
   (thunder / dry lightning / gusty-downburst winds / snow / fire), labeled not
   official.
7. **Wind** — NWS + Open-Meteo 10 m wind/gusts, transport wind, 500 mb wind;
   18-h gust timeline; advisory/warning flags.
8. **Snow** — Open-Meteo snowfall/snow depth/freezing level + NWS
   snowfallAmount/snowLevel; Tahoe lake-level (6,225 ft) + pass comparison.
9. **Live radar** — RainViewer animated tiles (NEXRAD palette), play/scrubber.
10. **High-res radar** — IEM NEXRAD N0Q interactive layer, nearest WSR-88D.
11. **GOES-West satellite** — GOES-18 band switcher + sector/full-disk.
12. **Model forecast maps** — Tropical Tidbits GFS/NAM/ECMWF (precip, precip
    type, 10 m wind, total precip), forecast-hour slider + play.
13. **Air quality** — Open-Meteo US AQI/PM2.5/PM10/ozone + 24 h trend.
14. **Forecast confidence** — Open-Meteo ensemble precip member spread.
15. **Road conditions** — Caltrans QuickMap + NDOT 511 embeds (CA/NV).
16. **Extended forecast** — NWS multi-day periods with icons.
17. **Upper-air & severe** — proxied UWyo skew-T + SPC mesoanalysis param picker.

## Behavior
- Dark theme; auto-refresh every 5 min; per-panel try/catch with visible
  loading/error states; footer crediting sources + not-for-life-safety
  disclaimer; probabilities labeled official vs. derived.

## API cheat sheet
See `CLAUDE.md` → "Upstream gotchas" for the exact, verified endpoint quirks.
