# 🐝 AeroBee — Aviation Collective Intelligence

**Interactive post-flight analytics dashboard for the AeroBee demo fleet.**

The trajectory backbone is genuine A310-class satellite-downlinked flight telemetry
(white-labeled as demo tail **N310AB**) — 325 flight segments including a fully
reconstructed Riyadh ↔ NEOM Bay round trip at 2-minute track resolution. On top of
that, high-rate DFDR, weather and aircraft-health datasets are **simulated** to
demonstrate the full product surface: FOQA gates, touchdown analysis, AHM scoring.

## Run it

No build step. Serve the folder and open it:

```bash
python3 -m http.server 8317
# → http://localhost:8317
```

## Views

| View | What it shows |
|---|---|
| **Fleet Overview** | KPIs, route map, monthly utilization & fuel burn across 325 flights |
| **Live Flight / Replay** | Animated replay: moving aircraft, cockpit gauges, control surfaces (flap/gear/spoiler/reverse), live instruments, altitude+speed strip, weather brief, downlink log |
| **Aircraft Health (AHM)** | System-by-system health scoring with trends and next-action recommendations |
| **Engine Condition (MOQA)** | 22 months of takeoff EGT trending, Eng1−Eng2 divergence, oil & vibration by phase |
| **Fuel Optimization** | Burn by phase, fuel flow vs altitude, computed savings opportunities |
| **Proactive Safety (FOQA/FDM)** | Exceedance events, stabilized-approach gate analysis, touchdown scorecard — click a row to replay that exact moment |
| **End of Flight Report** | Engineering summary report, per-phase engine table, CSV/JSON export, print |
| **Ask AeroBee** | Conversational interface answering from the dataset (production: LLM + RAG over the Beehive) |

## Architecture

```
data/                      raw JSON telemetry extracts
scripts/derive_data.py     computes all dashboard datasets (real + simulated layers) → assets/js/data.js
assets/js/app.js           the dashboard (vanilla JS + Leaflet + Chart.js, zero build)
index.html                 single-page app
docs/GAP_ANALYSIS.md       demo vs. production platform roadmap
```

The Vision: **The Beehive** (AI-native data platform) · **The Bees** (edge devices
onboard) · **The Studio** (AI application suite). This dashboard is a working
preview of The Studio.

---
*AeroBee Technology · Vancouver, Canada · www.theaerobee.com*
