# Gap Analysis — Demo vs. the AeroBee Platform Vision

## 1. What the demo data is

- **Backbone**: real A310-class satellite-downlinked telemetry (white-labeled as
  demo tail N310AB): position heartbeats every ~2 min plus ~40-parameter
  snapshots at flight-phase transitions and ~10-min cruise intervals.
- **Coverage**: 325 flight segments over 22 months across a Middle-East network.
- **Simulated layers** (clearly tagged in the UI): 1 Hz DFDR segments for
  takeoff and final approach, METAR/winds-aloft weather, and AHM health scores.
  These show the product surface that full-rate data unlocks.

## 2. Gaps between satellite telemetry and full FOQA/FDM

| Gap | Impact | Mitigation / roadmap |
|---|---|---|
| **1–2 min sample rate** (vs 1–8 Hz QAR/DFDR) | Hard landings, flare quality, approach gates not detectable from downlink alone | The Bee edge device reads the aircraft interface at full rate and computes events onboard; only exceedances + summaries are downlinked |
| **No control-surface / config data** in the downlink | Unstable-approach & configuration events limited | Add flap/gear/radio-alt labels to the snapshot parameter set |
| **No flight-plan data** | Planned-vs-actual deviation not computable | Integrate dispatch/FPL APIs |
| **No weather feed** | Fuel burn can't be wind-normalized; no overlays | METAR/NOAA + GRIB winds integration (server-side, low effort) |
| **Single aircraft** | Fleet views are one tail's history | Architecture already scales to N tails; message as pilot install |

## 3. Demo vs. production architecture

| Demo (this repo) | Production (Phase 1/2 SOW) |
|---|---|
| Static JSON derived offline | Streaming ingestion → AI-native lakehouse (the Beehive) |
| Rule-based "Ask AeroBee" router | LLM + RAG over vectorized flight data, manuals, MELs, weather |
| Hard-coded FOQA thresholds | User-definable event editor with severity classes |
| Leaflet 2D replay | Cesium 3D replay with terrain and weather |
| Client-side only | Role-based multi-user (pilot debrief / engineering / executive) |

## 4. What already delivers value today

- **Engine condition trending** works at downlink rate: 22 months of takeoff
  EGT, Eng1−Eng2 divergence — genuine MOQA.
- **Fuel accountability** per phase/leg/route from fuel-quantity deltas,
  monetized savings initiatives computed from observed behavior.
- **Near-real-time tracking + phase detection** demonstrated with real data.
- **Conversational access** — the data model is already RAG-ready.

## 5. Recommended next steps

1. Full-rate QAR sample flight for a side-by-side fidelity demo.
2. Flap/gear/RA in the downlink parameter set → unstable-approach detection.
3. Swap the keyword router for an LLM endpoint over the same knowledge layer.
4. CesiumJS 3D replay using the existing track.
5. Live METAR on the EOF report.
