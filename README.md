# 🐝 AeroBee — Aviation Collective Intelligence

**Interactive post-flight analytics dashboard for the AeroBee demo fleet.**

Five loadable flights on demo tail **N310AB** (A310-300): two genuine **8 Hz FDR
decodes** (94,576 rows mined for FOQA events, real IRS winds, recorded attitude and
flight controls) plus three satellite-downlink flights — with 325 logged segments
of fleet history behind them. Weather METARs, maintenance records and health
scores are **simulated** and tagged as such in the UI.

## Run it

No build step. Serve the folder and open it:

```bash
python3 -m http.server 8317
# → http://localhost:8317
```

## Views

| View | What it shows |
|---|---|
| **Fleet & Flights** | Fleet strip, 5-flight library with fidelity badges, KPIs, network map |
| **Flight Replay 2D** | FDR-driven replay: cockpit gauges, flight-control LEDs, recorded attitude & wind, weather overlays (wind barbs + radar), altitude/CAS strip |
| **Flight Replay 3D** | CesiumJS globe replay with chase camera, glowing track, aircraft model, live HUD |
| **Aircraft Health (AHM)** | System-by-system health scoring with trends and next-action recommendations |
| **Predictive Maintenance** | 12-month EGT-margin forecast on real trend data, component RUL (P50/P90), 180-day intervention timeline |
| **The Beehive — Data Connectors** | Animated data-fabric: fragmented sources → lakehouse → RAG/LLM → Studio apps, plus AI technology roadmap |
| **Engine Condition (MOQA)** | 22 months of takeoff EGT trending, Eng1−Eng2 divergence, oil & vibration by phase |
| **Fuel Optimization** | Burn by phase, fuel flow vs altitude, computed savings opportunities |
| **Proactive Safety (FOQA/FDM)** | Exceedance events, stabilized-approach gate analysis, touchdown scorecard — click a row to replay that exact moment |
| **End of Flight Report** | Engineering summary report, per-phase engine table, CSV/JSON export, print |
| **Ask AeroBee** | Conversational interface answering from the dataset (production: LLM + RAG over the Beehive) |

## Architecture

```
data/                      raw JSON telemetry extracts
scripts/derive_data.py     satellite-telemetry datasets (real + simulated layers) → assets/js/data.js
scripts/parse_fdr.py       8 Hz FDR decode parser + FOQA event mining → assets/js/fdr_data.js
assets/js/app.js           the dashboard (vanilla JS + Leaflet + Chart.js, zero build)
index.html                 single-page app
docs/GAP_ANALYSIS.md       demo vs. production platform roadmap
```

The Vision: **The Beehive** (AI-native data platform) · **The Bees** (edge devices
onboard) · **The Studio** (AI application suite). This dashboard is a working
preview of The Studio.

---
*AeroBee Technology · Vancouver, Canada · www.theaerobee.com*
