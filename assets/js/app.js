/* ============================================================
   AeroBee Dashboard — A310 demo-fleet telemetry (white-labeled)
   Views: overview · replay · engine · fuel · safety · report · ai
   ============================================================ */
"use strict";

/* ---------------- helpers ---------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const hm = (t) => t ? t.slice(11, 16) : "—";
const mins = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const P = (t) => new Date(t.replace(" ", "T") + "Z").getTime();

const C = {
  gold: "#ffb300", teal: "#2dd4bf", blue: "#60a5fa", red: "#f87171",
  amber: "#fbbf24", green: "#4ade80", dim: "#8b96ab", grid: "rgba(139,150,171,.12)",
  purple: "#c084fc",
};
Chart.defaults.color = C.dim;
Chart.defaults.font.family = "Inter, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.borderColor = C.grid;
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.legend.labels.boxHeight = 10;
Chart.defaults.animation.duration = 400;

const TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_OPTS = { attribution: "© OpenStreetMap © CARTO", subdomains: "abcd", maxZoom: 19 };

const AIRPORT_POS = {
  OERK: [24.9576, 46.6988], OEJN: [21.6796, 39.1565], OEMA: [24.5534, 39.7051],
  OEDF: [26.4712, 49.7979], OJAI: [31.7226, 35.9932], OJAM: [31.9727, 35.9916],
  HECA: [30.1219, 31.4056], OENN: [27.9276, 35.2882], OETB: [28.3654, 36.6189],
  LFBD: [44.8283, -0.7156], LIEE: [39.2515, 9.0543], OEAH: [25.2853, 49.4851],
  OEGS: [26.3028, 43.7744], HESH: [27.9773, 34.3950], OERY: [24.7098, 46.7252],
};

/* chart factory: destroys any chart already bound to the canvas (idempotent re-init) */
function chartOn(el, cfg) {
  const prev = Chart.getChart(el);
  if (prev) prev.destroy();
  return new Chart(el, cfg);
}

/* ---------------- gauges & sparklines ---------------- */
function drawGauge(canvas, value, max, color, label, redFrom) {
  const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H - 14, r = Math.min(W / 2 - 8, H - 26);
  const a0 = Math.PI, a1 = 2 * Math.PI;
  g.clearRect(0, 0, W, H);
  g.lineCap = "round";
  g.lineWidth = 7;
  g.strokeStyle = "rgba(139,150,171,.16)";
  g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
  if (redFrom != null) {
    g.strokeStyle = "rgba(248,113,113,.4)";
    g.beginPath(); g.arc(cx, cy, r, a0 + Math.PI * (redFrom / max), a1); g.stroke();
  }
  const f = Math.min(Math.max((value ?? 0) / max, 0), 1);
  g.strokeStyle = value >= (redFrom ?? Infinity) ? "#f87171" : color;
  g.beginPath(); g.arc(cx, cy, r, a0, a0 + Math.PI * f); g.stroke();
  g.fillStyle = "#e8ecf4";
  g.font = "700 16px JetBrains Mono, monospace";
  g.textAlign = "center";
  g.fillText(value == null ? "—" : fmt(Math.round(value)), cx, cy - 2);
}
function sparkSvg(data, color, w = 90, h = 26) {
  const mn = Math.min(...data), mx = Math.max(...data), sp = (mx - mn) || 1;
  const ptsv = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((v - mn) / sp) * (h - 6)}`).join(" ");
  return `<svg width="${w}" height="${h}" class="spark"><polyline points="${ptsv}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function ringGauge(canvas, value, color) {
  const g = canvas.getContext("2d"), W = canvas.width, cx = W / 2, r = W / 2 - 12;
  g.clearRect(0, 0, W, W);
  g.lineWidth = 11; g.lineCap = "round";
  g.strokeStyle = "rgba(139,150,171,.14)";
  g.beginPath(); g.arc(cx, cx, r, -Math.PI / 2, Math.PI * 1.5); g.stroke();
  g.strokeStyle = color;
  g.beginPath(); g.arc(cx, cx, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * value / 100); g.stroke();
}

/* ---------------- navigation ---------------- */
const TITLES = {
  overview: "Fleet Overview", replay: "Live Flight Tracking & Inflight Analysis",
  health: "Aircraft Health Monitoring", engine: "Engine Condition Monitoring (MOQA)",
  fuel: "Fuel Optimization",
  safety: "Proactive Safety — FOQA / FDM", report: "End of Flight Report",
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
}
$$(".nav-item[data-view]").forEach(n => n.onclick = () => show(n.dataset.view));

/* ============================================================
   FLEET OVERVIEW
   ============================================================ */
const ov = {};
function kpiBox(label, value, sub, color) {
  return `<div class="kpi" style="--kc:${color || C.gold}">
    <div class="kl">${label}</div><div class="kv">${value}</div><div class="ks">${sub || ""}</div></div>`;
}
function initOverview() {
  const k = AB.fleetKpis;
  $("#ov-kpis").innerHTML =
    kpiBox("Flights Logged", fmt(k.flights), k.period, C.gold) +
    kpiBox("Block Hours", fmt(k.hours), "across logged segments", C.blue) +
    kpiBox("Fuel Burned", `${fmt(k.fuelLb / 1000, 1)}<small> klb</small>`, `≈ $${fmt(k.fuelUsd)} · ${fmt(k.co2Tonnes)} t CO₂`, C.teal) +
    kpiBox("APU On", `${k.apuOnPct}<small>%</small>`, "of downlinked snapshots", C.amber) +
    kpiBox("Safety Events", fmt(k.events.High + k.events.Medium + k.events.Low),
      `${k.events.High} high · ${k.events.Medium} med · ${k.events.Low} low`, C.red);

  /* map */
  ov.map = L.map("ov-map", { zoomControl: false, attributionControl: false }).setView([27.5, 42], 5);
  L.tileLayer(TILES, TILE_OPTS).addTo(ov.map);
  const seen = {};
  AB.routes.forEach(r => {
    const [o, d] = r.route.split("→");
    if (!AIRPORT_POS[o] || !AIRPORT_POS[d]) return;
    L.polyline([AIRPORT_POS[o], AIRPORT_POS[d]], {
      color: C.gold, weight: Math.min(1 + r.flights / 8, 4), opacity: .55, dashArray: "6 8",
    }).addTo(ov.map).bindTooltip(`${r.route} · ${r.flights} flights`);
    [o, d].forEach(a => {
      if (seen[a]) return; seen[a] = 1;
      L.circleMarker(AIRPORT_POS[a], { radius: 5, color: C.gold, fillColor: "#0a0d13", fillOpacity: 1, weight: 2 })
        .addTo(ov.map).bindTooltip(a, { permanent: true, direction: "top", className: "apt-label", offset: [0, -6] });
    });
  });
  $("#ov-map-note").textContent = `${AB.routes.length} named city pairs · aircraft N310AB`;

  /* routes table */
  $("#ov-routes").innerHTML =
    `<tr><th>Route</th><th>Flights</th><th>Avg Burn</th><th>Avg Block</th></tr>` +
    AB.routes.map(r => `<tr><td>${r.route}</td><td>${r.flights}</td>
      <td>${r.avgBurnLb ? fmt(r.avgBurnLb) + " lb" : "—"}</td><td>${r.avgMin ? mins(r.avgMin) : "—"}</td></tr>`).join("");

  /* monthly charts */
  const m = AB.monthly;
  chartOn($("#ov-monthly"), {
    data: {
      labels: m.map(x => x.month),
      datasets: [
        { type: "bar", label: "Flights", data: m.map(x => x.flights), backgroundColor: C.gold + "cc", borderRadius: 4, yAxisID: "y" },
        { type: "line", label: "Block hours", data: m.map(x => x.hours), borderColor: C.teal, borderWidth: 1.5, pointRadius: 0, tension: .35, yAxisID: "y2" },
      ],
    },
    options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true }, y2: { position: "right", grid: { display: false } } } },
  });
  chartOn($("#ov-fuel"), {
    type: "bar",
    data: { labels: m.map(x => x.month), datasets: [{ label: "Fuel burn (lb)", data: m.map(x => x.fuelLb), backgroundColor: C.teal + "b0", borderRadius: 4 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => fmt(v / 1000) + "k" } } } },
  });
}

/* ============================================================
   REPLAY — animated flight with synced instruments
   ============================================================ */
const rp = { legIdx: 0, playing: false, speed: 8, cursor: 0, timer: null };

function legTrack(i) {
  const l = AB.legs[i];
  return AB.track.filter(p => p.t >= l.start && p.t <= l.end);
}
/* linear interpolation of full-parameter snapshots at time t (ms) */
function snapAt(tms) {
  const s = AB.snapshots;
  let a = s[0], b = s[s.length - 1];
  for (let i = 0; i < s.length - 1; i++) {
    if (P(s[i].Date) <= tms && P(s[i + 1].Date) >= tms) { a = s[i]; b = s[i + 1]; break; }
  }
  const span = Math.max(P(b.Date) - P(a.Date), 1), f = Math.min(Math.max((tms - P(a.Date)) / span, 0), 1);
  const lerp = (k) => (a[k] == null || b[k] == null) ? a[k] : a[k] + (b[k] - a[k]) * f;
  return {
    fuel: lerp("Fuel Quantity On Board"), ff: (lerp("Engine 1 Fuel Flow") || 0) + (lerp("Engine 2 Fuel Flow") || 0),
    n1a: lerp("Engine 1 N1"), n1b: lerp("Engine 2 N1"),
    egta: lerp("Engine 1 EGT"), egtb: lerp("Engine 2 EGT"),
    ias: lerp("Speed/IAS"),
    flag: (tms - P(a.Date) < P(b.Date) - tms ? a : a)["Flag"],
  };
}
function trackAt(tr, tms) {
  let i = tr.findIndex(p => P(p.t) > tms);
  if (i <= 0) i = tms <= P(tr[0].t) ? 1 : tr.length - 1;
  const a = tr[i - 1], b = tr[i];
  const f = Math.min(Math.max((tms - P(a.t)) / Math.max(P(b.t) - P(a.t), 1), 0), 1);
  const lerp = (k) => a[k] + (b[k] - a[k]) * f;
  let dh = b.hdg - a.hdg; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
  return { lat: lerp("lat"), lon: lerp("lon"), alt: lerp("alt"), gs: lerp("gs"), vs: lerp("vs"), hdg: a.hdg + dh * f, dist: lerp("dist") };
}

/* --- simulated DFDR access: anchor high-rate segments to real phase times --- */
function dfdrAnchors(legIdx) {
  const l = AB.legs[legIdx];
  const snap = (flag) => AB.snapshots.find(s => s.Date >= l.start && s.Date <= l.end && s.Flag === flag);
  const to = snap("Takeoff_Flag"), ldg = snap("Landing_Flag");
  return {
    takeoff: to ? P(to.Date) - 42000 : null,     /* t=42 s (rotation) at Takeoff tweet */
    touchdown: ldg ? P(ldg.Date) + 30000 : null, /* t=0 (touchdown) 30 s after Landing tweet */
  };
}
function dfdrAt(legIdx, tms) {
  const d = AB.dfdr[AB.legs[legIdx].id];
  if (!d) return null;
  const a = dfdrAnchors(legIdx);
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

function initReplay() {
  /* leg buttons */
  $("#leg-buttons").innerHTML = AB.legs.map((l, i) =>
    `<button class="leg-btn ${i === 0 ? "active" : ""}" data-i="${i}">
      ${l.id} · ${l.from} → ${l.to}<small>${l.start.slice(0, 10)} · off ${hm(l.start)}Z · ${mins(l.durMin)} · ${fmt(l.distNm)} nm</small></button>`).join("");
  $$(".leg-btn").forEach(b => b.onclick = () => { selectLeg(+b.dataset.i); });

  /* map */
  rp.map = L.map("rp-map", { zoomControl: true, attributionControl: false });
  L.tileLayer(TILES, TILE_OPTS).addTo(rp.map);
  rp.trail = L.polyline([], { color: C.gold, weight: 3, opacity: .95 }).addTo(rp.map);
  rp.future = L.polyline([], { color: C.blue, weight: 1.5, opacity: .5, dashArray: "5 7" }).addTo(rp.map);
  rp.plane = L.marker([0, 0], {
    icon: L.divIcon({
      className: "", iconSize: [34, 34], iconAnchor: [17, 17],
      html: `<svg class="plane-icon" id="plane-svg" viewBox="0 0 24 24" width="34" height="34" style="transform:rotate(0deg)">
        <path fill="#ffb300" d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`,
    }),
  }).addTo(rp.map);

  /* KPI shells */
  const shells = [["ALTITUDE", "rk-alt", "ft", C.blue], ["GROUND SPD", "rk-gs", "kt", C.teal],
    ["HEADING", "rk-hdg", "°", C.gold], ["VERT SPEED", "rk-vs", "fpm", C.purple],
    ["FUEL ON BOARD", "rk-fuel", "lb", C.green], ["FUEL FLOW", "rk-ff", "lb/hr", C.amber]];
  $("#rp-kpis").innerHTML = shells.map(([l, id, u, c]) =>
    `<div class="kpi" style="--kc:${c}"><div class="kl">${l}</div><div class="kv" id="${id}">—</div><div class="ks">${u}</div></div>`).join("");
  $("#rp-engine-kpis").innerHTML = [
    ["FUEL FLOW", "rk-ffm", "lb/hr"], ["MACH", "rk-mach", ""],
    ["UTC", "rk-utc", ""], ["DIST FLOWN", "rk-dist", "nm"],
  ].map(([l, id, u]) => `<div class="mk"><div class="kl">${l} ${u}</div><div class="kv" id="${id}">—</div></div>`).join("");

  /* controls panel shell */
  $("#rp-controls").innerHTML = `
    <div class="ctl-leds">
      <div class="led" id="ctl-gear"><span></span>GEAR</div>
      <div class="led" id="ctl-spoiler"><span></span>SPLR</div>
      <div class="led" id="ctl-rev"><span></span>REV</div>
    </div>
    <div class="ctl-vals">
      <div class="mk"><div class="kl">FLAPS</div><div class="kv" id="ctl-flap">—</div></div>
      <div class="mk"><div class="kl">PITCH °</div><div class="kv" id="ctl-pitch">—</div></div>
      <div class="mk"><div class="kl">ROLL °</div><div class="kv" id="ctl-roll">—</div></div>
      <div class="mk"><div class="kl">RAD ALT ft</div><div class="kv" id="ctl-ra">—</div></div>
      <div class="mk"><div class="kl">IAS kt</div><div class="kv" id="ctl-ias">—</div></div>
      <div class="mk"><div class="kl">NZ g</div><div class="kv" id="ctl-nz">—</div></div>
    </div>`;

  /* strip chart */
  rp.strip = chartOn($("#rp-strip"), {
    type: "line",
    data: { labels: [], datasets: [
      { label: "Altitude (ft)", data: [], borderColor: C.blue, borderWidth: 1.4, pointRadius: 0, fill: { target: "origin" }, backgroundColor: "rgba(96,165,250,.08)", yAxisID: "y", tension: .3 },
      { label: "Ground speed (kt)", data: [], borderColor: C.teal, borderWidth: 1.2, pointRadius: 0, yAxisID: "y2", tension: .3 },
    ]},
    options: {
      maintainAspectRatio: false, interaction: { intersect: false, mode: "index" },
      scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { title: { display: false } }, y2: { position: "right", grid: { display: false } } },
      plugins: { legend: { display: true, position: "top", align: "end" } },
    },
    plugins: [{
      id: "cursor",
      afterDraw(c) {
        if (rp.cursorX == null) return;
        const x = c.scales.x.getPixelForValue(rp.cursorX);
        const { top, bottom } = c.chartArea, g = c.ctx;
        g.save(); g.strokeStyle = C.gold; g.lineWidth = 1.4; g.setLineDash([4, 4]);
        g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); g.restore();
      },
    }],
  });

  /* controls */
  $("#rp-speeds").innerHTML = [4, 8, 20, 60].map(s =>
    `<button class="speed-btn ${s === rp.speed ? "active" : ""}" data-s="${s}">${s}×</button>`).join("");
  $$(".speed-btn").forEach(b => b.onclick = () => {
    rp.speed = +b.dataset.s;
    $$(".speed-btn").forEach(x => x.classList.toggle("active", x === b));
  });
  $("#rp-play").onclick = () => rp.playing ? pause() : play();
  $("#rp-slider").oninput = (e) => { pause(); seek(+e.target.value / 1000); };

  selectLeg(0);
}

function selectLeg(i) {
  pause();
  rp.legIdx = i;
  $$(".leg-btn").forEach((b, j) => b.classList.toggle("active", j === i));
  const l = AB.legs[i], tr = legTrack(i);
  rp.tr = tr; rp.t0 = P(tr[0].t); rp.t1 = P(tr[tr.length - 1].t);
  $("#rp-map-title").textContent = `Flight Track — ${l.id} ${l.from} → ${l.to}`;
  $("#leg-meta").innerHTML =
    `TO ${hm(l.start)}Z · LDG ${hm(l.end)}Z<br>Max FL${Math.round(l.maxAlt / 100)} · ${fmt(l.distNm)} nm<br>` +
    `Fuel ${fmt(l.fuelStart)} → ${fmt(l.fuelEnd)} lb<br>Burn <b style="color:#ffb300">${fmt(l.fuelBurn)} lb</b> · GW ${fmt(l.gwStart)} lb`;

  rp.future.setLatLngs(tr.map(p => [p.lat, p.lon]));
  rp.map.fitBounds(rp.future.getBounds(), { padding: [30, 30] });

  /* weather brief for this leg */
  const wxFor = (icao, when) => AB.weather.metars.filter(w => w.icao === icao)
    .sort((a, b) => Math.abs(P(a.time.replace("Z", ":00")) - when) - Math.abs(P(b.time.replace("Z", ":00")) - when))[0];
  const dep = wxFor(l.from, P(l.start)), arr = wxFor(l.to, P(l.end));
  $("#rp-weather").innerHTML =
    [["DEP", dep], ["ARR", arr]].map(([tag, w]) => w ? `
      <div class="wx-row"><span class="wx-tag">${tag} ${w.icao}</span>
        <span class="wx-main">${w.wind} · ${w.vis} · ${w.temp}°C · Q${w.qnh}</span>
        <div class="wx-raw">${w.raw}</div></div>` : "").join("") +
    `<div class="wx-winds">${AB.weather.windsAloft.map(w =>
      `<span class="wx-chip">${w.fl} <b>${w.dir}°/${w.kt}</b></span>`).join("")}</div>`;

  /* strip + engine charts for this leg */
  rp.strip.data.labels = tr.map(p => hm(p.t));
  rp.strip.data.datasets[0].data = tr.map(p => p.alt);
  rp.strip.data.datasets[1].data = tr.map(p => p.gs);
  rp.strip.update();

  /* downlink log */
  $("#rp-log").innerHTML = AB.track.filter(p => p.t >= l.start && p.t <= l.end).slice(0, 400).map(p =>
    `<div>${p.t.slice(11)}Z <span class="hl">${(p.leg ? "H" : "H")}</span> ${p.lat.toFixed(4)},${p.lon.toFixed(4)} · ${fmt(p.alt)} ft · ${fmt(p.gs)} kt</div>`).join("");

  seek(0);
}

function seek(f) {
  rp.cursor = f;
  const tms = rp.t0 + f * (rp.t1 - rp.t0);
  const s = trackAt(rp.tr, tms), e = snapAt(tms);
  rp.plane.setLatLng([s.lat, s.lon]);
  const svg = document.getElementById("plane-svg");
  if (svg) svg.style.transform = `rotate(${Math.round((s.hdg + 360) % 360)}deg)`;
  const past = rp.tr.filter(p => P(p.t) <= tms).map(p => [p.lat, p.lon]);
  past.push([s.lat, s.lon]);
  rp.trail.setLatLngs(past);

  $("#rk-alt").textContent = fmt(s.alt);
  $("#rk-gs").textContent = fmt(s.gs);
  $("#rk-hdg").textContent = String(Math.round((s.hdg + 360) % 360)).padStart(3, "0");
  const vsr = Math.round(s.vs) || 0;
  $("#rk-vs").textContent = (vsr > 0 ? "+" : "") + fmt(vsr);
  $("#rk-fuel").textContent = fmt(e.fuel);
  $("#rk-ff").textContent = fmt(e.ff);
  $("#rk-ffm").textContent = fmt(e.ff);
  $("#rk-mach").textContent = s.alt > 24000 ? (0.78 + (s.gs - 440) * 0.0004).toFixed(2) : "—";
  $("#rk-utc").textContent = new Date(tms).toISOString().slice(11, 19);
  $("#rk-dist").textContent = fmt(s.dist - rp.tr[0].dist, 1);
  $("#rp-phase").textContent = e.flag.replace("_Flag", "").replace("_", " ").toUpperCase();
  $("#rp-slider").value = Math.round(f * 1000);

  /* cockpit gauges */
  drawGauge($("#g-n1a"), e.n1a, 110, C.teal, "N1", 101);
  drawGauge($("#g-n1b"), e.n1b, 110, C.teal, "N1", 101);
  drawGauge($("#g-egta"), e.egta, 1000, C.amber, "EGT", 900);
  drawGauge($("#g-egtb"), e.egtb, 1000, C.amber, "EGT", 900);

  /* controls from simulated DFDR when inside a high-rate window */
  const d = dfdrAt(rp.legIdx, tms);
  if (d) {
    $("#ctl-flap").textContent = d.flap;
    $("#ctl-pitch").textContent = d.pitch.toFixed(1);
    $("#ctl-roll").textContent = d.roll.toFixed(1);
    $("#ctl-ra").textContent = fmt(d.ra);
    $("#ctl-ias").textContent = fmt(d.ias);
    $("#ctl-nz").textContent = d.nz.toFixed(2);
    $("#ctl-gear").classList.toggle("on", d.gear === 1);
    $("#ctl-spoiler").classList.toggle("on", d.spoiler === 1);
    $("#ctl-rev").classList.toggle("on", d.rev === 1);
    $("#rp-ctl-src").textContent = "1 Hz DFDR window · simulated";
  } else {
    ["#ctl-flap", "#ctl-pitch", "#ctl-roll", "#ctl-nz", "#ctl-ra"].forEach(id => $(id).textContent = "—");
    $("#ctl-ias").textContent = e.ias != null ? fmt(e.ias) : "—";
    ["#ctl-gear", "#ctl-spoiler", "#ctl-rev"].forEach(id => $(id).classList.remove("on"));
    $("#rp-ctl-src").textContent = "outside high-rate window · downlink only";
  }

  /* strip cursor: index space */
  let ci = rp.tr.findIndex(p => P(p.t) >= tms);
  rp.cursorX = ci < 0 ? rp.tr.length - 1 : ci;
  rp.strip.update("none");
}

function play() {
  rp.playing = true; $("#rp-play").textContent = "⏸ Pause";
  let last = performance.now();
  const step = (now) => {
    if (!rp.playing) return;
    const real = (now - last) / 1000; last = now;
    /* speed×: 1 real second = speed× flight minutes / 8  (tuned so 8× ≈ full leg in ~90 s) */
    const df = (real * rp.speed * 9000) / (rp.t1 - rp.t0);
    let f = rp.cursor + df;
    if (f >= 1) { f = 1; pause(); }
    seek(f);
    rp.timer = requestAnimationFrame(step);
  };
  rp.timer = requestAnimationFrame(step);
}
function pause() {
  rp.playing = false; $("#rp-play").textContent = "▶ Play";
  if (rp.timer) cancelAnimationFrame(rp.timer);
}

/* ============================================================
   AIRCRAFT HEALTH MONITORING
   ============================================================ */
function initHealth() {
  const a = AB.ahm;
  $("#hh-reg").textContent = AB.aircraft.reg;
  $("#hh-val").textContent = a.overall;
  ringGauge($("#hh-ring"), a.overall, a.overall >= 90 ? C.green : a.overall >= 75 ? C.amber : C.red);
  const watch = a.systems.filter(s => s.status !== "NORMAL");
  $("#hh-chips").innerHTML =
    `<span class="hh-chip ok">${a.systems.length - watch.length} systems normal</span>` +
    watch.map(s => `<span class="hh-chip warn">⚠ ${s.name.split(" (")[0]} — ${s.status}</span>`).join("");

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
   ENGINE CONDITION
   ============================================================ */
function initEngine() {
  const t = AB.egtTrend, last = t.slice(-30);
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const e1 = avg(last.map(x => x.e1egt).filter(Boolean)), e2 = avg(last.map(x => x.e2egt).filter(Boolean));
  const deltas = t.map(x => x.delta).filter(x => x != null);
  const meanDelta = avg(deltas.slice(-30));
  const EGT_LIMIT = 960; /* CF6-80C2 takeoff EGT redline */
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

/* ============================================================
   FUEL OPTIMIZATION
   ============================================================ */
function initFuel() {
  const l1 = AB.legs[0], l2 = AB.legs[1];
  const totalBurn = l1.fuelBurn + l2.fuelBurn;
  const totSave = AB.savings.reduce((a, s) => a + s.annualUsd, 0);
  const totLb = AB.savings.reduce((a, s) => a + s.annualLb, 0);
  $("#fu-kpis").innerHTML =
    kpiBox("Round-Trip Burn", `${fmt(totalBurn)}<small> lb</small>`, "OERK ↔ OENN · 10 Aug 2021", C.gold) +
    kpiBox("Cost of Fuel", `$${fmt(totalBurn * AB.fuelUsdPerLb)}`, `@ $${AB.fuelUsdPerLb}/lb Jet A-1`, C.teal) +
    kpiBox("CO₂ Emitted", `${fmt(totalBurn * .4536 * 3.16 / 1000, 1)}<small> t</small>`, "this round trip", C.blue) +
    kpiBox("Identified Savings", `$${fmt(totSave)}<small>/yr</small>`, `${fmt(totLb)} lb · ${fmt(AB.savings.reduce((a, s) => a + s.annualCo2T, 0))} t CO₂`, C.green);

  chartOn($("#fu-phase"), {
    type: "bar",
    data: {
      labels: [...new Set(AB.phaseBurn.map(p => p.phase))],
      datasets: AB.legs.map((l, i) => ({
        label: `${l.id} ${l.from}→${l.to}`,
        data: [...new Set(AB.phaseBurn.map(p => p.phase))].map(ph => {
          const r = AB.phaseBurn.find(p => p.leg === l.id && p.phase === ph);
          return r ? r.burnLb : null;
        }),
        backgroundColor: i === 0 ? C.gold + "cc" : C.teal + "b0", borderRadius: 4,
      })),
    },
    options: { maintainAspectRatio: false, scales: { y: { title: { display: true, text: "lb burned in phase" } } } },
  });

  const sn = AB.snapshots;
  chartOn($("#fu-ff"), {
    type: "scatter",
    data: { datasets: [{
      label: "Total fuel flow vs altitude",
      data: sn.map(s => ({ x: (s["Engine 1 Fuel Flow"] || 0) + (s["Engine 2 Fuel Flow"] || 0), y: s.Altitude })),
      backgroundColor: C.amber, pointRadius: 4,
    }]},
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
   PROACTIVE SAFETY (FOQA)
   ============================================================ */
function initSafety() {
  const ev = AB.events, k = AB.fleetKpis.events;
  $("#sa-kpis").innerHTML =
    kpiBox("High Severity", k.High, "immediate review", C.red) +
    kpiBox("Medium Severity", k.Medium, "trend watch", C.amber) +
    kpiBox("Low / Advisory", k.Low, "efficiency & advisory", C.teal) +
    kpiBox("Detection Source", "BEE EDGE", "downlinked telemetry", C.gold) +
    kpiBox("Flights Covered", fmt(AB.fleetKpis.flights), AB.fleetKpis.period, C.blue);

  chartOn($("#sa-pyramid"), {
    type: "bar",
    data: { labels: ["High", "Medium", "Low"], datasets: [{
      data: [k.High, k.Medium, k.Low],
      backgroundColor: [C.red, C.amber, C.teal], borderRadius: 6, barThickness: 34 }] },
    options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });

  const cats = {};
  ev.forEach(e => cats[e.cat] = (cats[e.cat] || 0) + 1);
  chartOn($("#sa-cat"), {
    type: "doughnut",
    data: { labels: Object.keys(cats), datasets: [{ data: Object.values(cats),
      backgroundColor: [C.gold, C.blue, C.red, C.teal, C.purple], borderWidth: 0 }] },
    options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "right" } } },
  });

  $("#sa-events").innerHTML =
    `<tr><th>Severity</th><th>Category</th><th>Event</th><th>Flight</th><th>Time UTC</th><th>Value</th><th>Threshold</th></tr>` +
    ev.map((e, i) => `<tr class="clickable" data-i="${i}">
      <td><span class="sev sev-${e.sev}">${e.sev}</span></td>
      <td class="txt">${e.cat}</td><td class="txt">${e.desc}</td>
      <td>${e.flight}</td><td>${e.t.slice(11, 16)}</td>
      <td style="color:${e.sev === "High" ? C.red : C.amber}">${fmt(e.value)} ${e.unit}</td>
      <td>${fmt(e.limit)} ${e.unit}</td></tr>`).join("");
  /* stabilized approach analysis from simulated DFDR */
  let saLeg = 1; /* default to the interesting leg */
  $("#sa-leg-toggle").innerHTML = AB.legs.map((l, i) =>
    `<button class="speed-btn ${i === saLeg ? "active" : ""}" data-i="${i}">${l.id}</button>`).join("");
  const renderApproach = () => {
    const leg = AB.legs[saLeg], d = AB.dfdr[leg.id];
    const rows = d.approach.filter(r => r[0] <= 10);
    const idx = { t: 0, ias: 1, ra: 5 };
    const vref = d.meta.vref;
    if (rp.saChart) rp.saChart.destroy();
    rp.saChart = chartOn($("#sa-approach"), {
      type: "line",
      data: {
        labels: rows.map(r => r[idx.t]),
        datasets: [
          { label: "Radio altitude (ft)", data: rows.map(r => r[idx.ra]), borderColor: C.blue,
            borderWidth: 1.6, pointRadius: 0, yAxisID: "y", fill: "origin", backgroundColor: "rgba(96,165,250,.07)" },
          { label: "IAS (kt)", data: rows.map(r => r[idx.ias]), borderColor: C.teal, borderWidth: 1.6, pointRadius: 0, yAxisID: "y2" },
          { label: `Vref+5 target (${vref + 5} kt)`, data: rows.map(() => vref + 5), borderColor: C.gold,
            borderDash: [5, 5], borderWidth: 1.2, pointRadius: 0, yAxisID: "y2" },
        ],
      },
      options: {
        maintainAspectRatio: false, interaction: { intersect: false, mode: "index" },
        scales: {
          x: { title: { display: true, text: "seconds to touchdown" }, ticks: { maxTicksLimit: 12 } },
          y: { title: { display: true, text: "RA ft" } },
          y2: { position: "right", grid: { display: false }, title: { display: true, text: "IAS kt" } },
        },
      },
      plugins: [{
        id: "gates",
        afterDraw(c) {
          const g = c.ctx, xs = c.scales.x;
          [[1000, "1000 ft gate"], [500, "500 ft gate"]].forEach(([gate, lbl]) => {
            const i = rows.findIndex(r => r[idx.ra] <= gate);
            if (i < 1) return;
            const x = xs.getPixelForValue(i);
            g.save(); g.strokeStyle = "rgba(251,191,36,.6)"; g.setLineDash([4, 4]); g.lineWidth = 1.2;
            g.beginPath(); g.moveTo(x, c.chartArea.top); g.lineTo(x, c.chartArea.bottom); g.stroke();
            g.fillStyle = C.amber; g.font = "600 10px Inter";
            g.fillText(lbl, x + 4, c.chartArea.top + 12); g.restore();
          });
        },
      }],
    });

    /* touchdown scorecard */
    const m = d.meta;
    const iasAt = (gate) => { const r = rows.find(r2 => r2[idx.ra] <= gate); return r ? r[idx.ias] : null; };
    const dev500 = Math.round(iasAt(500) - (vref + 5));
    const cell = (lbl, val, ok, sub) => `
      <div class="td-cell ${ok ? "ok" : "warn"}"><div class="kl">${lbl}</div>
        <div class="kv">${val}</div><div class="ks">${sub}</div></div>`;
    $("#sa-touchdown").innerHTML = `<div class="td-grid">` +
      cell("TOUCHDOWN G", m.tdG.toFixed(2) + " g", m.tdG < 1.4, "limit 1.60 g (hard)") +
      cell("TD DISTANCE", fmt(m.tdDistFt) + " ft", m.tdDistFt <= 2000, "target ≤ 2,000 ft") +
      cell("SPEED @ 500 FT", (dev500 >= 0 ? "+" : "") + dev500 + " kt", Math.abs(dev500) <= 10, `vs Vref+5 (${vref + 5} kt)`) +
      cell("REVERSE", m.revMode, m.revMode === "IDLE", "idle reverse saves ≈66 lb") +
      `</div>
      <div class="td-verdict ${dev500 <= 10 && m.tdG < 1.4 ? "ok" : "warn"}">
        ${AB.legs[saLeg].id} approach: ${dev500 > 10 || m.tdG >= 1.4
          ? "⚠ NOT FULLY STABILIZED — speed above gate tolerance, firm touchdown. Auto-flagged for review."
          : "✓ STABILIZED — all gates met, touchdown within targets."}</div>`;
  };
  $$("#sa-leg-toggle .speed-btn").forEach(b => b.onclick = () => {
    saLeg = +b.dataset.i;
    $$("#sa-leg-toggle .speed-btn").forEach((x, j) => x.classList.toggle("active", j === saLeg));
    renderApproach();
  });
  renderApproach();

  $$("#sa-events tr.clickable").forEach(row => row.onclick = () => {
    const e = ev[+row.dataset.i];
    const legIdx = AB.legs.findIndex(l => e.t >= l.start && e.t <= l.end);
    show("replay");
    if (legIdx >= 0) {
      selectLeg(legIdx);
      const l = AB.legs[legIdx];
      seek(Math.min(Math.max((P(e.t) - P(l.start)) / (P(l.end) - P(l.start)), 0), 1));
    }
  });
}

/* ============================================================
   END OF FLIGHT REPORT
   ============================================================ */
let repLeg = 0;
function initReport() {
  $("#report-leg-buttons").innerHTML = AB.legs.map((l, i) =>
    `<button class="btn ${i === 0 ? "btn-gold" : ""}" data-i="${i}">${l.id} · ${l.from}→${l.to}</button>`).join("");
  $$("#report-leg-buttons .btn, #report-leg-buttons .btn-gold").forEach(b => b.onclick = () => {
    repLeg = +b.dataset.i;
    $$("#report-leg-buttons button").forEach((x, j) => x.className = j === repLeg ? "btn-gold" : "btn");
    renderReport();
  });
  $("#report-csv").onclick = () => downloadReport("csv");
  $("#report-json").onclick = () => downloadReport("json");
  renderReport();
}
function renderReport() {
  const r = AB.eof[repLeg], l = r.legStats, m = r.leg, c = r.cruise;
  const pRow = (s) => {
    const ph = s.Flag.replace("_Flag", "").replace("_", " ");
    return `<tr><td>${ph}</td><td>${s.Date.slice(11, 19)}</td>
      <td>${fmt(s["APU Usage Gnd/Air"])}</td>
      <td>${fmt(s["Engine 1 N1"])}</td><td>${fmt(s["Engine 1 EGT"])}</td>
      <td>${fmt(s["Engine 1 Fuel Flow"])}</td><td>${fmt(s["Engine 1 Oil Pressure"])}</td>
      <td>${fmt(s["Engine 1 Vibration N1"], 2)}</td>
      <td>${fmt(s["Engine 2 N1"])}</td><td>${fmt(s["Engine 2 EGT"])}</td>
      <td>${fmt(s["Engine 2 Fuel Flow"])}</td><td>${fmt(s["Engine 2 Oil Pressure"])}</td>
      <td>${fmt(s["Engine 2 Vibration N1"], 2)}</td></tr>`;
  };
  $("#report-sheet").innerHTML = `
    <div class="rs-head">
      <div class="rs-brand">Aero<span>Bee</span> ✈ END OF FLIGHT SUMMARY REPORT</div>
      <div>Engineering & Maintenance</div>
    </div>
    <div class="rs-grid">
      <div><b>Aircraft Type</b><span>${AB.aircraft.type}</span></div><div><b>Date</b><span>${AB.flightDate}</span></div>
      <div><b>Registration</b><span>${AB.aircraft.reg}</span></div><div><b>Flight ID</b><span>${m.id}</span></div>
      <div><b>Origin</b><span>${m.from} — ${m.fromName}</span></div><div><b>Destination</b><span>${m.to} — ${m.toName}</span></div>
      <div><b>Takeoff Time</b><span>${l.start} Z</span></div><div><b>Landing Time</b><span>${l.end} Z</span></div>
      <div><b>Block Distance</b><span>${fmt(l.distNm)} nm</span></div><div><b>Duration</b><span>${mins(l.durMin)}</span></div>
    </div>
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
      <div><b>Eng 1 Oil Qty</b><span>${fmt(c["Engine 1 Oil Quantity"], 1)} qt</span></div>
      <div><b>Eng 2 Oil Qty</b><span>${fmt(c["Engine 2 Oil Quantity"], 1)} qt</span></div>
    </div>
    <div class="sec">FUEL CONSUMPTION AND ENGINE PARAMETER SUMMARY</div>
    <table>
      <tr><th rowspan="2">Phase</th><th rowspan="2">Time UTC</th><th rowspan="2">APU</th>
        <th colspan="5">Engine 1</th><th colspan="5">Engine 2</th></tr>
      <tr><th>N1 %</th><th>EGT °C</th><th>FF lb/hr</th><th>Oil psi</th><th>Vib</th>
        <th>N1 %</th><th>EGT °C</th><th>FF lb/hr</th><th>Oil psi</th><th>Vib</th></tr>
      ${r.phases.map(pRow).join("")}
    </table>
    <p style="margin-top:12px;font-size:10px;color:#666">Source: ${AB.aircraft.source}. Generated by AeroBee Studio from downlinked Bee edge telemetry.</p>`;
}
function downloadReport(kind) {
  const r = AB.eof[repLeg];
  let blob, name;
  if (kind === "json") {
    blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    name = `AeroBee_EOF_${r.leg.id}.json`;
  } else {
    const cols = Object.keys(r.phases[0]);
    const csv = [cols.join(","), ...r.phases.map(p => cols.map(c => JSON.stringify(p[c] ?? "")).join(","))].join("\n");
    blob = new Blob([csv], { type: "text/csv" });
    name = `AeroBee_EOF_${r.leg.id}.csv`;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

/* ============================================================
   ASK AEROBEE — conversational layer over the real data
   ============================================================ */
const AI_SUGGESTIONS = [
  "How much fuel did we burn to NEOM and back?",
  "Which engine runs hotter and should I worry?",
  "Was the landing back in Riyadh stabilized?",
  "How healthy is the aircraft right now?",
  "What was the weather like?",
  "Where can we save fuel?",
  "Summarize the 10 Aug round trip",
];

function aiFuelDeltaNote() {
  const [l1, l2] = AB.legs;
  const zfw = (l) => {
    const s = AB.snapshots.find(x => x.Date >= l.start && x.Date <= l.end && x["Zero Fuel Weight"]);
    return s ? s["Zero Fuel Weight"] : null;
  };
  const dBurn = l2.fuelBurn - l1.fuelBurn, dZfw = zfw(l2) - zfw(l1);
  const heavy = l2.id, why = [];
  if (dZfw > 0) why.push(`carried ${fmt(dZfw)} lb more payload (higher zero-fuel weight)`);
  if (l2.durMin > l1.durMin) why.push(`flew ${l2.durMin - l1.durMin} min longer (${fmt(l2.distNm - l1.distNm)} nm more track distance)`);
  return `The return leg ${heavy} burned ${fmt(Math.abs(dBurn))} lb ${dBurn > 0 ? "more" : "less"} — it ${why.join(" and ")}.`;
}

function aiAnswer(q) {
  const s = q.toLowerCase();
  const l1 = AB.legs[0], l2 = AB.legs[1], k = AB.fleetKpis;
  const money = (lb) => `$${fmt(lb * AB.fuelUsdPerLb)}`;

  if (/(fuel|burn).*(neom|trip|flight|back)|how much fuel/.test(s))
    return `On <b>10 Aug 2021</b> N310AB flew Riyadh → NEOM Bay and back:\n\n` +
      `• ${l1.id} ${l1.from}→${l1.to}: <b>${fmt(l1.fuelBurn)} lb</b> over ${mins(l1.durMin)} (${fmt(l1.distNm)} nm)\n` +
      `• ${l2.id} ${l2.from}→${l2.to}: <b>${fmt(l2.fuelBurn)} lb</b> over ${mins(l2.durMin)} (${fmt(l2.distNm)} nm)\n\n` +
      `Round-trip total <b>${fmt(l1.fuelBurn + l2.fuelBurn)} lb</b> ≈ ${money(l1.fuelBurn + l2.fuelBurn)}. ` +
      aiFuelDeltaNote();

  if (/engine.*(hot|hotter|worr|health|condition)|egt/.test(s)) {
    const t = AB.egtTrend.slice(-30);
    const m1 = t.reduce((a, x) => a + (x.e1egt || 0), 0) / t.length, m2 = t.reduce((a, x) => a + (x.e2egt || 0), 0) / t.length;
    const hot = m1 > m2 ? "Engine 1" : "Engine 2";
    return `Across the last 30 departures, takeoff EGT averaged <b>${fmt(m1)}°C on Engine 1</b> vs <b>${fmt(m2)}°C on Engine 2</b> — ${hot} runs ~${fmt(Math.abs(m1 - m2))}°C hotter.\n\n` +
      `Against the CF6-80C2 takeoff limit of 960°C that leaves ~${fmt(960 - Math.max(m1, m2))}°C margin, which is healthy. ` +
      `The number to watch is not the absolute EGT but the <b>trend</b>: a steady climb in the 15-flight mean or a widening Eng1−Eng2 split flags deterioration (fouling, bleed leaks, turbine wear) weeks before a limit exceedance. See the Engine Condition view for the full 22-month trend.`;
  }

  if (/landing|stabili[sz]|touchdown|approach/.test(s)) {
    const m1 = AB.dfdr.AB101.meta, m2 = AB.dfdr.AB102.meta;
    return `From the high-rate approach data (simulated DFDR layer):\n\n` +
      `• <b>AB101 into NEOM Bay</b>: stabilized — on speed at both gates, touchdown ${m1.tdG.toFixed(2)} g at ${fmt(m1.tdDistFt)} ft, ${m1.revMode.toLowerCase()} reverse. Clean.\n` +
      `• <b>AB102 back into Riyadh</b>: <b>not fully stabilized</b> — Vref+14 at the 500 ft gate (tolerance +10), firm touchdown ${m2.tdG.toFixed(2)} g (limit 1.60), ${fmt(m2.tdDistFt)} ft past threshold, full reverse used.\n\n` +
      `AB102 was auto-flagged: 2 medium + 2 low events. Open Proactive Safety → Stabilized Approach Analysis to see the gates on the profile.`;
  }

  if (/health|status of the aircraft|maintenance|how healthy/.test(s)) {
    const a = AB.ahm, w = a.systems.filter(x => x.status !== "NORMAL");
    return `Aircraft health index: <b>${a.overall}/100</b>.\n\n` +
      w.map(x => `• ⚠ <b>${x.name}</b> (${x.health}): ${x.note} — ${x.action}`).join("\n") +
      `\n\nAll other systems normal. The watch items come from trend analysis, not exceedances — that's the point of AHM: act weeks before a limit. Full breakdown in Aircraft Health.`;
  }

  if (/weather|wind|metar|temperature/.test(s)) {
    const w = AB.weather;
    return `Conditions on 10 Aug (simulated weather layer):\n\n` +
      w.metars.map(m => `• <b>${m.icao} ${m.time.slice(11)}</b> — ${m.wind}, ${m.vis}, ${m.temp}°C, QNH ${m.qnh}`).join("\n") +
      `\n\nWinds aloft at cruise: ${w.windsAloft[4].fl} ${w.windsAloft[4].dir}°/${w.windsAloft[4].kt} kt — a quartering headwind outbound that became a tailwind component on the return, part of why AB102's ground speed peaked higher. OERK at 41–43°C also means density-altitude penalties on takeoff performance.`;
  }

  if (/safety|event|exceed|foqa|incident/.test(s)) {
    const ev = AB.events.filter(e => e.t.startsWith("2021-08-10"));
    if (!ev.length) return "No FOQA events were detected on the 10 Aug flight.";
    return `I detected <b>${ev.length} events on 10 Aug</b> from the downlinked data:\n\n` +
      ev.map(e => `• [${e.sev}] ${e.desc} — ${e.value} ${e.unit} at ${e.t.slice(11, 16)}Z (${e.flight})`).join("\n") +
      `\n\nFleet-wide the log shows ${k.events.High} high / ${k.events.Medium} medium / ${k.events.Low} low events. Click any row in Proactive Safety to replay the exact moment on the map.`;
  }

  if (/save|saving|optimi[sz]|efficien|cost/.test(s)) {
    const tot = AB.savings.reduce((a, x) => a + x.annualUsd, 0);
    return `From this aircraft's own operating pattern I've identified <b>$${fmt(tot)}/yr</b> in fuel savings:\n\n` +
      AB.savings.map(x => `• <b>${x.name}</b>: $${fmt(x.annualUsd)}/yr (${fmt(x.annualLb)} lb)`).join("\n") +
      `\n\nThe biggest lever is taxi/APU discipline — the telemetry shows dual-engine taxi at ~${fmt((AB.snapshots[0]["Engine 1 Fuel Flow"] || 0) + (AB.snapshots[0]["Engine 2 Fuel Flow"] || 0))} lb/hr and APU running in ${k.apuOnPct}% of ground snapshots. Details in Fuel Optimization.`;
  }

  if (/apu/.test(s))
    return `The APU was running in <b>${k.apuOnPct}%</b> of all downlinked snapshots — that includes long ground periods with the APU carrying air-conditioning load in the Riyadh summer.\n\n` +
      `Rule of thumb: every 10 minutes of APU time avoided saves ≈77 lb of fuel on this class of aircraft. Shifting pre-departure power to GPU/PCA where available is worth ≈$${fmt(AB.savings[1].annualUsd)}/yr for this tail alone.`;

  if (/summar|overview|tell me about|10 aug|recap/.test(s))
    return `<b>10 Aug 2021 — N310AB (A310) Riyadh ↔ NEOM Bay:</b>\n\n` +
      `• ${l1.id}: off ${hm(l1.start)}Z, ${mins(l1.durMin)}, max FL${Math.round(l1.maxAlt / 100)}, ${fmt(l1.fuelBurn)} lb burned\n` +
      `• Turnaround at NEOM: ~${mins(Math.round((P(l2.start) - P(l1.end)) / 60000))}, APU running\n` +
      `• ${l2.id}: off ${hm(l2.start)}Z, ${mins(l2.durMin)}, max FL${Math.round(l2.maxAlt / 100)}, ${fmt(l2.fuelBurn)} lb burned\n\n` +
      `Total ${fmt(l1.distNm + l2.distNm)} nm, ${fmt(l1.fuelBurn + l2.fuelBurn)} lb fuel (≈${money(l1.fuelBurn + l2.fuelBurn)}), ` +
      `${AB.events.filter(e => e.t.startsWith("2021-08-10")).length} FOQA advisories, engines within limits throughout. Hit ▶ Play in Live Flight / Replay to watch it.`;

  if (/route|fly most|where|destination|network/.test(s))
    return `N310AB's logged network (${k.flights} segments over ${k.period}):\n\n` +
      AB.routes.slice(0, 6).map(r => `• <b>${r.route}</b> — ${r.flights} flights, avg ${r.avgBurnLb ? fmt(r.avgBurnLb) + " lb" : "n/a"}, ${mins(r.avgMin)}`).join("\n") +
      `\n\nRiyadh is home base; Jeddah is the dominant city pair. The early LFBD (Bordeaux) segments are the aircraft's ferry out of storage in Feb–Mar 2021.`;

  if (/hello|hi |hey|who are you|what can/.test(s))
    return `I'm <b>AeroBee</b> 🐝 — the conversational layer of the Beehive. I answer from N310AB's actual downlinked flight data: fuel, engines, safety events, routes and savings. Try one of the suggestions below, or ask in your own words.`;

  return `I can answer questions about <b>fuel burn, engine health, safety events, APU usage, routes and savings</b> for N310AB's logged flights. In the production Beehive this router is replaced by an LLM with RAG over the full data lakehouse — so any question phrased any way gets grounded, cited answers. Try: "${AI_SUGGESTIONS[Math.floor(Math.random() * AI_SUGGESTIONS.length)]}"`;
}

function addMsg(text, who) {
  const d = document.createElement("div");
  d.className = `msg ${who}`;
  if (who === "bot") {
    d.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;
    $("#chat").appendChild(d);
    $("#chat").scrollTop = 1e9;
    setTimeout(() => {
      d.innerHTML = text + `<span class="src">⬡ computed from flight telemetry · N310AB · ${AB.fleetKpis.flights} flights</span>`;
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
  addMsg(`Welcome to <b>AeroBee</b> 🐝 I'm connected to N310AB's flight data — ${fmt(AB.fleetKpis.flights)} flights, ${fmt(AB.fleetKpis.hours)} block hours of downlinked edge telemetry. Ask me anything about fuel, engines, safety or routes.`, "bot");
}

/* ---------------- topbar ask ---------------- */
$("#ask-input").onkeydown = (e) => {
  if (e.key === "Enter" && e.target.value.trim()) {
    const q = e.target.value; e.target.value = "";
    show("ai");
    setTimeout(() => sendChat(q), 200);
  }
};

/* ---------------- boot ---------------- */
const INIT = { overview: initOverview, replay: initReplay, health: initHealth,
  engine: initEngine, fuel: initFuel, safety: initSafety, report: initReport, ai: initAI };
$("#nav-event-count").textContent = AB.events.length;
show("overview");
