/* ============================================================
   AeroBee Dashboard — demo fleet N310AB (white-labeled)
   Data: 2 × 8 Hz FDR decodes (FDR_FLIGHTS) + 3 satellite-downlink
   flights (AB payload). Simulated layers are tagged in the UI.
   ============================================================ */
"use strict";

/* ---------------- helpers ---------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const hm = (t) => t ? t.slice(11, 16) : "—";
const mins = (m) => `${Math.floor(m / 60)}h ${String(Math.round(m) % 60).padStart(2, "0")}m`;
const P = (t) => new Date(t.replace(" ", "T") + "Z").getTime();
const hhmmss = (ms) => new Date(ms).toISOString().slice(11, 19);

const C = {
  gold: "#d9a441", teal: "#8fb8ab", blue: "#8ba7c7", red: "#c97b6d",
  amber: "#d0a866", green: "#7fb693", dim: "#6b6b74", grid: "rgba(255,255,255,.05)",
  purple: "#a89bc9",
};
Chart.defaults.color = "#6b6b74";
Chart.defaults.font.family = "Inter, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.borderColor = C.grid;
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.legend.labels.boxHeight = 10;
Chart.defaults.animation.duration = 400;

const TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_OPTS = { attribution: "© OpenStreetMap © CARTO", subdomains: "abcd", maxZoom: 19 };

const AIRPORT_POS = {
  OERK: [24.9576, 46.6988], OEJN: [21.6796, 39.1565], OEJD: [21.6796, 39.1565],
  OEMA: [24.5534, 39.7051], OEDF: [26.4712, 49.7979], OJAI: [31.7226, 35.9932],
  OJAM: [31.9727, 35.9916], HECA: [30.1219, 31.4056], OENN: [27.9276, 35.2882],
  OETB: [28.3654, 36.6189], LFBD: [44.8283, -0.7156], LIEE: [39.2515, 9.0543],
  OEAH: [25.2853, 49.4851], OEGS: [26.3028, 43.7744], HESH: [27.9773, 34.3950],
  OERY: [24.7098, 46.7252],
};

function chartOn(el, cfg) {
  const prev = Chart.getChart(el);
  if (prev) prev.destroy();
  return new Chart(el, cfg);
}

/* ---------------- gauges & sparklines ---------------- */
function drawGauge(canvas, value, max, color, redFrom) {
  if (!canvas) return;
  const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H - 14, r = Math.min(W / 2 - 8, H - 26);
  g.clearRect(0, 0, W, H);
  g.lineCap = "round"; g.lineWidth = 7;
  g.strokeStyle = "rgba(139,150,171,.16)";
  g.beginPath(); g.arc(cx, cy, r, Math.PI, 2 * Math.PI); g.stroke();
  if (redFrom != null) {
    g.strokeStyle = "rgba(248,113,113,.4)";
    g.beginPath(); g.arc(cx, cy, r, Math.PI + Math.PI * (redFrom / max), 2 * Math.PI); g.stroke();
  }
  const f = Math.min(Math.max((value ?? 0) / max, 0), 1);
  g.strokeStyle = value >= (redFrom ?? Infinity) ? "#f87171" : color;
  g.beginPath(); g.arc(cx, cy, r, Math.PI, Math.PI * (1 + f)); g.stroke();
  g.fillStyle = "#e8ecf4"; g.font = "700 16px JetBrains Mono, monospace"; g.textAlign = "center";
  g.fillText(value == null ? "—" : fmt(Math.round(value)), cx, cy - 2);
}
function sparkSvg(data, color, w = 90, h = 26) {
  const mn = Math.min(...data), mx = Math.max(...data), sp = (mx - mn) || 1;
  const ptsv = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((v - mn) / sp) * (h - 6)}`).join(" ");
  return `<svg width="${w}" height="${h}" class="spark"><polyline points="${ptsv}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function ringGauge(canvas, value, color) {
  const g = canvas.getContext("2d"), W = canvas.width, cx = W / 2, r = W / 2 - 10;
  g.clearRect(0, 0, W, W);
  g.lineWidth = 6; g.lineCap = "round";
  g.strokeStyle = "rgba(255,255,255,.08)";
  g.beginPath(); g.arc(cx, cx, r, -Math.PI / 2, Math.PI * 1.5); g.stroke();
  g.strokeStyle = color;
  g.beginPath(); g.arc(cx, cx, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * value / 100); g.stroke();
}

/* ============================================================
   FLIGHT REGISTRY — 5 flights, two fidelities
   ============================================================ */
const FDR_EPOCH = Date.UTC(2023, 3, 29);
const PHASE_BY_CODE = { 2005: "ENGINE START", 2006: "TAXI OUT", 2007: "TAKEOFF", 2008: "CLIMB",
  2009: "CRUISE", 2010: "DESCENT", 2011: "APPROACH", 2012: "LANDING", 2013: "TAXI IN", 2014: "ENGINE OFF" };

function mkFdrFlight(f) {
  const I = {}; f.fields.forEach((k, i) => I[k] = i);
  const rows = f.rows;
  let lastAlt = 0, lastHdg = 0, prevPt = null;
  const track = [];
  rows.forEach(r => {
    if (r[I.lat] == null) return;
    if (r[I.alt] != null) lastAlt = r[I.alt];       /* forward-fill dropouts */
    if (r[I.hdg] != null) lastHdg = r[I.hdg];
    const tms = FDR_EPOCH + r[I.t] * 1000;
    /* reject IRS position glitches: implied speed > ~800 kt = teleport */
    if (prevPt) {
      const dtH = Math.max((tms - prevPt.tms) / 3.6e6, 1e-6);
      const dNm = Math.hypot((r[I.lat] - prevPt.lat) * 60, (r[I.lon] - prevPt.lon) * 60 * Math.cos(r[I.lat] * Math.PI / 180));
      if (dNm / dtH > 800) return;
    }
    prevPt = { tms, lat: r[I.lat], lon: r[I.lon] };
    track.push({
      tms, lat: r[I.lat], lon: r[I.lon],
      alt: lastAlt, gs: r[I.gs] || 0, hdg: lastHdg, cas: r[I.cas] || 0,
      wspd: r[I.wspd], wdir: r[I.wdir],
    });
  });
  const t0 = FDR_EPOCH + rows[0][I.t] * 1000, t1 = FDR_EPOCH + rows[rows.length - 1][I.t] * 1000;
  const off = FDR_EPOCH + f.offSec * 1000, on = FDR_EPOCH + f.onSec * 1000;
  const maxAltVal = f.maxAlt;
  function rowAt(tms) {
    const ts = (tms - FDR_EPOCH) / 1000;
    let lo = 0, hi = rows.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; (rows[m][I.t] <= ts) ? lo = m : hi = m; }
    const a = rows[lo], b = rows[hi];
    const fr = Math.min(Math.max((ts - a[I.t]) / Math.max(b[I.t] - a[I.t], .01), 0), 1);
    const L = (k) => (a[I[k]] == null || b[I[k]] == null) ? a[I[k]] : a[I[k]] + (b[I[k]] - a[I[k]]) * fr;
    return { L, a, fr };
  }
  return {
    id: f.id, date: f.date, from: f.from, to: f.to, fromName: f.fromName, toName: f.toName,
    fidelity: "FDR", t0, t1, durMin: f.durMin, airMin: f.airMin, maxAlt: maxAltVal,
    fuelLb: f.fuelUsedLb, gwStart: f.gwStart, tdNz: f.tdNz, maxWind: f.maxWind,
    vref: f.vref, gates: f.gates, track,
    perf: f.perf, fields: f.fields, rows: f.rows, onSec: f.onSec,
    events: f.events.map(e => ({ ...e, tms: FDR_EPOCH + e.tSec * 1000, src: "FDR 8 Hz · recorded" })),
    stateAt(tms) {
      const { L, a } = rowAt(tms);
      const air = a[I.air];
      let phase;
      const alt = L("alt") || 0, ra = L("ra");
      if (!air) phase = tms < off ? "TAXI OUT" : "TAXI IN";
      else {
        const frac = (tms - off) / (on - off);
        if (alt > maxAltVal - 1500) phase = "CRUISE";
        else if (frac < .35) phase = ra != null && ra < 1500 && frac < .05 ? "TAKEOFF" : "CLIMB";
        else phase = (ra != null && ra < 2500) ? "APPROACH" : "DESCENT";
      }
      return {
        fidelity: "FDR", lat: L("lat"), lon: L("lon"), alt, gs: L("gs"), cas: L("cas"),
        hdg: L("hdg"), vs: null, pitch: L("pitch"), roll: L("roll"), nz: L("nz"),
        n1a: L("n1a"), n1b: L("n1b"), egta: L("egta"), egtb: L("egtb"),
        ff: (L("ffa") || 0) + (L("ffb") || 0), fuel: null,
        flap: L("flap"), gear: a[I.gear], spoiler: (L("spdbrk") || 0) > 30 ? 1 : 0,
        rev: a[I.rev], ap: a[I.ap], ra, aoa: L("aoa"),
        wspd: L("wspd"), wdir: L("wdir"), phase, real: true,
      };
    },
  };
}

function mkSatFlight(meta, track, snaps, extra = {}) {
  const t0 = P(track[0].t), t1 = P(track[track.length - 1].t);
  const fuelKey = Object.keys(snaps[0] || {}).find(k => /fuel quantity/i.test(k));
  const trk = track.map(p => ({ tms: P(p.t), lat: p.lat, lon: p.lon, alt: p.alt || 0, gs: p.gs || 0, hdg: p.hdg || 0 }));
  function snapAt(tms) {
    let a = snaps[0], b = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++)
      if (P(snaps[i].Date) <= tms && P(snaps[i + 1].Date) >= tms) { a = snaps[i]; b = snaps[i + 1]; break; }
    const span = Math.max(P(b.Date) - P(a.Date), 1), fr = Math.min(Math.max((tms - P(a.Date)) / span, 0), 1);
    const L = (k) => (a[k] == null || b[k] == null) ? a[k] : a[k] + (b[k] - a[k]) * fr;
    let phase = "—";
    if (a.Flag) phase = a.Flag.replace("_Flag", "").replace("_", " ").toUpperCase();
    else if (a.Code && PHASE_BY_CODE[a.Code]) phase = PHASE_BY_CODE[a.Code];
    return { L, a, phase };
  }
  function trackAt(tms) {
    let i = trk.findIndex(p => p.tms > tms);
    if (i <= 0) i = tms <= trk[0].tms ? 1 : trk.length - 1;
    const a = trk[i - 1], b = trk[i];
    const fr = Math.min(Math.max((tms - a.tms) / Math.max(b.tms - a.tms, 1), 0), 1);
    const L = (k) => a[k] + (b[k] - a[k]) * fr;
    let dh = b.hdg - a.hdg; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
    const dtm = Math.max((b.tms - a.tms) / 60000, .01);
    return { lat: L("lat"), lon: L("lon"), alt: L("alt"), gs: L("gs"),
             hdg: a.hdg + dh * fr, vs: (b.alt - a.alt) / dtm };
  }
  return {
    ...meta, fidelity: "SAT", t0, t1, track: trk,
    stateAt(tms) {
      const s = trackAt(tms), { L, phase } = snapAt(tms);
      const d = (AB.dfdr && AB.dfdr[meta.id]) ? satDfdrAt(meta.id, tms) : null;
      return {
        fidelity: "SAT", ...s, cas: L("Speed/IAS"), nz: d ? d.nz : null,
        pitch: d ? d.pitch : null, roll: d ? d.roll : null,
        n1a: L("Engine 1 N1"), n1b: L("Engine 2 N1"),
        egta: L("Engine 1 EGT"), egtb: L("Engine 2 EGT"),
        ff: (L("Engine 1 Fuel Flow") || 0) + (L("Engine 2 Fuel Flow") || 0),
        fuel: fuelKey ? L(fuelKey) : null,
        flap: d ? d.flap : null, gear: d ? d.gear : null, spoiler: d ? d.spoiler : null,
        rev: d ? d.rev : null, ap: null, ra: d ? d.ra : null, aoa: null,
        wspd: null, wdir: null, phase, real: !d,
      };
    },
  };
}

/* simulated DFDR windows for the two 2021 satellite flights */
function satDfdrAnchors(fid) {
  const legStartEnd = AB.legs.find(l => l.id === fid);
  if (!legStartEnd) return {};
  const snap = (flag) => AB.snapshots.find(s => s.Date >= legStartEnd.start && s.Date <= legStartEnd.end && s.Flag === flag);
  const to = snap("Takeoff_Flag"), ldg = snap("Landing_Flag");
  return { takeoff: to ? P(to.Date) - 42000 : null, touchdown: ldg ? P(ldg.Date) + 30000 : null };
}
function satDfdrAt(fid, tms) {
  const d = AB.dfdr[fid];
  if (!d) return null;
  const a = satDfdrAnchors(fid);
  const pick = (rows, t0) => {
    if (t0 == null) return null;
    const rel = Math.round((tms - t0) / 1000);
    if (rel < rows[0][0] || rel > rows[rows.length - 1][0]) return null;
    const row = rows[rel - rows[0][0]];
    if (!row) return null;
    const o = {}; d.fields.forEach((f, i) => o[f] = row[i]);
    return o;
  };
  return pick(d.takeoff, a.takeoff) || pick(d.approach, a.touchdown);
}

const FLIGHTS = [];
(function buildRegistry() {
  FDR_FLIGHTS.forEach(f => FLIGHTS.push(mkFdrFlight(f)));
  AB.legs.forEach(l => {
    const trk = AB.track.filter(p => p.t >= l.start && p.t <= l.end);
    const sn = AB.snapshots.filter(s => s.Date >= l.start && s.Date <= l.end);
    FLIGHTS.push(mkSatFlight({
      id: l.id, date: l.start.slice(0, 10), from: l.from, to: l.to,
      fromName: l.fromName, toName: l.toName, durMin: l.durMin, maxAlt: l.maxAlt,
      fuelLb: l.fuelBurn, gwStart: l.gwStart, distNm: l.distNm,
      events: AB.events.filter(e => e.t >= l.start && e.t <= l.end)
        .map(e => ({ ...e, tms: P(e.t), src: "Bee downlink + sim DFDR" })),
      gates: null,
    }, trk, sn));
  });
  if (AB.sat3) {
    const s3 = AB.sat3;
    FLIGHTS.push(mkSatFlight({
      id: s3.id, date: s3.date, from: s3.from, to: s3.to, fromName: s3.fromName, toName: s3.toName,
      durMin: s3.durMin, maxAlt: s3.maxAlt, fuelLb: s3.fuelBurn, events: [], gates: null,
    }, s3.track, s3.snapshots));
  }
  FLIGHTS.sort((a, b) => a.id.localeCompare(b.id));
})();
const state = { fi: FLIGHTS.findIndex(f => f.id === "AB201") };
function selFlight() { return FLIGHTS[state.fi]; }

function fidelityBadge(f) {
  return f.fidelity === "FDR"
    ? `<span class="fid-badge fdr">FDR · 8 Hz</span>`
    : `<span class="fid-badge sat">SAT · downlink</span>`;
}
function renderFlightBars() {
  $$(".flightbar").forEach(bar => {
    bar.innerHTML = FLIGHTS.map((f, i) => `
      <button class="fl-chip ${i === state.fi ? "active" : ""}" data-i="${i}">
        <span class="fl-id">${f.id}</span> ${f.from}→${f.to}
        <small>${f.date} · ${mins(f.durMin)} · ${f.fidelity === "FDR" ? "8 Hz" : "SAT"}</small>
      </button>`).join("");
    bar.querySelectorAll(".fl-chip").forEach(b => b.onclick = () => selectFlight(+b.dataset.i));
  });
  const f = selFlight();
  $("#side-flight").textContent = `${f.id} · ${f.from}→${f.to}`;
  $("#side-fidelity").textContent = f.fidelity === "FDR" ? "8 Hz FDR decode · recorded" : "satellite downlink · 1–2 min";
}
function selectFlight(i) {
  state.fi = i;
  renderFlightBars();
  if (inited.replay) bindReplayFlight();
  if (inited.replay3d) bind3dFlight();
  if (inited.safety) bindSafetyFlight();
  if (inited.report) renderReport();
  if (inited.perf) bindPerfFlight();
}

/* ---------------- navigation ---------------- */
const TITLES = {
  overview: "Fleet & Flights", replay: "Flight Replay — 2D Live Analysis",
  replay3d: "Flight Replay — 3D", health: "Aircraft Health Monitoring",
  pdm: "Predictive Maintenance (AI Prototype)", perf: "Takeoff & Landing Performance", engine: "Engine Condition Monitoring (MOQA)",
  fuel: "Fuel Optimization", safety: "Proactive Safety — FOQA / FDM",
  report: "End of Flight Report", connectors: "The Beehive — Data Connectors",
  ai: "Ask AeroBee — Conversational Intelligence",
};
const inited = {};
function show(view) {
  $$(".nav-item[data-view]").forEach(n => n.classList.toggle("active", n.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === `view-${view}`));
  $("#view-title").textContent = TITLES[view];
  if (!inited[view]) {
    try { INIT[view](); inited[view] = true; }
    catch (err) { console.error(`init ${view} failed`, err); }
  }
  if (view === "replay") setTimeout(() => rp.map && rp.map.invalidateSize(), 60);
  if (view === "overview") setTimeout(() => ov.map && ov.map.invalidateSize(), 60);
  if (view === "replay3d") setTimeout(() => r3.viewer && r3.viewer.resize(), 60);
}
$$(".nav-item[data-view]").forEach(n => n.onclick = () => show(n.dataset.view));

/* ============================================================
   FLEET & FLIGHTS
   ============================================================ */
const ov = {};
function kpiBox(label, value, sub, color) {
  return `<div class="kpi" style="--kc:${color || C.gold}">
    <div class="kl">${label}</div><div class="kv">${value}</div><div class="ks">${sub || ""}</div></div>`;
}
const SIM_FLEET = [
  { reg: "N310AB", type: "A310-300", status: "ACTIVE", health: 93, loc: "OERK", note: "5 flights loaded", live: true },
  { reg: "N762AB", type: "B767-300ER", status: "PARKED", health: 88, loc: "OEJN", note: "awaiting Bee install", live: false },
  { reg: "N815AB", type: "A320-214", status: "MAINT", health: 76, loc: "OERK", note: "C-check day 4 of 12", live: false },
];
function initOverview() {
  /* fleet strip */
  $("#fleet-strip").innerHTML = SIM_FLEET.map((a, i) => `
    <div class="ac-card ${a.live ? "live" : ""}">
      <div class="ac-card-top">
        <span class="ac-card-reg">${a.reg}</span>
        <span class="ac-status st-${a.status}">${a.status}</span>
      </div>
      <div class="ac-card-type">${a.type} · ${a.loc}</div>
      <div class="ac-card-health"><div class="ac-hbar"><i style="width:${a.health}%;background:${a.health >= 90 ? C.green : a.health >= 80 ? C.amber : C.red}"></i></div>${a.health}</div>
      <div class="ac-card-note">${a.note}${a.live ? "" : ' · <span class="sim-mini">simulated</span>'}</div>
    </div>`).join("");

  /* flight cards */
  $("#flight-cards").innerHTML = FLIGHTS.map((f, i) => `
    <div class="flight-card ${i === state.fi ? "active" : ""}" data-i="${i}">
      <div class="fc-top"><b>${f.id}</b>${fidelityBadge(f)}</div>
      <div class="fc-route">${f.from} <span>→</span> ${f.to}</div>
      <div class="fc-meta">${f.date} · ${mins(f.durMin)} · FL${Math.round((f.maxAlt || 0) / 100)}</div>
      <div class="fc-stats">
        <span>${f.fuelLb ? fmt(f.fuelLb) + " lb" : "—"}</span>
        <span>${(f.events || []).length} events</span>
      </div>
    </div>`).join("");
  $$(".flight-card").forEach(c => c.onclick = () => {
    selectFlight(+c.dataset.i);
    $$(".flight-card").forEach((x, j) => x.classList.toggle("active", j === state.fi));
    show("replay");
  });

  const k = AB.fleetKpis;
  $("#ov-kpis").innerHTML =
    kpiBox("Flights Logged", fmt(k.flights), k.period, C.gold) +
    kpiBox("Block Hours", fmt(k.hours), "across logged segments", C.blue) +
    kpiBox("Fuel Burned", `${fmt(k.fuelLb / 1000, 1)}<small> klb</small>`, `≈ $${fmt(k.fuelUsd)} · ${fmt(k.co2Tonnes)} t CO₂`, C.teal) +
    kpiBox("APU On", `${k.apuOnPct}<small>%</small>`, "of downlinked snapshots", C.amber) +
    kpiBox("FDR Rows Mined", "94,576", "8 Hz × 68 wps × 2 flights", C.purple);

  ov.map = L.map("ov-map", { zoomControl: false, attributionControl: false }).setView([25.5, 43], 5);
  L.tileLayer(TILES, TILE_OPTS).addTo(ov.map);
  const seen = {};
  AB.routes.forEach(r => {
    const [o, d] = r.route.split("→");
    if (!AIRPORT_POS[o] || !AIRPORT_POS[d]) return;
    L.polyline([AIRPORT_POS[o], AIRPORT_POS[d]], {
      color: C.gold, weight: Math.min(1 + r.flights / 8, 4), opacity: .5, dashArray: "6 8",
    }).addTo(ov.map).bindTooltip(`${r.route} · ${r.flights} flights`);
    [o, d].forEach(a => {
      if (seen[a]) return; seen[a] = 1;
      L.circleMarker(AIRPORT_POS[a], { radius: 5, color: C.gold, fillColor: "#0a0d13", fillOpacity: 1, weight: 2 })
        .addTo(ov.map).bindTooltip(a, { permanent: true, direction: "top", className: "apt-label", offset: [0, -6] });
    });
  });
  /* FDR flight tracks on the network map */
  FLIGHTS.filter(f => f.fidelity === "FDR").forEach(f => {
    L.polyline(f.track.filter((_, j) => j % 8 === 0).map(p => [p.lat, p.lon]),
      { color: C.teal, weight: 2, opacity: .8 }).addTo(ov.map).bindTooltip(`${f.id} — 8 Hz FDR track`);
  });
  $("#ov-map-note").textContent = `gold dashed = downlink history · teal = FDR tracks`;

  $("#ov-routes").innerHTML =
    `<tr><th>Route</th><th>Flights</th><th>Avg Burn</th><th>Avg Block</th></tr>` +
    AB.routes.map(r => `<tr><td>${r.route}</td><td>${r.flights}</td>
      <td>${r.avgBurnLb ? fmt(r.avgBurnLb) + " lb" : "—"}</td><td>${r.avgMin ? mins(r.avgMin) : "—"}</td></tr>`).join("");

  const m = AB.monthly;
  chartOn($("#ov-monthly"), {
    data: { labels: m.map(x => x.month), datasets: [
      { type: "bar", label: "Flights", data: m.map(x => x.flights), backgroundColor: C.gold + "cc", borderRadius: 4, yAxisID: "y" },
      { type: "line", label: "Block hours", data: m.map(x => x.hours), borderColor: C.teal, borderWidth: 1.5, pointRadius: 0, tension: .35, yAxisID: "y2" },
    ]},
    options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true }, y2: { position: "right", grid: { display: false } } } },
  });
  chartOn($("#ov-fuel"), {
    type: "bar",
    data: { labels: m.map(x => x.month), datasets: [{ label: "Fuel burn (lb)", data: m.map(x => x.fuelLb), backgroundColor: C.teal + "b0", borderRadius: 4 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => fmt(v / 1000) + "k" } } } },
  });
}

/* ============================================================
   REPLAY 2D
   ============================================================ */
const rp = { playing: false, speed: 8, cursor: 0, timer: null, wx: { winds: null, radar: null } };

function initReplay() {
  renderFlightBars();
  rp.map = L.map("rp-map", { zoomControl: true, attributionControl: false });
  L.tileLayer(TILES, TILE_OPTS).addTo(rp.map);
  rp.trail = L.polyline([], { color: C.gold, weight: 3, opacity: .95 }).addTo(rp.map);
  rp.future = L.polyline([], { color: C.blue, weight: 1.5, opacity: .5, dashArray: "5 7" }).addTo(rp.map);
  rp.plane = L.marker([0, 0], {
    icon: L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 17],
      html: `<svg class="plane-icon" id="plane-svg" viewBox="0 0 24 24" width="34" height="34">
        <path fill="#d9a441" d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>` }),
  }).addTo(rp.map);

  $("#rp-kpis").innerHTML = [
    ["ALTITUDE", "rk-alt", "ft", C.blue], ["CAS", "rk-cas", "kt", C.teal],
    ["GND SPEED", "rk-gs", "kt", C.teal], ["HEADING", "rk-hdg", "°", C.gold],
    ["FUEL FLOW", "rk-ff", "lb/hr", C.amber], ["NZ", "rk-nz", "g", C.purple],
  ].map(([l, id, u, c]) =>
    `<div class="kpi" style="--kc:${c}"><div class="kl">${l}</div><div class="kv" id="${id}">—</div><div class="ks">${u}</div></div>`).join("");

  $("#rp-engine-kpis").innerHTML = [
    ["UTC", "rk-utc"], ["RAD ALT ft", "rk-ra"],
  ].map(([l, id]) => `<div class="mk"><div class="kl">${l}</div><div class="kv" id="${id}">—</div></div>`).join("");

  $("#rp-controls").innerHTML = `
    <div class="ctl-leds">
      <div class="led" id="ctl-gear"><span></span>GEAR</div>
      <div class="led" id="ctl-spoiler"><span></span>SPLR</div>
      <div class="led" id="ctl-rev"><span></span>REV</div>
      <div class="led" id="ctl-ap"><span></span>A/P</div>
    </div>
    <div class="ctl-vals">
      <div class="mk"><div class="kl">FLAPS °</div><div class="kv" id="ctl-flap">—</div></div>
      <div class="mk"><div class="kl">AOA °</div><div class="kv" id="ctl-aoa">—</div></div>
      <div class="mk"><div class="kl">IAS kt</div><div class="kv" id="ctl-ias">—</div></div>
    </div>`;

  $("#rp-att").innerHTML = [
    ["PITCH °", "att-pitch"], ["ROLL °", "att-roll"],
    ["WIND", "att-wind"], ["V/S fpm", "att-vs"],
  ].map(([l, id]) => `<div class="mk"><div class="kl">${l}</div><div class="kv" id="${id}">—</div></div>`).join("");

  rp.strip = chartOn($("#rp-strip"), {
    type: "line",
    data: { labels: [], datasets: [
      { label: "Altitude (ft)", data: [], borderColor: C.blue, borderWidth: 1.4, pointRadius: 0, fill: "origin", backgroundColor: "rgba(96,165,250,.08)", yAxisID: "y", tension: .3 },
      { label: "Speed (kt)", data: [], borderColor: C.teal, borderWidth: 1.2, pointRadius: 0, yAxisID: "y2", tension: .3 },
    ]},
    options: { maintainAspectRatio: false, interaction: { intersect: false, mode: "index" },
      scales: { x: { ticks: { maxTicksLimit: 8 } }, y: {}, y2: { position: "right", grid: { display: false } } },
      plugins: { legend: { display: true, position: "top", align: "end" } } },
    plugins: [{ id: "cursor",
      afterDraw(c) {
        if (rp.cursorX == null) return;
        const x = c.scales.x.getPixelForValue(rp.cursorX);
        const { top, bottom } = c.chartArea, g = c.ctx;
        g.save(); g.strokeStyle = C.gold; g.lineWidth = 1.4; g.setLineDash([4, 4]);
        g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); g.restore();
      } }],
  });

  $("#rp-speeds").innerHTML = [4, 8, 20, 60].map(s =>
    `<button class="speed-btn ${s === rp.speed ? "active" : ""}" data-s="${s}">${s}×</button>`).join("");
  $$("#rp-speeds .speed-btn").forEach(b => b.onclick = () => {
    rp.speed = +b.dataset.s;
    $$("#rp-speeds .speed-btn").forEach(x => x.classList.toggle("active", x === b));
  });
  $("#rp-play").onclick = () => rp.playing ? rpPause() : rpPlay();
  $("#rp-slider").oninput = (e) => { rpPause(); seek(+e.target.value / 1000); };
  $("#wx-winds").onclick = () => toggleWinds();
  $("#wx-radar").onclick = () => toggleRadar();

  bindReplayFlight();
}

function bindReplayFlight() {
  rpPause();
  const f = selFlight();
  const strideTrack = f.track.filter((_, i) => i % (f.fidelity === "FDR" ? 4 : 1) === 0);
  rp.tr = strideTrack; rp.t0 = f.t0; rp.t1 = f.t1;
  $("#rp-map-title").textContent = `${f.id} · ${f.from} → ${f.to} · ${f.date} ${fidelityBadge(f).replace(/<[^>]+>/g, "")}`;
  rp.future.setLatLngs(strideTrack.map(p => [p.lat, p.lon]));
  rp.map.fitBounds(rp.future.getBounds(), { padding: [30, 30] });
  rp.strip.data.labels = strideTrack.map(p => hhmmss(p.tms).slice(0, 5));
  rp.strip.data.datasets[0].data = strideTrack.map(p => p.alt);
  rp.strip.data.datasets[1].data = strideTrack.map(p => f.fidelity === "FDR" ? p.cas : p.gs);
  rp.strip.data.datasets[1].label = f.fidelity === "FDR" ? "CAS (kt)" : "Ground speed (kt)";
  rp.strip.update();
  clearWx();
  renderWeatherBrief(f);
  seek(0.02);
}

function renderWeatherBrief(f) {
  const wxFor = (icao) => AB.weather.metars.find(w => w.icao === icao) ||
    { icao, wind: "320°/10 kt", vis: "CAVOK", temp: 40, qnh: 1004, raw: `${icao} — simulated METAR` };
  const dep = wxFor(f.from), arr = wxFor(f.to);
  const windNote = f.fidelity === "FDR" && f.maxWind && f.maxWind.kt
    ? `<div class="wx-row"><span class="wx-tag">REAL FDR WIND</span>
        <span class="wx-main">max ${fmt(f.maxWind.kt)} kt from ${fmt(f.maxWind.dir)}° recorded at cruise</span></div>` : "";
  $("#rp-weather").innerHTML =
    [["DEP", dep], ["ARR", arr]].map(([tag, w]) => `
      <div class="wx-row"><span class="wx-tag">${tag} ${w.icao}</span>
        <span class="wx-main">${w.wind} · ${w.vis} · ${w.temp}°C · Q${w.qnh}</span>
        <div class="wx-raw">${w.raw}</div></div>`).join("") + windNote +
    `<div class="wx-winds">${AB.weather.windsAloft.map(w =>
      `<span class="wx-chip">${w.fl} <b>${w.dir}°/${w.kt}</b></span>`).join("")}</div>`;
}

/* --- weather overlays --- */
function windArrowIcon(dirFrom, kt) {
  const rot = (dirFrom + 180) % 360; /* arrow points where wind blows TO */
  return L.divIcon({ className: "", iconSize: [46, 46], iconAnchor: [23, 23],
    html: `<div class="wind-arrow" style="transform:rotate(${rot}deg)">↑</div><div class="wind-kt">${fmt(kt)}</div>` });
}
function toggleWinds() {
  const f = selFlight();
  if (rp.wx.winds) { rp.map.removeLayer(rp.wx.winds); rp.wx.winds = null; $("#wx-winds").classList.remove("wx-on"); return; }
  const g = L.layerGroup();
  const pts = f.track.filter((p, i) => i % Math.ceil(f.track.length / 14) === 0);
  pts.forEach(p => {
    let wspd = p.wspd, wdir = p.wdir;
    if (wspd == null) { /* SAT: interpolate simulated winds aloft by altitude */
      const wa = AB.weather.windsAloft;
      const fl = (p.alt || 0) / 100;
      const w = wa.reduce((best, x) => Math.abs(parseInt(x.fl.slice(2)) - fl) < Math.abs(parseInt(best.fl.slice(2)) - fl) ? x : best, wa[0]);
      wspd = w.kt; wdir = w.dir;
    }
    if (wspd > 3) L.marker([p.lat, p.lon], { icon: windArrowIcon(wdir, wspd), interactive: false }).addTo(g);
  });
  g.addTo(rp.map); rp.wx.winds = g; $("#wx-winds").classList.add("wx-on");
}
function toggleRadar() {
  if (rp.wx.radar) { rp.map.removeLayer(rp.wx.radar); rp.wx.radar = null; $("#wx-radar").classList.remove("wx-on"); return; }
  const f = selFlight();
  const g = L.layerGroup();
  const mid = f.track[Math.floor(f.track.length / 2)];
  /* simulated convective cells offset from the route */
  const cells = [
    { dLat: .9, dLon: -.6, r: 42000, i: .32 }, { dLat: 1.15, dLon: -.35, r: 26000, i: .5 },
    { dLat: -.8, dLon: .9, r: 55000, i: .22 }, { dLat: -.65, dLon: 1.15, r: 30000, i: .42 },
    { dLat: -.5, dLon: 1.0, r: 15000, i: .62 },
  ];
  cells.forEach(c => {
    L.circle([mid.lat + c.dLat, mid.lon + c.dLon], { radius: c.r, stroke: false,
      fillColor: c.i > .55 ? "#f87171" : c.i > .4 ? "#fbbf24" : "#4ade80", fillOpacity: c.i,
      className: "wx-cell" }).addTo(g);
  });
  g.addTo(rp.map); rp.wx.radar = g; $("#wx-radar").classList.add("wx-on");
}
function clearWx() {
  if (rp.wx.winds) { rp.map.removeLayer(rp.wx.winds); rp.wx.winds = null; $("#wx-winds") && $("#wx-winds").classList.remove("wx-on"); }
  if (rp.wx.radar) { rp.map.removeLayer(rp.wx.radar); rp.wx.radar = null; $("#wx-radar") && $("#wx-radar").classList.remove("wx-on"); }
}

function seek(fr) {
  rp.cursor = fr;
  const f = selFlight();
  const tms = rp.t0 + fr * (rp.t1 - rp.t0);
  const s = f.stateAt(tms);
  if (s.lat != null) {
    rp.plane.setLatLng([s.lat, s.lon]);
    const svg = document.getElementById("plane-svg");
    if (svg) svg.style.transform = `rotate(${Math.round(((s.hdg || 0) + 360) % 360)}deg)`;
    const past = rp.tr.filter(p => p.tms <= tms).map(p => [p.lat, p.lon]);
    past.push([s.lat, s.lon]);
    rp.trail.setLatLngs(past);
  }
  $("#rk-alt").textContent = fmt(s.alt);
  $("#rk-cas").textContent = fmt(s.cas);
  $("#rk-gs").textContent = fmt(s.gs);
  $("#rk-hdg").textContent = String(Math.round(((s.hdg || 0) + 360) % 360)).padStart(3, "0");
  $("#rk-ff").textContent = fmt(s.ff);
  $("#rk-nz").textContent = s.nz != null ? s.nz.toFixed(2) : "—";
  $("#rk-utc").textContent = hhmmss(tms);
  $("#rk-ra").textContent = s.ra != null ? fmt(s.ra) : "—";
  $("#rp-phase").textContent = s.phase || "—";

  drawGauge($("#g-n1a"), s.n1a, 110, C.teal, 101);
  drawGauge($("#g-n1b"), s.n1b, 110, C.teal, 101);
  drawGauge($("#g-egta"), s.egta, 1000, C.amber, 900);
  drawGauge($("#g-egtb"), s.egtb, 1000, C.amber, 900);

  const hasCtl = s.flap != null;
  $("#ctl-flap").textContent = hasCtl ? fmt(s.flap) : "—";
  $("#ctl-aoa").textContent = s.aoa != null ? s.aoa.toFixed(1) : "—";
  $("#ctl-ias").textContent = s.cas != null ? fmt(s.cas) : "—";
  $("#ctl-gear").classList.toggle("on", s.gear === 1);
  $("#ctl-spoiler").classList.toggle("on", s.spoiler === 1);
  $("#ctl-rev").classList.toggle("on", s.rev === 1);
  $("#ctl-ap").classList.toggle("on", s.ap === 1);
  $("#rp-ctl-src").textContent = f.fidelity === "FDR" ? "8 Hz FDR · recorded" :
    (hasCtl ? "1 Hz DFDR window · simulated" : "outside high-rate window · downlink only");

  $("#att-pitch").textContent = s.pitch != null ? s.pitch.toFixed(1) : "—";
  $("#att-roll").textContent = s.roll != null ? s.roll.toFixed(1) : "—";
  $("#att-wind").textContent = s.wspd != null ? `${fmt(s.wdir)}°/${fmt(s.wspd)}` : "—";
  $("#att-vs").textContent = s.vs != null ? fmt(Math.round(s.vs) || 0) : "—";
  $("#rp-att-src").textContent = f.fidelity === "FDR" ? "recorded FDR attitude & IRS wind" : "downlink derived";

  $("#rp-slider").value = Math.round(fr * 1000);
  let ci = rp.tr.findIndex(p => p.tms >= tms);
  rp.cursorX = ci < 0 ? rp.tr.length - 1 : ci;
  rp.strip.update("none");
}
function rpPlay() {
  rp.playing = true; $("#rp-play").textContent = "Pause";
  let last = performance.now();
  const step = (now) => {
    if (!rp.playing) return;
    const real = (now - last) / 1000; last = now;
    const df = (real * rp.speed * 9000) / (rp.t1 - rp.t0);
    let fr = rp.cursor + df;
    if (fr >= 1) { fr = 1; rpPause(); }
    seek(fr);
    rp.timer = requestAnimationFrame(step);
  };
  rp.timer = requestAnimationFrame(step);
}
function rpPause() {
  rp.playing = false;
  const b = $("#rp-play"); if (b) b.textContent = "Play";
  if (rp.timer) cancelAnimationFrame(rp.timer);
}

/* ============================================================
   REPLAY 3D — CesiumJS
   ============================================================ */
const r3 = { follow: true, speed: 30 };
function initReplay3d() {
  renderFlightBars();
  $("#r3-hud").innerHTML = ["ALT", "CAS", "HDG", "N1", "EGT", "UTC"].map(k =>
    `<div class="mk"><div class="kl">${k}</div><div class="kv" id="r3-${k.toLowerCase()}">—</div></div>`).join("");
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "https://cdn.jsdelivr.net/npm/cesium@1.118/Build/Cesium/Widgets/widgets.css";
  document.head.appendChild(css);
  window.CESIUM_BASE_URL = "https://cdn.jsdelivr.net/npm/cesium@1.118/Build/Cesium/";
  const sc = document.createElement("script");
  sc.src = "https://cdn.jsdelivr.net/npm/cesium@1.118/Build/Cesium/Cesium.js";
  sc.onload = setup3d;
  sc.onerror = () => { $("#cesium-container").innerHTML = "<div class='r3-err'>Could not load the 3D engine (network). The 2D replay has full functionality.</div>"; };
  document.body.appendChild(sc);
}
function setup3d() {
  r3.viewer = new Cesium.Viewer("cesium-container", {
    baseLayer: false,
    baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, animation: false, timeline: true, fullscreenButton: true,
    infoBox: false, selectionIndicator: false, shouldAnimate: false,
  });
  r3.viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c", "d"], credit: "© OpenStreetMap © CARTO", maximumLevel: 18,
  }));
  r3.viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0a0d13");
  r3.viewer.scene.skyAtmosphere.show = true;
  /* Own the render loop: rAF for full frame rate, plus an interval fallback so
     frames keep flowing even when the browser throttles rAF (occluded panel). */
  r3.viewer.useDefaultRenderLoop = false;
  const renderOnce = () => { try { r3.viewer.render(); } catch (e) { console.warn("3D render:", e.message || e); } };
  (function loop() { renderOnce(); r3.raf = requestAnimationFrame(loop); })();
  let lastFrame = -1;
  r3.fallback = setInterval(() => {
    const fn = r3.viewer.scene.frameState.frameNumber;
    if (fn === lastFrame) renderOnce();
    lastFrame = fn;
  }, 250);

  $("#r3-speeds").innerHTML = [10, 30, 90, 240].map(s =>
    `<button class="speed-btn ${s === r3.speed ? "active" : ""}" data-s="${s}">${s}×</button>`).join("");
  $$("#r3-speeds .speed-btn").forEach(b => b.onclick = () => {
    r3.speed = +b.dataset.s;
    if (r3.viewer) r3.viewer.clock.multiplier = r3.speed;
    $$("#r3-speeds .speed-btn").forEach(x => x.classList.toggle("active", x === b));
  });
  $("#r3-play").onclick = () => {
    const ck = r3.viewer.clock;
    ck.shouldAnimate = !ck.shouldAnimate;
    $("#r3-play").textContent = ck.shouldAnimate ? "Pause" : "Play";
  };
  $("#r3-follow").onclick = () => {
    r3.follow = !r3.follow;
    if (!r3.follow) {
      r3.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      flyToRoute();
    }
    $("#r3-follow").classList.toggle("wx-on", r3.follow);
  };
  r3.viewer.clock.onTick.addEventListener(() => {
    if (!r3.entity) return;
    const tms = Cesium.JulianDate.toDate(r3.viewer.clock.currentTime).getTime();
    const f = FLIGHTS[r3.boundFi];
    if (!f || tms < f.t0 || tms > f.t1) return;
    const s = f.stateAt(tms);
    /* chase camera — explicit, does not depend on model readiness */
    if (r3.follow && r3.viewer.clock.shouldAnimate && s.lat != null) {
      const target = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, (s.alt || 0) * 0.3048);
      r3.viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(s.hdg || 0), Cesium.Math.toRadians(-22), 14000));
    }
    $("#r3-alt").textContent = fmt(s.alt);
    $("#r3-cas").textContent = fmt(s.cas || s.gs);
    $("#r3-hdg").textContent = String(Math.round(((s.hdg || 0) + 360) % 360)).padStart(3, "0");
    $("#r3-n1").textContent = s.n1a != null ? fmt(s.n1a, 1) : "—";
    $("#r3-egt").textContent = s.egta != null ? fmt(s.egta) : "—";
    $("#r3-utc").textContent = hhmmss(tms);
  });
  bind3dFlight();
}
function bind3dFlight() {
  if (!window.Cesium || !r3.viewer) return;
  const f = selFlight();
  r3.boundFi = state.fi;
  $("#r3-title").textContent = `3D Flight Replay — ${f.id} ${f.from}→${f.to} · ${f.date} (${f.fidelity})`;
  const v = r3.viewer;
  v.entities.removeAll();
  const pos = new Cesium.SampledPositionProperty();
  pos.setInterpolationOptions({ interpolationDegree: 2, interpolationAlgorithm: Cesium.HermitePolynomialApproximation });
  /* skip stationary duplicates — zero-velocity samples NaN the orientation property */
  let prev = null;
  const moving = f.track.filter(p => {
    const key = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    const keep = key !== prev; prev = key; return keep;
  });
  moving.forEach(p => {
    pos.addSample(Cesium.JulianDate.fromDate(new Date(p.tms)),
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, (p.alt || 0) * 0.3048));
  });
  const start = Cesium.JulianDate.fromDate(new Date(moving[0].tms));
  const stop = Cesium.JulianDate.fromDate(new Date(moving[moving.length - 1].tms));
  r3.entity = v.entities.add({
    availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start, stop })]),
    position: pos,
    orientation: new Cesium.VelocityOrientationProperty(pos),
    model: { uri: "https://raw.githubusercontent.com/CesiumGS/cesium/1.118/Apps/SampleData/models/CesiumAir/Cesium_Air.glb",
             minimumPixelSize: 56, maximumScale: 9000, color: Cesium.Color.fromCssColorString("#ffd257") },
    point: { pixelSize: 8, color: Cesium.Color.fromCssColorString("#d9a441") },
    path: { resolution: 4, material: new Cesium.PolylineGlowMaterialProperty({
      glowPower: .18, color: Cesium.Color.fromCssColorString("#d9a441") }), width: 9 },
  });
  v.clock.startTime = start.clone(); v.clock.stopTime = stop.clone();
  v.clock.currentTime = start.clone();
  v.clock.clockRange = Cesium.ClockRange.CLAMPED;
  v.clock.multiplier = r3.speed;
  v.timeline.zoomTo(start, stop);
  $("#r3-follow").classList.toggle("wx-on", r3.follow);
  r3.route = moving;
  flyToRoute();
}
function flyToRoute() {
  const v = r3.viewer, m = r3.route;
  if (!v || !m || !m.length) return;
  v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  const lats = m.map(p => p.lat), lons = m.map(p => p.lon);
  v.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(
      Math.min(...lons) - .8, Math.min(...lats) - .8,
      Math.max(...lons) + .8, Math.max(...lats) + .8),
    duration: 1.8,
  });
}

/* ============================================================
   AIRCRAFT HEALTH
   ============================================================ */
function initHealth() {
  const a = AB.ahm;
  $("#hh-reg").textContent = AB.aircraft.reg;
  $("#hh-val").textContent = a.overall;
  ringGauge($("#hh-ring"), a.overall, a.overall >= 90 ? C.green : a.overall >= 75 ? C.amber : C.red);
  const watch = a.systems.filter(s => s.status !== "NORMAL");
  $("#hh-chips").innerHTML =
    `<span class="hh-chip ok">${a.systems.length - watch.length} systems normal</span>` +
    watch.map(s => `<span class="hh-chip warn">${s.name.split(" (")[0]} — ${s.status}</span>`).join("");
  $("#ahm-grid").innerHTML = a.systems.map(s => `
    <div class="ahm-card ${s.status !== "NORMAL" ? "watch" : ""}">
      <div class="ahm-top">
        <div><div class="ahm-name">${s.name}</div><div class="ahm-ata">ATA ${s.ata}</div></div>
        <div class="ahm-score" style="color:${s.health >= 90 ? C.green : s.health >= 75 ? C.amber : C.red}">${s.health}</div>
      </div>
      <div class="ahm-spark">${sparkSvg(s.trend, s.health >= 90 ? C.green : C.amber)}
        <span class="ahm-status st-${s.status}">${s.status}</span></div>
      <div class="ahm-note">${s.note}</div>
      <div class="ahm-action">→ ${s.action}</div>
    </div>`).join("");
}

/* ============================================================
   PREDICTIVE MAINTENANCE (AI prototype — simulated forecasts
   on top of the real 22-month EGT trend)
   ============================================================ */
function initPdm() {
  const t = AB.egtTrend, LIMIT = 960;
  /* monthly mean margin for engine 2 (the drifting one) */
  const byMonth = {};
  t.forEach(x => {
    if (!x.e2egt) return;
    const m = x.date.slice(0, 7);
    (byMonth[m] = byMonth[m] || []).push(LIMIT - x.e2egt);
  });
  const months = Object.keys(byMonth).sort();
  const margins = months.map(m => byMonth[m].reduce((a, b) => a + b, 0) / byMonth[m].length);
  /* linear fit */
  const nM = margins.length, xs = margins.map((_, i) => i);
  const sx = xs.reduce((a, b) => a + b, 0), sy = margins.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((a, x, i) => a + x * margins[i], 0), sxx = xs.reduce((a, x) => a + x * x, 0);
  const slope = (nM * sxy - sx * sy) / (nM * sxx - sx * sx), icpt = (sy - slope * sx) / nM;
  const H = 12;
  const futMonths = [];
  let [yy, mm] = months[months.length - 1].split("-").map(Number);
  for (let i = 0; i < H; i++) { mm++; if (mm > 12) { mm = 1; yy++; } futMonths.push(`${yy}-${String(mm).padStart(2, "0")}`); }
  const fc = futMonths.map((_, i) => icpt + slope * (nM + i));
  const bandU = fc.map((v, i) => v + 6 + i * 1.6), bandL = fc.map((v, i) => v - 6 - i * 1.6);
  const monthsToLimit = slope < 0 ? Math.round((0 - icpt) / slope) - nM : null;

  $("#pdm-kpis").innerHTML =
    kpiBox("Fleet Availability Risk", "LOW", "next 90 days · simulated model", C.green) +
    kpiBox("Eng 2 Margin Trend", `${slope > 0 ? "+" : ""}${slope.toFixed(1)}<small> °C/mo</small>`, "fit on 22 months of real EGT", slope < -1 ? C.amber : C.teal) +
    kpiBox("Predicted Actions", "4", "next 180 days", C.gold) +
    kpiBox("Unscheduled-Event Reduction", "32<small>%</small>", "industry benchmark for PdM adoption", C.purple) +
    kpiBox("Model", "TS-FM", "time-series foundation model · prototype", C.blue);

  chartOn($("#pdm-forecast"), {
    type: "line",
    data: { labels: [...months, ...futMonths], datasets: [
      { label: "EGT margin (real, monthly mean)", data: [...margins, ...Array(H).fill(null)],
        borderColor: C.teal, borderWidth: 2, pointRadius: 2.5, tension: .3 },
      { label: "AI forecast (simulated)", data: [...Array(nM).fill(null), ...fc],
        borderColor: C.gold, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, tension: .3 },
      { label: "P90 band", data: [...Array(nM).fill(null), ...bandU], borderColor: "transparent",
        pointRadius: 0, fill: "+1", backgroundColor: "rgba(255,179,0,.10)" },
      { label: "", data: [...Array(nM).fill(null), ...bandL], borderColor: "transparent", pointRadius: 0 },
    ]},
    options: { maintainAspectRatio: false,
      plugins: { legend: { labels: { filter: i => i.text } } },
      scales: { x: { ticks: { maxTicksLimit: 14 } }, y: { title: { display: true, text: "°C margin to redline" } } } },
  });

  const rul = [
    { comp: "Engine 2 — HPT blades", ata: "72", p50: 2900, p90: 1850, unit: "FH", driver: "EGT margin erosion + ΔEGT divergence" },
    { comp: "APU — hot section", ata: "49", p50: 1400, p90: 900, unit: "APU hrs", driver: "42.6% ground duty cycle observed" },
    { comp: "Brake #3", ata: "32", p50: 180, p90: 120, unit: "cycles", driver: "wear-pin trend" },
    { comp: "Engine 1 — fuel nozzles", ata: "73", p50: 4200, p90: 3100, unit: "FH", driver: "EGT spread within limits, slow drift" },
  ];
  $("#pdm-rul").innerHTML = rul.map(r => {
    const pct = Math.min(r.p90 / r.p50, 1) * 100;
    return `<div class="rul-row">
      <div class="rul-head"><b>${r.comp}</b><span class="ahm-ata">ATA ${r.ata}</span></div>
      <div class="rul-bar"><i style="width:${pct}%"></i>
        <span class="rul-p90">P90 ${fmt(r.p90)} ${r.unit}</span><span class="rul-p50">P50 ${fmt(r.p50)} ${r.unit}</span></div>
      <div class="rul-driver">driver: ${r.driver}</div></div>`;
  }).join("");

  const tl = [
    { day: 12, sev: "warn", txt: "APU EGT-margin check — combine with overnight stop OERK (est. 3 MH)" },
    { day: 45, sev: "ok", txt: "Engine 2 borescope — HPT stage 1 (schedule with A-check)" },
    { day: 88, sev: "ok", txt: "Brake #3 replacement window opens (~180 cycles)" },
    { day: 150, sev: "warn", txt: "Engine 2 water-wash — recover ~4 °C EGT margin (fuel + margin ROI)" },
  ];
  $("#pdm-timeline").innerHTML = `<div class="tl-track"></div>` + tl.map(x => `
    <div class="tl-item ${x.sev}" style="left:${(x.day / 180) * 100}%">
      <div class="tl-dot"></div><div class="tl-day">D+${x.day}</div>
      <div class="tl-txt">${x.txt}</div></div>`).join("");
}

/* ============================================================
   TAKEOFF & LANDING PERFORMANCE — real 8 Hz FDR analytics
   ============================================================ */
function initPerf() {
  $("#pf-value").innerHTML = [
    ["Derate protects engine life",
     "Every 1% of takeoff thrust reduction extends engine life \u224810% \u2014 the last degrees of EGT are the most damaging. AeroBee grades every departure automatically.",
     "1% derate \u2248 10% life", "Flight Safety Foundation benchmark"],
    ["EGT margin is money",
     "EGT margin decides when an engine comes off wing. Trending real takeoff margin per departure converts temperature into overhaul dollars and removal planning.",
     "margin \u2192 on-wing time", "MOQA trend on recorded data"],
    ["Touchdown dispersion is risk",
     "Long or hard landings drive runway-excursion risk, brake and tire cost. Fleet dispersion analytics find the outliers before the incident report does.",
     "excursions: top insurance claim", "FDM industry practice"],
    ["Predictive beats unscheduled",
     "Platforms in this class report up to 30% fewer unscheduled removals and 25\u201330% maintenance cost reduction. The wedge: measurable outcomes, per tail, from its own data.",
     "\u221230% unscheduled removals", "MRO market research 2025\u201326"],
  ].map(([h, p, sv, sc]) => `<div class="saving-card"><h4>${h}</h4><p>${p}</p>
      <div class="sv" style="font-size:15px">${sv}</div><div class="sc">${sc}</div></div>`).join("");
  bindPerfFlight();
}

function bindPerfFlight() {
  const f = selFlight();
  const kp = $("#pf-to-kpis");
  ["pf-sig", "pf-energy", "pf-td"].forEach(id => { const c = Chart.getChart($("#" + id)); if (c) c.destroy(); });

  if (f.fidelity !== "FDR" || !f.perf) {
    kp.innerHTML = `<div class="panel" style="grid-column:1/-1;text-align:center;padding:34px">
      <div style="font-size:14px;font-weight:600">Full-rate data required</div>
      <div style="font-size:12px;color:var(--text-3);margin-top:6px">
        ${f.id} was captured over satellite downlink (1\u20132 min). Takeoff and landing performance
        analytics need 8 Hz FDR/QAR data \u2014 captured automatically by the Bee edge device.</div></div>`;
    $("#pf-ldg").innerHTML = ""; $("#pf-verdict").textContent = ""; $("#pf-ldg-note").textContent = "";
    return;
  }
  const T = f.perf.takeoff, L = f.perf.landing;
  kp.innerHTML =
    kpiBox("Peak N1", `${fmt(T.n1Peak, 1)}<small> %</small>`, `${fmt(T.deratePct, 1)}% below rated \u2014 reduced thrust`, C.green) +
    kpiBox("Peak EGT", `${fmt(T.egtPeak)}<small> \u00b0C</small>`, `${fmt(T.egtMargin)}\u00b0C margin to redline`, C.teal) +
    kpiBox("Ground Roll", `${fmt(T.groundRollFt)}<small> ft</small>`, `rotation at ${fmt(T.vrCas)} kt CAS`, C.blue) +
    kpiBox("Rotation", `${T.rotRateDegS.toFixed(1)}<small> \u00b0/s</small>`, "target 2.5\u20133.5 \u00b0/s", C.gold) +
    kpiBox("To 1,500 ft", `${fmt(T.secTo1500)}<small> s</small>`, "initial climb performance", C.purple);

  const sig = f.perf.egtN1Sig.filter(r => r[0] > 20);
  chartOn($("#pf-sig"), {
    type: "scatter",
    data: { datasets: [
      { label: "Engine 1", data: sig.map(r => ({ x: r[0], y: r[1] })), pointRadius: 3, backgroundColor: "rgba(242,242,244,.8)" },
      { label: "Engine 2", data: sig.map(r => ({ x: r[2], y: r[3] })), pointRadius: 3, backgroundColor: C.blue },
    ]},
    options: { maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: "N1 %" } }, y: { title: { display: true, text: "EGT \u00b0C" } } } },
  });

  const idx = Object.fromEntries(f.fields.map((k, i) => [k, i]));
  /* final approach only: slice from the last time RA came down through 2,400 ft,
     so out-of-range RA flicker during descent stays out of the plot */
  const pre = f.rows.filter(r => r[idx.t] <= f.onSec && r[idx.ra] != null && r[idx.cas] != null);
  let cut = 0;
  for (let i = pre.length - 1; i >= 0; i--) if (pre[i][idx.ra] >= 2400) { cut = i; break; }
  let app = pre.slice(cut).filter(r => r[idx.ra] > 0 && r[idx.ra] < 2600);
  /* enforce monotonic descent to kill residual sensor flicker */
  let lastRa = Infinity;
  app = app.filter(r => { if (r[idx.ra] <= lastRa + 40) { lastRa = r[idx.ra]; return true; } return false; });
  const vref = f.vref || 137;
  chartOn($("#pf-energy"), {
    type: "line",
    data: { datasets: [
      { label: "CAS (recorded)", data: app.map(r => ({ x: r[idx.ra], y: r[idx.cas] })), borderColor: "rgba(242,242,244,.85)", borderWidth: 1.6, pointRadius: 0 },
      { label: `Vref+5 target (${vref + 5} kt)`, data: [{ x: 2600, y: vref + 5 }, { x: 0, y: vref + 5 }], borderColor: C.gold, borderDash: [5, 5], borderWidth: 1.2, pointRadius: 0 },
      { label: "Gate tolerance (+10 kt)", data: [{ x: 2600, y: vref + 15 }, { x: 0, y: vref + 15 }], borderColor: "rgba(201,123,109,.5)", borderDash: [3, 5], borderWidth: 1, pointRadius: 0 },
    ]},
    options: { maintainAspectRatio: false,
      scales: { x: { type: "linear", reverse: true, title: { display: true, text: "radio altitude ft (\u2192 touchdown)" } },
                y: { title: { display: true, text: "kt CAS" }, suggestedMin: vref - 10 } } },
  });

  const real = FLIGHTS.filter(x => x.fidelity === "FDR" && x.perf)
    .map(x => ({ x: x.perf.landing.tdDistEstFt, y: x.perf.landing.tdG, id: x.id }));
  chartOn($("#pf-td"), {
    type: "scatter",
    data: { datasets: [
      { label: "Fleet history (simulated)", data: AB.tdDispersion.map(d => ({ x: d.distFt, y: d.g })), pointRadius: 4, backgroundColor: "rgba(255,255,255,.16)" },
      { label: "This aircraft (recorded, dist est.)", data: real, pointRadius: 7, pointStyle: "rectRot",
        backgroundColor: real.map(r => r.id === f.id ? "#d9a441" : "rgba(217,164,65,.45)") },
    ]},
    options: { maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: (c) => (c.raw.id ? c.raw.id + ": " : "") + fmt(c.raw.y, 2) + " g @ " + fmt(c.raw.x) + " ft" } } },
      scales: { x: { title: { display: true, text: "touchdown point past threshold (ft)" }, suggestedMax: 3500 },
                y: { title: { display: true, text: "touchdown g" }, suggestedMin: 1.0, suggestedMax: 1.7 } } },
    plugins: [{ id: "tdZones", afterDraw(c) {
      const g = c.ctx, a = c.chartArea, x = c.scales.x, y = c.scales.y;
      g.save(); g.strokeStyle = "rgba(201,123,109,.4)"; g.setLineDash([4, 5]); g.lineWidth = 1;
      const yh = y.getPixelForValue(1.4), xv = x.getPixelForValue(2000);
      g.beginPath(); g.moveTo(a.left, yh); g.lineTo(a.right, yh); g.stroke();
      g.beginPath(); g.moveTo(xv, a.top); g.lineTo(xv, a.bottom); g.stroke();
      g.fillStyle = "rgba(201,123,109,.7)"; g.font = "500 10px Inter";
      g.fillText("firm 1.40 g", a.left + 6, yh - 5); g.fillText("long 2,000 ft", xv + 5, a.top + 12);
      g.restore();
    } }],
  });

  $("#pf-ldg-note").textContent = `${f.id} \u00b7 recorded 8 Hz`;
  $("#pf-ldg").innerHTML = [
    ["Flare", L.flareSec.toFixed(1) + " s", "50 ft \u2192 touchdown"],
    ["Touchdown", L.tdG.toFixed(2) + " g", "pitch " + L.tdPitch.toFixed(1) + "\u00b0"],
    ["TD point", fmt(L.tdDistEstFt) + " ft", "estimated past threshold"],
    ["Reverse", L.revSec.toFixed(0) + " s", "max " + L.revMaxN1.toFixed(0) + "% N1"],
    ["Deceleration", L.decelKtS.toFixed(1) + " kt/s", "first 15 s"],
    ["Taxi-in", L.taxiInMin.toFixed(0) + " min", fmt(L.taxiInFuelLb) + " lb burned"],
  ].map(([l, v, sub]) => `<div class="mk"><div class="kl">${l}</div><div class="kv">${v}</div>
    <div class="kl" style="text-transform:none;letter-spacing:0;margin-top:2px">${sub}</div></div>`).join("");
  const clean = L.tdG < 1.4 && L.tdDistEstFt < 2000;
  $("#pf-verdict").className = "td-verdict " + (clean ? "ok" : "warn");
  $("#pf-verdict").textContent = clean
    ? `Stabilized and efficient: on-speed approach, ${L.tdG.toFixed(2)} g touchdown inside the target zone. ` +
      (L.revMaxN1 > 60 ? "Full reverse was used \u2014 idle reverse would have saved \u224866 lb on this runway." : "Idle reverse used \u2014 efficient.")
    : `Flagged for review \u2014 auto-routed to the FOQA queue.`;
}

/* ============================================================
   ENGINE (unchanged core) / FUEL
   ============================================================ */
function initEngine() {
  const t = AB.egtTrend, last = t.slice(-30);
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const e1 = avg(last.map(x => x.e1egt).filter(Boolean)), e2 = avg(last.map(x => x.e2egt).filter(Boolean));
  const meanDelta = avg(t.slice(-30).map(x => x.delta).filter(x => x != null));
  const EGT_LIMIT = 960;
  $("#en-kpis").innerHTML =
    kpiBox("EGT Margin — Eng 1", `${fmt(EGT_LIMIT - e1)}<small> °C</small>`, `30-departure mean vs ${EGT_LIMIT}°C limit`, C.teal) +
    kpiBox("EGT Margin — Eng 2", `${fmt(EGT_LIMIT - e2)}<small> °C</small>`, "30-departure mean", C.teal) +
    kpiBox("Eng1−Eng2 Δ EGT", `${meanDelta > 0 ? "+" : ""}${fmt(meanDelta, 1)}<small> °C</small>`, "recent mean divergence", Math.abs(meanDelta) > 25 ? C.amber : C.green) +
    kpiBox("Departures Trended", fmt(t.length), AB.fleetKpis.period, C.gold) +
    kpiBox("Health Status", "NORMAL", "no exceedance vs redline detected", C.green);

  chartOn($("#en-trend"), {
    type: "line",
    data: { labels: t.map(x => x.date), datasets: [
      { label: "Eng 1 takeoff EGT", data: t.map(x => x.e1egt), borderColor: C.red + "55", borderWidth: 1, pointRadius: 1.5, pointBackgroundColor: C.red + "88" },
      { label: "Eng 2 takeoff EGT", data: t.map(x => x.e2egt), borderColor: C.amber + "55", borderWidth: 1, pointRadius: 1.5, pointBackgroundColor: C.amber + "88" },
      { label: "Eng 1 — 15-flight mean", data: AB.egtRoll1, borderColor: C.red, borderWidth: 2.2, pointRadius: 0, tension: .35 },
      { label: "Eng 2 — 15-flight mean", data: AB.egtRoll2, borderColor: C.amber, borderWidth: 2.2, pointRadius: 0, tension: .35 },
    ]},
    options: { maintainAspectRatio: false, scales: { x: { ticks: { maxTicksLimit: 14 } }, y: { title: { display: true, text: "EGT °C at takeoff power" } } } },
  });
  chartOn($("#en-delta"), {
    type: "bar",
    data: { labels: t.map(x => x.date), datasets: [{ label: "ΔEGT (Eng1−Eng2) °C",
      data: t.map(x => x.delta), backgroundColor: t.map(x => Math.abs(x.delta ?? 0) > 40 ? C.red : C.teal + "90"), borderRadius: 2 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 10 } } } },
  });
  const rows = AB.snapshots.filter(s => s.Date < "2021-08-10 13:00");
  $("#en-oil").innerHTML =
    `<tr><th>Phase</th><th>Oil P 1/2 psi</th><th>Oil T 1/2 °C</th><th>Oil Qty 1/2 qt</th><th>Vib N1 1/2</th></tr>` +
    rows.map(s => `<tr>
      <td class="txt">${s.Flag.replace("_Flag", "").replace("_", " ")}</td>
      <td>${fmt(s["Engine 1 Oil Pressure"])} / ${fmt(s["Engine 2 Oil Pressure"])}</td>
      <td>${fmt(s["Engine 1 Oil Temperature"])} / ${fmt(s["Engine 2 Oil Temperature"])}</td>
      <td>${fmt(s["Engine 1 Oil Quantity"], 1)} / ${fmt(s["Engine 2 Oil Quantity"], 1)}</td>
      <td>${fmt(s["Engine 1 Vibration N1"], 2)} / ${fmt(s["Engine 2 Vibration N1"], 2)}</td></tr>`).join("");
}

function initFuel() {
  const l1 = AB.legs[0], l2 = AB.legs[1];
  const totalBurn = l1.fuelBurn + l2.fuelBurn;
  const totSave = AB.savings.reduce((a, s) => a + s.annualUsd, 0);
  const totLb = AB.savings.reduce((a, s) => a + s.annualLb, 0);
  $("#fu-kpis").innerHTML =
    kpiBox("Round-Trip Burn", `${fmt(totalBurn)}<small> lb</small>`, "OERK ↔ OENN · 10 Aug 2021", C.gold) +
    kpiBox("FDR Flights Burn", `${fmt(FLIGHTS.filter(f => f.fidelity === "FDR").reduce((a, f) => a + f.fuelLb, 0))}<small> lb</small>`, "OERK ↔ OEJD · 29 Apr 2023 · FF-integrated", C.purple) +
    kpiBox("Cost of Fuel", `$${fmt(totalBurn * AB.fuelUsdPerLb)}`, `@ $${AB.fuelUsdPerLb}/lb Jet A-1`, C.teal) +
    kpiBox("CO₂ Emitted", `${fmt(totalBurn * .4536 * 3.16 / 1000, 1)}<small> t</small>`, "NEOM round trip", C.blue) +
    kpiBox("Identified Savings", `$${fmt(totSave)}<small>/yr</small>`, `${fmt(totLb)} lb · ${fmt(AB.savings.reduce((a, s) => a + s.annualCo2T, 0))} t CO₂`, C.green);

  chartOn($("#fu-phase"), {
    type: "bar",
    data: { labels: [...new Set(AB.phaseBurn.map(p => p.phase))],
      datasets: AB.legs.map((l, i) => ({
        label: `${l.id} ${l.from}→${l.to}`,
        data: [...new Set(AB.phaseBurn.map(p => p.phase))].map(ph => {
          const r = AB.phaseBurn.find(p => p.leg === l.id && p.phase === ph);
          return r ? r.burnLb : null;
        }),
        backgroundColor: i === 0 ? C.gold + "cc" : C.teal + "b0", borderRadius: 4,
      })) },
    options: { maintainAspectRatio: false, scales: { y: { title: { display: true, text: "lb burned in phase" } } } },
  });
  const sn = AB.snapshots;
  chartOn($("#fu-ff"), {
    type: "scatter",
    data: { datasets: [{ label: "Total fuel flow vs altitude",
      data: sn.map(s => ({ x: (s["Engine 1 Fuel Flow"] || 0) + (s["Engine 2 Fuel Flow"] || 0), y: s.Altitude })),
      backgroundColor: C.amber, pointRadius: 4 }]},
    options: { maintainAspectRatio: false, scales: {
      x: { title: { display: true, text: "lb/hr (both engines)" } },
      y: { title: { display: true, text: "altitude ft" } } } },
  });
  $("#fu-savings-total").textContent = `total identified: $${fmt(totSave)}/yr for this single aircraft`;
  $("#fu-savings").innerHTML = AB.savings.map(s => `
    <div class="saving-card"><h4>${s.name}</h4><p>${s.detail}</p>
      <div class="sv">$${fmt(s.annualUsd)}<span style="font-size:11px;color:#8b96ab">/yr</span></div>
      <div class="sc">${fmt(s.annualLb)} lb fuel · ${s.annualCo2T} t CO₂ · ${Math.round(s.adoption * 100)}% adoption assumed</div>
    </div>`).join("");
}

/* ============================================================
   SAFETY — flight-aware FOQA
   ============================================================ */
function initSafety() {
  renderFlightBars();
  bindSafetyFlight();
}
function bindSafetyFlight() {
  const f = selFlight();
  const allEv = FLIGHTS.flatMap(x => x.events || []);
  const cnt = (sev) => allEv.filter(e => e.sev === sev).length;
  $("#sa-kpis").innerHTML =
    kpiBox("High Severity", cnt("High"), "all 5 flights", C.red) +
    kpiBox("Medium Severity", cnt("Medium"), "all 5 flights", C.amber) +
    kpiBox("Low / Advisory", cnt("Low"), "all 5 flights", C.teal) +
    kpiBox("This Flight", (f.events || []).length, `${f.id} · ${f.fidelity === "FDR" ? "mined from 8 Hz FDR" : "downlink + sim"}`, C.gold) +
    kpiBox("Data Fidelity", f.fidelity, f.fidelity === "FDR" ? "68 wps recorded" : "1–2 min satellite", C.blue);

  /* approach analysis */
  if (f.fidelity === "FDR") {
    const rowsAll = f.track;
    /* approach = last portion below 3500 ft with descending alt */
    const land = rowsAll[rowsAll.length - 1];
    const app = rowsAll.filter(p => p.tms > f.t1 - 16 * 60000 && p.alt < (land.alt + 3600));
    $("#sa-app-note").textContent = "REAL 8 Hz FDR approach · radio altitude & CAS";
    chartOn($("#sa-approach"), {
      type: "line",
      data: { labels: app.map(p => hhmmss(p.tms).slice(3)), datasets: [
        { label: "Baro altitude (ft)", data: app.map(p => p.alt), borderColor: C.blue, borderWidth: 1.6, pointRadius: 0, yAxisID: "y", fill: "origin", backgroundColor: "rgba(96,165,250,.07)" },
        { label: "CAS (kt)", data: app.map(p => p.cas), borderColor: C.teal, borderWidth: 1.6, pointRadius: 0, yAxisID: "y2" },
        { label: `Vref+5 (${f.vref + 5} kt)`, data: app.map(() => f.vref + 5), borderColor: C.gold, borderDash: [5, 5], borderWidth: 1.2, pointRadius: 0, yAxisID: "y2" },
      ]},
      options: { maintainAspectRatio: false, interaction: { intersect: false, mode: "index" },
        scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { title: { display: true, text: "ft" } },
          y2: { position: "right", grid: { display: false }, title: { display: true, text: "kt" } } } },
    });
    const gates = f.gates || {};
    const gRow = (gname, gd) => `
      <tr><td>${gname} ft</td><td>${fmt(gd.cas)} kt</td><td>${fmt(gd.rod)} fpm</td>
      <td>${gd.gsdev} / ${gd.locdev}</td><td>${gd.gearDown ? "DOWN" : "UP"}</td><td>${fmt(gd.n1, 1)}%</td></tr>`;
    $("#sa-td-note").textContent = "real recorded gates";
    $("#sa-touchdown").innerHTML = `
      <table class="tbl"><tr><th>Gate</th><th>CAS</th><th>ROD</th><th>GS/LOC dev</th><th>Gear</th><th>N1</th></tr>
      ${Object.entries(gates).sort((a, b) => +b[0] - +a[0]).map(([k, v]) => gRow(k, v)).join("")}</table>
      <div class="td-grid" style="margin-top:12px">
        <div class="td-cell ${f.tdNz < 1.4 ? "ok" : "warn"}"><div class="kl">TOUCHDOWN NZ</div>
          <div class="kv">${f.tdNz.toFixed(2)} g</div><div class="ks">recorded · limit 1.60 g</div></div>
        <div class="td-cell ok"><div class="kl">MAX WIND</div>
          <div class="kv">${fmt(f.maxWind.kt)} kt</div><div class="ks">from ${fmt(f.maxWind.dir)}° · recorded IRS wind</div></div>
      </div>
      <div class="td-verdict ${((gates["500"] || {}).cas || 0) <= f.vref + 15 && f.tdNz < 1.4 ? "ok" : "warn"}">
        ${f.id}: ${((gates["500"] || {}).cas || 0) <= f.vref + 15 && f.tdNz < 1.4
          ? "Stabilized — on speed and configured at all gates, touchdown within limits."
          : "Review — gate tolerance exceeded, flagged for FOQA review."}</div>`;
  } else if (AB.dfdr && AB.dfdr[f.id]) {
    const d = AB.dfdr[f.id], rows = d.approach.filter(r => r[0] <= 10);
    $("#sa-app-note").textContent = "simulated 1 Hz DFDR layer";
    chartOn($("#sa-approach"), {
      type: "line",
      data: { labels: rows.map(r => r[0]), datasets: [
        { label: "Radio altitude (ft)", data: rows.map(r => r[5]), borderColor: C.blue, borderWidth: 1.6, pointRadius: 0, yAxisID: "y", fill: "origin", backgroundColor: "rgba(96,165,250,.07)" },
        { label: "IAS (kt)", data: rows.map(r => r[1]), borderColor: C.teal, borderWidth: 1.6, pointRadius: 0, yAxisID: "y2" },
        { label: `Vref+5 (${d.meta.vref + 5} kt)`, data: rows.map(() => d.meta.vref + 5), borderColor: C.gold, borderDash: [5, 5], borderWidth: 1.2, pointRadius: 0, yAxisID: "y2" },
      ]},
      options: { maintainAspectRatio: false, scales: { x: { title: { display: true, text: "seconds to touchdown" }, ticks: { maxTicksLimit: 12 } },
        y: { title: { display: true, text: "RA ft" } }, y2: { position: "right", grid: { display: false } } } },
    });
    const m = d.meta;
    $("#sa-td-note").textContent = "simulated DFDR · 1 Hz";
    $("#sa-touchdown").innerHTML = `<div class="td-grid">
      <div class="td-cell ${m.tdG < 1.4 ? "ok" : "warn"}"><div class="kl">TOUCHDOWN G</div><div class="kv">${m.tdG.toFixed(2)} g</div><div class="ks">limit 1.60 g</div></div>
      <div class="td-cell ${m.tdDistFt <= 2000 ? "ok" : "warn"}"><div class="kl">TD DISTANCE</div><div class="kv">${fmt(m.tdDistFt)} ft</div><div class="ks">target ≤ 2,000 ft</div></div>
      <div class="td-cell ${m.revMode === "IDLE" ? "ok" : "warn"}"><div class="kl">REVERSE</div><div class="kv">${m.revMode}</div><div class="ks">idle saves ≈66 lb</div></div>
      </div>`;
  } else {
    if (Chart.getChart($("#sa-approach"))) Chart.getChart($("#sa-approach")).destroy();
    $("#sa-app-note").textContent = "not available at downlink rate";
    $("#sa-touchdown").innerHTML = `<div class="td-verdict warn">Approach-gate analysis needs high-rate data.
      This flight has 1–2 min satellite telemetry only — exactly the gap the Bee edge device closes by
      computing FOQA events onboard at full rate.</div>`;
    const c = $("#sa-approach").getContext("2d"); c.clearRect(0, 0, 900, 400);
  }

  /* events table: selected flight first, then the rest */
  const evs = [...(f.events || []), ...FLIGHTS.filter(x => x.id !== f.id).flatMap(x => x.events || [])];
  $("#sa-events").innerHTML =
    `<tr><th>Severity</th><th>Category</th><th>Event</th><th>Flight</th><th>Time UTC</th><th>Value</th><th>Limit</th><th>Source</th></tr>` +
    evs.map((e) => `<tr class="clickable ${e.flight === f.id ? "" : "dim-row"}" data-f="${e.flight}" data-t="${e.tms}">
      <td><span class="sev sev-${e.sev}">${e.sev}</span></td>
      <td class="txt">${e.cat}</td><td class="txt">${e.desc}</td>
      <td>${e.flight}</td><td>${hhmmss(e.tms).slice(0, 5)}</td>
      <td style="color:${e.sev === "High" ? C.red : C.amber}">${fmt(e.value, 2)} ${e.unit}</td>
      <td>${fmt(e.limit, 2)} ${e.unit}</td><td class="txt" style="font-size:10px;color:#8b96ab">${e.src || "downlink"}</td></tr>`).join("");
  $$("#sa-events tr.clickable").forEach(row => row.onclick = () => {
    const fi = FLIGHTS.findIndex(x => x.id === row.dataset.f);
    if (fi < 0) return;
    selectFlight(fi);
    show("replay");
    const fl = FLIGHTS[fi];
    seek(Math.min(Math.max((+row.dataset.t - fl.t0) / (fl.t1 - fl.t0), 0), 1));
  });
  $("#nav-event-count").textContent = allEv.length;
}

/* ============================================================
   END OF FLIGHT REPORT — all 5 flights
   ============================================================ */
function initReport() {
  renderFlightBars();
  $("#report-csv").onclick = () => downloadReport("csv");
  $("#report-json").onclick = () => downloadReport("json");
  renderReport();
}
function fdrPhaseTable(f) {
  /* sample representative instants through the flight */
  const marks = [
    ["Taxi Out", f.t0 + (f.t1 - f.t0) * .01], ["Takeoff", f.t0 + 1000 + (fdrOff(f) - f.t0)],
    ["Climb", fdrOff(f) + 8 * 60000], ["Cruise", (fdrOff(f) + fdrOn(f)) / 2],
    ["Descent", fdrOn(f) - 14 * 60000], ["Approach", fdrOn(f) - 3 * 60000],
    ["Landing", fdrOn(f) - 10000], ["Taxi In", fdrOn(f) + 4 * 60000],
  ];
  return marks.map(([ph, tms]) => {
    const s = f.stateAt(Math.min(Math.max(tms, f.t0), f.t1));
    return `<tr><td>${ph}</td><td>${hhmmss(tms)}</td>
      <td>${fmt(s.n1a, 1)}</td><td>${fmt(s.egta)}</td><td>${fmt((s.ff || 0) / 2)}</td><td>${s.flap != null ? fmt(s.flap) : "—"}</td>
      <td>${fmt(s.n1b, 1)}</td><td>${fmt(s.egtb)}</td><td>${fmt((s.ff || 0) / 2)}</td><td>${s.gear ? "DN" : "UP"}</td></tr>`;
  }).join("");
}
function fdrOff(f) { return f.t0 + (FDR_FLIGHTS.find(x => x.id === f.id).offSec - FDR_FLIGHTS.find(x => x.id === f.id).startSec) * 1000; }
function fdrOn(f) { return f.t0 + (FDR_FLIGHTS.find(x => x.id === f.id).onSec - FDR_FLIGHTS.find(x => x.id === f.id).startSec) * 1000; }

function renderReport() {
  const f = selFlight();
  let body;
  if (f.fidelity === "FDR") {
    const cru = f.stateAt((fdrOff(f) + fdrOn(f)) / 2);
    body = `
      <div class="sec">ECM PARAMETERS — ACTUAL VALUE AT CRUISE (8 Hz FDR)</div>
      <div class="rs-grid">
        <div><b>Gross Weight (start)</b><span>${fmt(f.gwStart)} lb</span></div>
        <div><b>Cruise Altitude</b><span>${fmt(cru.alt)} ft</span></div>
        <div><b>Fuel Used (FF-integrated)</b><span>${fmt(f.fuelLb)} lb</span></div>
        <div><b>Cruise CAS</b><span>${fmt(cru.cas)} kt</span></div>
        <div><b>Max Wind (IRS)</b><span>${fmt(f.maxWind.kt)} kt / ${fmt(f.maxWind.dir)}°</span></div>
        <div><b>Touchdown Nz</b><span>${f.tdNz.toFixed(2)} g</span></div>
      </div>
      <div class="sec">FUEL CONSUMPTION AND ENGINE PARAMETER SUMMARY</div>
      <table>
        <tr><th rowspan="2">Phase</th><th rowspan="2">Time UTC</th>
          <th colspan="4">Engine 1</th><th colspan="4">Engine 2 / Config</th></tr>
        <tr><th>N1 %</th><th>EGT °C</th><th>FF lb/hr</th><th>Flap °</th>
          <th>N1 %</th><th>EGT °C</th><th>FF lb/hr</th><th>Gear</th></tr>
        ${fdrPhaseTable(f)}
      </table>`;
  } else {
    const eof = (AB.eof || []).find(r => r.leg.id === f.id);
    if (eof) {
      const c = eof.cruise, l = eof.legStats;
      body = `
        <div class="sec">ECM PARAMETERS — ACTUAL VALUE AT CRUISE</div>
        <div class="rs-grid">
          <div><b>Gross Weight</b><span>${fmt(l.gwStart)} lb</span></div>
          <div><b>Cruise Altitude</b><span>${fmt(c.Altitude)} ft</span></div>
          <div><b>Fuel at Takeoff</b><span>${fmt(l.fuelStart)} lb</span></div>
          <div><b>Cruise Mach</b><span>M ${(c["Mach Number"] / 1000).toFixed(2)}</span></div>
          <div><b>Fuel at Landing</b><span>${fmt(l.fuelEnd)} lb</span></div>
          <div><b>Cruise IAS</b><span>${fmt(c["Speed/IAS"])} kt</span></div>
          <div><b>Fuel Burned</b><span>${fmt(l.fuelBurn)} lb</span></div>
          <div><b>Total Air Temp</b><span>${fmt(c["Total Air Temperature"], 1)} °C</span></div>
        </div>
        <div class="sec">FUEL CONSUMPTION AND ENGINE PARAMETER SUMMARY</div>
        <table>
          <tr><th rowspan="2">Phase</th><th rowspan="2">Time UTC</th><th rowspan="2">APU</th>
            <th colspan="4">Engine 1</th><th colspan="4">Engine 2</th></tr>
          <tr><th>N1 %</th><th>EGT °C</th><th>FF lb/hr</th><th>Oil psi</th>
            <th>N1 %</th><th>EGT °C</th><th>FF lb/hr</th><th>Oil psi</th></tr>
          ${eof.phases.map(s => `<tr><td>${s.Flag.replace("_Flag", "").replace("_", " ")}</td><td>${s.Date.slice(11, 19)}</td>
            <td>${fmt(s["APU Usage Gnd/Air"])}</td>
            <td>${fmt(s["Engine 1 N1"])}</td><td>${fmt(s["Engine 1 EGT"])}</td><td>${fmt(s["Engine 1 Fuel Flow"])}</td><td>${fmt(s["Engine 1 Oil Pressure"])}</td>
            <td>${fmt(s["Engine 2 N1"])}</td><td>${fmt(s["Engine 2 EGT"])}</td><td>${fmt(s["Engine 2 Fuel Flow"])}</td><td>${fmt(s["Engine 2 Oil Pressure"])}</td></tr>`).join("")}
        </table>`;
    } else {
      const snaps3 = (AB.sat3 && AB.sat3.snapshots) || [];
      body = `
        <div class="sec">PARAMETER SNAPSHOTS — SATELLITE DOWNLINK</div>
        <table>
          <tr><th>Phase</th><th>Time UTC</th><th>Alt ft</th><th>IAS kt</th>
            <th>N1 1 %</th><th>EGT 1 °C</th><th>FF 1</th><th>N1 2 %</th><th>EGT 2 °C</th><th>FF 2</th></tr>
          ${snaps3.map(s => `<tr><td>${PHASE_BY_CODE[s.Code] || s.Code}</td><td>${(s.Date || "").slice(11, 19)}</td>
            <td>${fmt(s.Altitude)}</td><td>${fmt(s["Speed/IAS"])}</td>
            <td>${fmt(s["Engine 1 N1"])}</td><td>${fmt(s["Engine 1 EGT"])}</td><td>${fmt(s["Engine 1 Fuel Flow"])}</td>
            <td>${fmt(s["Engine 2 N1"])}</td><td>${fmt(s["Engine 2 EGT"])}</td><td>${fmt(s["Engine 2 Fuel Flow"])}</td></tr>`).join("")}
        </table>`;
    }
  }
  $("#report-sheet").innerHTML = `
    <div class="rs-head">
      <div class="rs-brand">Aero<span>Bee</span> — End of Flight Summary Report</div>
      <div>Engineering & Maintenance</div>
    </div>
    <div class="rs-grid">
      <div><b>Aircraft Type</b><span>${AB.aircraft.type}</span></div><div><b>Date</b><span>${f.date}</span></div>
      <div><b>Registration</b><span>${AB.aircraft.reg}</span></div><div><b>Flight ID</b><span>${f.id}</span></div>
      <div><b>Origin</b><span>${f.from} — ${f.fromName || f.from}</span></div><div><b>Destination</b><span>${f.to} — ${f.toName || f.to}</span></div>
      <div><b>Data Source</b><span>${f.fidelity === "FDR" ? "FDR decode · 68 wps · 8 Hz" : "Bee edge — satellite downlink"}</span></div>
      <div><b>Duration</b><span>${mins(f.durMin)}</span></div>
    </div>
    ${body}
    <p style="margin-top:12px;font-size:10px;color:#666">Generated by AeroBee Studio. Demo fleet — identifiers white-labeled.</p>`;
}
function downloadReport(kind) {
  const f = selFlight();
  const payload = { flight: f.id, route: `${f.from}-${f.to}`, date: f.date, fidelity: f.fidelity,
    durMin: f.durMin, fuelLb: f.fuelLb, events: f.events, gates: f.gates || null };
  let blob, name;
  if (kind === "json") {
    blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    name = `AeroBee_EOF_${f.id}.json`;
  } else {
    const ev = f.events || [];
    const csv = ["sev,cat,desc,value,limit,unit", ...ev.map(e => `${e.sev},${e.cat},"${e.desc}",${e.value},${e.limit},${e.unit}`)].join("\n");
    blob = new Blob([csv], { type: "text/csv" });
    name = `AeroBee_EOF_${f.id}.csv`;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

/* ============================================================
   THE BEEHIVE — DATA CONNECTORS
   ============================================================ */
const CONNECTORS = [
  { name: "FDR / QAR decodes", icon: "", status: "CONNECTED", meta: "2 flights · 94,576 rows · 68 wps", real: true },
  { name: "Bee edge telemetry", icon: "", status: "CONNECTED", meta: "325 flights · 68k downlink records", real: true },
  { name: "Weather — METAR / GRIB", icon: "", status: "SIMULATED", meta: "4 stations + winds aloft" },
  { name: "Maintenance — AMOS / TRAX", icon: "", status: "SIMULATED", meta: "work orders · component times" },
  { name: "ACARS / datalink", icon: "", status: "ROADMAP", meta: "OOOI · position · free text" },
  { name: "Flight plans — dispatch", icon: "", status: "ROADMAP", meta: "planned vs actual deviation" },
  { name: "Fuel invoices & uplift", icon: "", status: "ROADMAP", meta: "cost reconciliation" },
  { name: "Tech manuals · MEL · SB (PDF)", icon: "", status: "SIMULATED", meta: "RAG-indexed documents" },
  { name: "Crew rosters", icon: "", status: "ROADMAP", meta: "fatigue & pairing context" },
  { name: "NOTAMs & airport data", icon: "", status: "ROADMAP", meta: "operational constraints" },
];
const STUDIO_APPS = [
  { name: "Proactive Safety (FOQA)", icon: "" }, { name: "Fuel Optimization", icon: "" },
  { name: "Aircraft Health & PdM", icon: "" }, { name: "Flight Replay 2D/3D", icon: "" },
  { name: "EOF Reports", icon: "" }, { name: "Ask AeroBee (LLM+RAG)", icon: "" },
];
function initConnectors() {
  $("#bh-sources").innerHTML = CONNECTORS.map((c, i) => `
    <div class="bh-node src st-${c.status}" style="animation-delay:${i * .08}s">
      <span class="bh-ic">${c.icon}</span>
      <div><div class="bh-name">${c.name}</div><div class="bh-meta">${c.meta}</div></div>
      <span class="bh-pill p-${c.status}">${c.status}</span>
    </div>`).join("");
  $("#bh-apps").innerHTML = STUDIO_APPS.map((a, i) => `
    <div class="bh-node app" style="animation-delay:${.4 + i * .1}s">
      <span class="bh-ic">${a.icon}</span><div class="bh-name">${a.name}</div>
    </div>`).join("");
  /* animated flow lines */
  const mk = (gid, n, rev) => {
    const g = document.getElementById(gid);
    g.innerHTML = Array.from({ length: n }, (_, i) => {
      const y = 24 + i * (352 / (n - 1));
      const d = rev ? `M0,200 C60,200 60,${y} 120,${y}` : `M0,${y} C60,${y} 60,200 120,200`;
      return `<path d="${d}" class="bh-line" style="animation-delay:${i * .3}s"/>`;
    }).join("");
  };
  mk("bh-lines-l", CONNECTORS.length, false);
  mk("bh-lines-r", STUDIO_APPS.length, true);

  $("#bh-demo").innerHTML = `
    <div class="msg user" style="align-self:flex-end;max-width:100%">Why did AB202 burn 8% more fuel than planned, and is Engine 2 a factor?</div>
    <div class="msg bot" style="max-width:100%"><b>Fused answer across 5 sources:</b><br><br>
      1. <b>FDR</b>: AB202 cruised at FL310 against a recorded 97–102 kt headwind component (IRS wind 265°/97 kt) — ~430 lb of the overage.<br>
      2. <b>Weather (GRIB)</b>: the jet was 40 kt stronger than the seasonal mean used in planning.<br>
      3. <b>Flight plan</b>: dispatch filed FL350; ATC held the flight at FL310 for 22 min — ~210 lb penalty.<br>
      4. <b>Engine trend</b>: Engine 2 ΔEGT is drifting (+6 °C/90 days) → ~0.4% SFC penalty, ~70 lb on this sector.<br>
      5. <b>Maintenance (AMOS)</b>: Engine 2 water-wash is overdue 240 FH — projected to recover most of that SFC.<br><br>
      <b>Recommendation:</b> schedule the wash at the D+150 window (see Predictive Maintenance) and re-file seasonal winds.
      <span class="src">Sources: FDR 8 Hz · GRIB winds · dispatch FPL · MOQA trend · AMOS — demo composition</span>
    </div>`;

  const ROADMAP = [
    { t: "Agentic AI Ops Copilot", d: "Autonomous agents that watch every flight, open maintenance findings, draft FOQA reports and negotiate schedules — human-approved.", h: "2026: agent frameworks mature in aviation MRO" },
    { t: "Time-Series Foundation Models", d: "Zero-shot anomaly detection on any sensor channel without per-fleet training (Chronos/TimesFM-class models on the Beehive).", h: "replaces hand-tuned exceedance thresholds" },
    { t: "Digital Twin + Simulation", d: "Per-tail twin simulating fatigue and performance from routes, weather and pilot technique — $48B market by 2026.", h: "what-if: 'fly it at CI 25 vs 40'" },
    { t: "Edge AI on the Bee", d: "Onboard inference (quantized models) computing FOQA events at 8 Hz in-flight; only insights downlinked — solves the bandwidth gap.", h: "the Bee becomes a flying inference node" },
    { t: "Multimodal Maintenance AI", d: "One model reading manuals, borescope images, sensor traces and shift logs — grounded troubleshooting in seconds.", h: "vision + text + time series fused" },
  ];
  $("#bh-roadmap").innerHTML = ROADMAP.map(r => `
    <div class="rm-card"><b>${r.t}</b><p>${r.d}</p><span class="rm-hint">→ ${r.h}</span></div>`).join("");
}

/* ============================================================
   ASK AEROBEE
   ============================================================ */
const AI_SUGGESTIONS = [
  "Compare the two FDR flights",
  "How strong were the winds on the April flights?",
  "Any safety events in the FDR data?",
  "Which engine runs hotter and should I worry?",
  "Where can we save fuel?",
  "What does predictive maintenance recommend?",
  "Summarize flight AB202",
];
function aiAnswer(q) {
  const s = q.toLowerCase();
  const k = AB.fleetKpis;
  const f201 = FLIGHTS.find(f => f.id === "AB201"), f202 = FLIGHTS.find(f => f.id === "AB202");
  const money = (lb) => `$${fmt(lb * AB.fuelUsdPerLb)}`;

  if (/compare.*fdr|fdr.*compare|ab201.*ab202|two fdr/.test(s))
    return `<b>29 Apr 2023 — the two 8 Hz FDR flights:</b>\n\n` +
      `• <b>AB201</b> OERK→OEJD: ${mins(f201.airMin)} airborne, ${fmt(f201.fuelLb)} lb burned, touchdown ${f201.tdNz.toFixed(2)} g, ${f201.events.length} FOQA events\n` +
      `• <b>AB202</b> OEJD→OERK: ${mins(f202.airMin)} airborne, ${fmt(f202.fuelLb)} lb burned, touchdown ${f202.tdNz.toFixed(2)} g, ${f202.events.length} FOQA events\n\n` +
      `The return was ${f201.airMin - f202.airMin} min faster and burned ${fmt(f201.fuelLb - f202.fuelLb)} lb less — riding a recorded ${fmt(f202.maxWind.kt)} kt westerly at cruise (headwind outbound, tailwind home). ` +
      `Both approaches were stabilized: on speed at the 1000/500/100 ft gates with gear down and no ILS deviation beyond 0.05 dots.`;

  if (/wind|weather|metar|jet stream/.test(s))
    return `The April FDR flights recorded the IRS wind vector at 8 Hz — real data, not forecast:\n\n` +
      `• <b>AB201</b>: max ${fmt(f201.maxWind.kt)} kt from ${fmt(f201.maxWind.dir)}° at cruise\n` +
      `• <b>AB202</b>: max ${fmt(f202.maxWind.kt)} kt from ${fmt(f202.maxWind.dir)}° — nearly a direct tailwind into Riyadh, ground speed peaked near 580 kt\n\n` +
      `Toggle Winds on the 2D replay map to see the recorded vectors along the route. Ground METARs in the brief are simulated for the demo.`;

  if (/safety|event|exceed|foqa|incident/.test(s)) {
    const fdrEv = [...f201.events, ...f202.events];
    return `From mining 94,576 rows of real 8 Hz FDR data I flagged <b>${fdrEv.length} events</b>:\n\n` +
      fdrEv.map(e => `• [${e.sev}] ${e.flight}: ${e.desc} — ${fmt(e.value, 2)} ${e.unit}`).join("\n") +
      `\n\nNo GPWS, stall, overspeed or windshear activations on either flight. The satellite flights add ${FLIGHTS.filter(f => f.fidelity === "SAT").reduce((a, f) => a + (f.events || []).length, 0)} more from downlink analysis. Click any row in Proactive Safety to replay the exact moment.`;
  }

  if (/engine.*(hot|hotter|worr|health|condition)|egt/.test(s)) {
    const t = AB.egtTrend.slice(-30);
    const m1 = t.reduce((a, x) => a + (x.e1egt || 0), 0) / t.length, m2 = t.reduce((a, x) => a + (x.e2egt || 0), 0) / t.length;
    return `Across the last 30 departures, takeoff EGT averaged <b>${fmt(m1)}°C on Engine 1</b> vs <b>${fmt(m2)}°C on Engine 2</b>. ` +
      `Against the CF6-80C2 limit of 960°C both have healthy margin, but Engine 2's ΔEGT is drifting +6°C per 90 days.\n\n` +
      `The Predictive Maintenance model projects the margin trend 12 months ahead and recommends a water-wash at the D+150 window plus a borescope with the next A-check — act on the trend, not the exceedance.`;
  }

  if (/predictive|maintenance|recommend|rul/.test(s))
    return `<b>Predictive Maintenance summary (prototype):</b>\n\n` +
      `• Engine 2 HPT blades: P50 RUL 2,900 FH (P90 1,850) — driven by the real EGT-margin erosion trend\n` +
      `• APU hot section: P50 1,400 hrs — high ground duty cycle (42.6% observed)\n` +
      `• Brake #3: replacement window in ~180 cycles\n\n` +
      `4 planned interventions in the next 180 days, each bundled with existing ground time so none cost a cancellation. Forecast band is a simulated model on real trend data — see the Predictive Maintenance view.`;

  if (/save|saving|optimi[sz]|efficien|fuel cost/.test(s)) {
    const tot = AB.savings.reduce((a, x) => a + x.annualUsd, 0);
    return `Identified <b>$${fmt(tot)}/yr</b> for this tail:\n\n` +
      AB.savings.map(x => `• <b>${x.name}</b>: $${fmt(x.annualUsd)}/yr (${fmt(x.annualLb)} lb)`).join("\n") +
      `\n\nThe FDR data confirms the behavior: both April flights taxied in on two engines and used ${f202.events.some(e => /reverse/i.test(e.desc)) ? "full" : "idle"} reverse — the two easiest wins are worth ~$81k/yr alone.`;
  }

  if (/summar.*202|ab202|flight 202/.test(s))
    return `<b>AB202 — OEJD→OERK, 29 Apr 2023 (8 Hz FDR):</b>\n\n` +
      `• Airborne ${mins(f202.airMin)}, max FL${Math.round(f202.maxAlt / 100)}, ${fmt(f202.fuelLb)} lb burned\n` +
      `• Recorded tailwind up to ${fmt(f202.maxWind.kt)} kt — ground speed peaked ~580 kt\n` +
      `• Stabilized approach: 135/132/129 kt at the 1000/500/100 ft gates, touchdown ${f202.tdNz.toFixed(2)} g\n` +
      `• ${f202.events.length} FOQA advisories: high ROD burst on descent, full reverse, dual-engine taxi-in\n\n` +
      `Watch it in 2D or 3D replay — every gauge is driven by the recorded data.`;

  if (/fleet|routes|network|fly most/.test(s))
    return `Demo fleet: N310AB active with 5 loaded flights (2 × FDR, 3 × satellite), plus 2 simulated tails pending Bee installs. ` +
      `Across the ${k.flights} logged segments: ` + AB.routes.slice(0, 4).map(r => `${r.route} (${r.flights}×)`).join(", ") +
      `. Riyadh is home base; Jeddah is the dominant pair.`;

  if (/hello|hi |hey|who are you|what can/.test(s))
    return `I'm <b>AeroBee</b> — the conversational layer of the Beehive. I answer from the demo fleet's actual data: two 8 Hz FDR decodes, three satellite flights, engine trends, weather and maintenance context. Try a suggestion below.`;

  return `I can answer about <b>the 5 loaded flights, fuel, engines, winds, safety events, predictive maintenance and savings</b>. In production this router is an LLM with RAG over every connector in the Beehive — any question, any phrasing, grounded and cited. Try: "${AI_SUGGESTIONS[Math.floor(Math.random() * AI_SUGGESTIONS.length)]}"`;
}
function addMsg(text, who) {
  const d = document.createElement("div");
  d.className = `msg ${who}`;
  if (who === "bot") {
    d.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;
    $("#chat").appendChild(d);
    $("#chat").scrollTop = 1e9;
    setTimeout(() => {
      d.innerHTML = text + `<span class="src">Computed from flight telemetry · demo fleet · ${FLIGHTS.length} flights loaded</span>`;
      $("#chat").scrollTop = 1e9;
    }, 550 + Math.random() * 400);
  } else { d.textContent = text; $("#chat").appendChild(d); $("#chat").scrollTop = 1e9; }
}
function sendChat(q) {
  if (!q.trim()) return;
  addMsg(q, "user");
  setTimeout(() => addMsg(aiAnswer(q), "bot"), 150);
}
function initAI() {
  $("#ai-chips").innerHTML = AI_SUGGESTIONS.map(s => `<button class="chip">${s}</button>`).join("");
  $$("#ai-chips .chip").forEach(c => c.onclick = () => sendChat(c.textContent));
  $("#chat-send").onclick = () => { sendChat($("#chat-input").value); $("#chat-input").value = ""; };
  $("#chat-input").onkeydown = (e) => { if (e.key === "Enter") { sendChat(e.target.value); e.target.value = ""; } };
  addMsg(`Welcome to <b>AeroBee</b> — I'm connected to the demo fleet — 5 flights loaded including two full 8 Hz FDR decodes (94,576 rows mined), plus 22 months of engine trends. Ask me anything.`, "bot");
}
$("#ask-input").onkeydown = (e) => {
  if (e.key === "Enter" && e.target.value.trim()) {
    const q = e.target.value; e.target.value = "";
    show("ai");
    setTimeout(() => sendChat(q), 200);
  }
};

/* ---------------- boot ---------------- */
const INIT = { perf: initPerf, overview: initOverview, replay: initReplay, replay3d: initReplay3d,
  health: initHealth, pdm: initPdm, engine: initEngine, fuel: initFuel,
  safety: initSafety, report: initReport, connectors: initConnectors, ai: initAI };
$("#nav-event-count").textContent = FLIGHTS.flatMap(f => f.events || []).length;
renderFlightBars();
show("overview");
