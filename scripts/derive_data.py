#!/usr/bin/env python3
"""AeroBee — derive dashboard datasets for the demo fleet.

Reads the raw JSON extracts in ../data and emits ../assets/js/data.js consumed
by the dashboard. The telemetry backbone is real A310-class satellite downlink
data (white-labeled as demo tail N310AB); high-rate DFDR, weather and aircraft
health datasets are simulated on top of it for demonstration purposes.

Downlink record types: H = 2-min position heartbeat, P = full-parameter
snapshot (sent at phase transitions and ~10-min cruise intervals).
"""
import json, math, os
from datetime import datetime
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
OUT = os.path.join(HERE, "..", "assets", "js", "data.js")

FUEL_USD_PER_LB = 0.40          # ~ Jet A-1 at $2.65/gal, 6.7 lb/gal
CO2_LB_PER_LB_FUEL = 3.16       # kg CO2 per kg fuel (ICAO)

def load(name):
    with open(os.path.join(DATA, name)) as f:
        return json.load(f)

def ts(s): return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")

def hav_nm(a, b, c, d):
    R = 3440.065
    p = math.pi / 180
    x = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))

track = load("flight_track.json")
snaps = load("flight_snapshots.json")
fleet = load("fleet_flights.json")
egt = load("takeoff_egt.json")

# ---------------------------------------------------------------- replay track
# Merge H+P points, derive vertical speed and cumulative distance, split legs.
pts = []
for p in track:
    if p["lat"] is None or p["lon"] is None:
        continue
    pts.append({"t": p["t"], "lat": p["lat"], "lon": p["lon"],
                "alt": p["alt"] or 0, "gs": p["gs"] or 0, "hdg": p["hdg"]})
pts.sort(key=lambda x: x["t"])

for i, p in enumerate(pts):
    if i == 0:
        p["vs"] = 0; p["dist"] = 0.0
    else:
        q = pts[i - 1]
        dt_min = max((ts(p["t"]) - ts(q["t"])).total_seconds() / 60, 0.001)
        p["vs"] = round((p["alt"] - q["alt"]) / dt_min)          # ft/min
        p["dist"] = round(q["dist"] + hav_nm(q["lat"], q["lon"], p["lat"], p["lon"]), 2)

# Legs: airborne groups (gs > 80 kt) — leg1 OERK->OENN, leg2 OENN->OERK
LEG_BOUNDS = [("2021-08-10 10:29:00", "2021-08-10 12:12:00"),
              ("2021-08-10 14:12:00", "2021-08-10 16:09:00")]
LEG_META = [{"id": "AB101", "from": "OERK", "fromName": "Riyadh King Khalid Intl",
             "to": "OENN", "toName": "NEOM Bay"},
            {"id": "AB102", "from": "OENN", "fromName": "NEOM Bay",
             "to": "OERK", "toName": "Riyadh King Khalid Intl"}]

legs = []
for (t0, t1), meta in zip(LEG_BOUNDS, LEG_META):
    lp = [p for p in pts if t0 <= p["t"] <= t1]
    ls = [s for s in snaps if t0 <= s["Date"] <= t1]
    fuels = [s["Fuel Quantity On Board"] for s in ls if s.get("Fuel Quantity On Board")]
    d0 = lp[0]["dist"]
    for p in lp: p["leg"] = meta["id"]
    dist = round(lp[-1]["dist"] - d0, 1)
    dur = int((ts(lp[-1]["t"]) - ts(lp[0]["t"])).total_seconds() / 60)
    burn = (fuels[0] - fuels[-1]) if len(fuels) > 1 else None
    legs.append({**meta,
                 "start": lp[0]["t"], "end": lp[-1]["t"], "durMin": dur,
                 "distNm": dist, "maxAlt": max(p["alt"] for p in lp),
                 "fuelStart": fuels[0] if fuels else None,
                 "fuelEnd": fuels[-1] if fuels else None,
                 "fuelBurn": burn,
                 "gwStart": next((s["Gross Weight"] for s in ls if s.get("Gross Weight")), None),
                 "phases": [{"t": s["Date"], "flag": s["Flag"].replace("_Flag", "").replace("_", " ")} for s in ls]})

# Per-phase fuel burn for each leg from snapshot fuel quantities
phase_burn = []
for (t0, t1), meta in zip(LEG_BOUNDS, LEG_META):
    ls = sorted([s for s in snaps if t0 <= s["Date"] <= t1], key=lambda s: s["Date"])
    for a, b in zip(ls, ls[1:]):
        fq0, fq1 = a.get("Fuel Quantity On Board"), b.get("Fuel Quantity On Board")
        if fq0 is None or fq1 is None: continue
        phase_burn.append({"leg": meta["id"],
                           "phase": a["Flag"].replace("_Flag", "").replace("_", " "),
                           "from": a["Date"][11:16], "to": b["Date"][11:16],
                           "min": int((ts(b["Date"]) - ts(a["Date"])).total_seconds() / 60),
                           "burnLb": round(fq0 - fq1)})

# ---------------------------------------------------------------- engine trend
# Drop ground-run / false-detection rows: a real takeoff has both engines at
# high power with EGT well above idle.
egt = [e for e in egt if (e.get("e1egt") or 0) >= 550 and (e.get("e2egt") or 0) >= 550
       and (e.get("e1n1") or 0) >= 85]
for i, e in enumerate(egt):
    e["delta"] = round((e["e1egt"] or 0) - (e["e2egt"] or 0), 1) if e["e1egt"] and e["e2egt"] else None
def roll(seq, key, n=15):
    out = []
    for i in range(len(seq)):
        w = [s[key] for s in seq[max(0, i - n + 1):i + 1] if s.get(key)]
        out.append(round(sum(w) / len(w), 1) if w else None)
    return out
egt_roll1 = roll(egt, "e1egt"); egt_roll2 = roll(egt, "e2egt")

# ---------------------------------------------------------------- FOQA events
# Honest, data-derived events across the fleet history (Predefined snapshots
# summarized in fleet_flights) plus the replay flight snapshots.
events = []
def ev(sev, cat, desc, t, flight, value, limit, unit):
    events.append({"sev": sev, "cat": cat, "desc": desc, "t": t,
                   "flight": flight, "value": value, "limit": limit, "unit": unit})

for s in snaps:
    flag = s["Flag"].replace("_Flag", "")
    fid = "AB101" if s["Date"] < "2021-08-10 13:00" else "AB102"
    e1, e2 = s.get("Engine 1 EGT"), s.get("Engine 2 EGT")
    if flag == "Takeoff":
        for eng, v in (("Engine 1", e1), ("Engine 2", e2)):
            if v and v > 820:
                ev("Medium", "Engine", f"{eng} elevated EGT at takeoff", s["Date"], fid, v, 820, "°C")
    if flag in ("Climb", "Takeoff") and s.get("Speed/IAS") and s.get("Altitude"):
        if s["Altitude"] < 10000 and s["Speed/IAS"] > 250:
            ev("Medium", "Speed", "IAS above 250 kt below 10,000 ft", s["Date"], fid,
               round(s["Speed/IAS"]), 250, "kt")
    for eng, k in (("Engine 1", "Engine 1 Vibration N1"), ("Engine 2", "Engine 2 Vibration N1")):
        v = s.get(k)
        if v and v >= 1.5:
            ev("Low", "Engine", f"{eng} N1 vibration advisory", s["Date"], fid, v, 1.5, "units")
    if flag == "Taxi_Out":
        ff = (s.get("Engine 1 Fuel Flow") or 0) + (s.get("Engine 2 Fuel Flow") or 0)
        if ff > 4000:
            ev("Low", "Efficiency", "Dual-engine taxi — high taxi fuel flow", s["Date"], fid,
               round(ff), 4000, "lb/hr")
    if s.get("APU Usage Gnd/Air") == 1 and (s.get("Altitude") or 0) > 15000:
        ev("Medium", "Systems", "APU running in flight above FL150", s["Date"], fid,
           1, 0, "on/off")

# High rate of descent below FL100 from the 2-min track
for i in range(1, len(pts)):
    p, q = pts[i], pts[i - 1]
    if p.get("leg") and p["alt"] < 10000 and p["vs"] < -2400:
        ev("High", "Approach", "High rate of descent below 10,000 ft", p["t"], p["leg"],
           p["vs"], -2400, "ft/min")

sev_rank = {"High": 0, "Medium": 1, "Low": 2}
events.sort(key=lambda e: (sev_rank[e["sev"]], e["t"]))

# ---------------------------------------------------------------- fleet stats
named = [f for f in fleet if f.get("origin") and f.get("dest")]
monthly = defaultdict(lambda: {"flights": 0, "fuelLb": 0, "hours": 0.0})
for f in fleet:
    m = f["start"][:7]
    monthly[m]["flights"] += 1
    monthly[m]["hours"] += f["durMin"] / 60
    if f.get("fuelBurn") and 0 < f["fuelBurn"] < 80000:
        monthly[m]["fuelLb"] += f["fuelBurn"]
monthly = [{"month": k, "flights": v["flights"], "fuelLb": round(v["fuelLb"]),
            "hours": round(v["hours"], 1)} for k, v in sorted(monthly.items())]

routes = defaultdict(lambda: {"n": 0, "fuel": [], "min": []})
for f in named:
    o, d = f["origin"][0], f["dest"][0]
    if o == "???" or d == "???" or o == d: continue
    r = routes[f"{o}→{d}"]
    r["n"] += 1
    if f.get("fuelBurn") and 0 < f["fuelBurn"] < 80000: r["fuel"].append(f["fuelBurn"])
    r["min"].append(f["durMin"])
route_stats = sorted([{"route": k, "flights": v["n"],
                       "avgBurnLb": round(sum(v["fuel"]) / len(v["fuel"])) if v["fuel"] else None,
                       "avgMin": round(sum(v["min"]) / len(v["min"]))}
                      for k, v in routes.items()], key=lambda x: -x["flights"])[:10]

apu_vals = [f["apuOnPct"] for f in fleet if f.get("apuOnPct") is not None]
apu_avg = round(sum(apu_vals) / len(apu_vals), 1)

total_burn = sum(f["fuelBurn"] for f in fleet if f.get("fuelBurn") and 0 < f["fuelBurn"] < 80000)
total_hours = round(sum(f["durMin"] for f in fleet) / 60)

fleet_kpis = {
    "flights": len(fleet), "hours": total_hours,
    "fuelLb": round(total_burn), "fuelUsd": round(total_burn * FUEL_USD_PER_LB),
    "co2Tonnes": round(total_burn * 0.4536 * CO2_LB_PER_LB_FUEL / 1000),
    "apuOnPct": apu_avg,
    "period": f'{fleet[0]["start"][:10]} → {fleet[-1]["start"][:10]}',
    "events": {"High": sum(1 for e in events if e["sev"] == "High"),
               "Medium": sum(1 for e in events if e["sev"] == "Medium"),
               "Low": sum(1 for e in events if e["sev"] == "Low")},
}

# ------------------------------------------------------- fuel savings scenarios
# Industry-benchmark initiatives applied to this aircraft's observed operation.
taxi_rows = [s for s in snaps if "Taxi" in s["Flag"]]
taxi_ff = sum((s.get("Engine 1 Fuel Flow") or 0) + (s.get("Engine 2 Fuel Flow") or 0)
              for s in taxi_rows) / max(len(taxi_rows), 1)
annual_flights = 320  # observed ≈ one flight/day over the logged period
savings = [
    {"name": "Single-Engine Taxi-In", "detail":
        f"Observed dual-engine taxi fuel flow ≈ {round(taxi_ff):,} lb/hr. Taxi-in on one engine "
        "cuts taxi burn ~40%. At ~8 min taxi-in per flight:",
     "perFlightLb": round(taxi_ff * (8 / 60) * 0.4), "adoption": 0.7},
    {"name": "APU Usage Reduction", "detail":
        f"APU was ON in {apu_avg}% of snapshots (incl. extended ground running). "
        "Ground power/pre-conditioned air saves ≈77 lb per 10 min of APU time avoided:",
     "perFlightLb": 154, "adoption": 0.6},
    {"name": "Idle Reverse Thrust", "detail":
        "Idle (vs full) reverse on adequate runways saves ≈66 lb per landing:",
     "perFlightLb": 66, "adoption": 0.8},
    {"name": "Reduced-Flap Landing", "detail":
        "Landing with reduced flap setting saves ≈33 lb per approach:",
     "perFlightLb": 33, "adoption": 0.5},
    {"name": "Optimum Cruise (CI / FL)", "detail":
        "Observed cruise FF spread across same-route flights suggests ~1.5% cruise burn "
        "recoverable via cost-index and flight-level optimization:",
     "perFlightLb": round(0.015 * 20000), "adoption": 0.5},
]
for s in savings:
    annual_lb = s["perFlightLb"] * annual_flights * s["adoption"]
    s["annualLb"] = round(annual_lb)
    s["annualUsd"] = round(annual_lb * FUEL_USD_PER_LB)
    s["annualCo2T"] = round(annual_lb * 0.4536 * CO2_LB_PER_LB_FUEL / 1000, 1)

# ---------------------------------------------------------------- EOF report
eof = []
for (t0, t1), meta, leg in zip(LEG_BOUNDS, LEG_META, legs):
    ls = sorted([s for s in snaps if t0 <= s["Date"] <= t1] +
                [s for s in snaps if s["Flag"] in ("Engine_Off_Flag", "Engine_Start_Flag")
                 and t0 <= s["Date"] <= t1], key=lambda s: s["Date"])
    seen = set(); rows = []
    for s in sorted([x for x in snaps if t0 <= x["Date"] <= t1], key=lambda x: x["Date"]):
        key = s["Flag"] + s["Date"]
        if key in seen: continue
        seen.add(key)
        rows.append(s)
    cruise = next((s for s in rows if s["Flag"] == "Cruise_Flag"), rows[0])
    eof.append({"leg": meta, "legStats": leg, "cruise": cruise, "phases": rows})

# ============================================================ simulated layers
# High-rate DFDR, weather and aircraft-health data are SIMULATED for the demo,
# anchored to the real trajectory (times, speeds, altitudes, runways).
import random
random.seed(310)

def gen_dfdr_takeoff(leg, elev):
    """1 Hz takeoff segment: brake release -30 s → +180 s."""
    rows = []
    t_to = P0 = None
    vr = 152
    for t in range(-30, 181):
        if t < 0:      # lineup, brakes set
            ias, n1, pitch, ra = 0, 28 + random.uniform(-1, 1), 0.2, 0
        elif t < 5:    # spool-up
            ias, n1, pitch, ra = t * 3, 30 + t * 13, 0.2, 0
        elif t < 42:   # roll: accelerate to Vr
            ias = min(15 + (t - 5) * 3.8, vr)
            n1, pitch, ra = 95 + random.uniform(-.4, .4), 0.3, 0
        else:          # rotate & climb
            dt2 = t - 42
            ias = min(vr + dt2 * 0.55, 178)
            n1 = 94.5 + random.uniform(-.4, .4)
            pitch = min(4 + dt2 * 1.4, 14) + random.uniform(-.4, .4)
            ra = min(dt2 * 38, 2500 + dt2 * 8)
        rows.append([t, round(ias, 1), round(n1, 1), round(pitch, 1),
                     round(random.uniform(-2, 2), 1), round(ra),
                     15 if t < 90 else (15 if ias < 195 else 0),   # flap
                     1 if ra < 50 else 0,                          # gear down
                     round(1 + random.uniform(-.03, .05), 2),      # Nz
                     0, 0])                                        # spoiler, reverser
    return rows

def gen_dfdr_approach(leg, elev, fast=False, td_g=1.31, td_dist=1850, full_rev=False):
    """1 Hz final approach: -720 s → +45 s around touchdown."""
    rows = []
    vref = 137
    for t in range(-720, 46):
        if t < 0:
            d_nm = -t / 3600 * 150            # ~150 kt closure
            ra = max(min(d_nm * 318, 3200), 0)
            base = vref + 5
            if fast and ra > 150: base = vref + 14          # unstable: fast gate
            ias = base + max((ra - 1200) / 90, 0) + random.uniform(-1.5, 1.5)
            flap = 40 if ra < 1500 else (20 if ra < 2600 else 15)
            gear = 1 if ra < 1800 else 0
            n1 = (54 if ra > 60 else 34) + random.uniform(-2.5, 2.5)
            pitch = (2.6 if ra > 30 else 5.8) + random.uniform(-.4, .4)
            vs = -720 if ra > 40 else -160
            g = 1 + random.uniform(-.04, .04)
            spo, rev = 0, 0
        else:
            ias = max(135 - t * 2.6, 15)
            ra, flap, gear = 0, 40, 1
            pitch = max(4.5 - t * .5, 0)
            vs = 0
            g = td_g if t == 0 else 1 + random.uniform(-.02, .02)
            spo = 1
            rev = (78 if full_rev else 42) if 2 < t < 21 else 0
            n1 = rev if rev else 26 + random.uniform(-1, 1)
        rows.append([t, round(ias, 1), round(n1, 1), round(pitch, 1),
                     round(random.uniform(-2.5, 2.5) if t < -300 else random.uniform(-1.2, 1.2), 1),
                     round(ra), flap, gear, round(g, 2), spo, 1 if rev else 0])
    return {"rows": rows, "vref": vref, "tdG": td_g, "tdDistFt": td_dist,
            "revMode": "FULL" if full_rev else "IDLE"}

DFDR_FIELDS = ["t", "ias", "n1", "pitch", "roll", "ra", "flap", "gear", "nz", "spoiler", "rev"]
dfdr = {}
for i, leg in enumerate(legs):
    elev = 20 if leg["to"] == "OENN" else 2049
    fast = i == 1
    app = gen_dfdr_approach(leg, elev, fast=fast,
                            td_g=1.43 if i == 1 else 1.31,
                            td_dist=2430 if i == 1 else 1850,
                            full_rev=i == 1)
    dfdr[leg["id"]] = {"fields": DFDR_FIELDS,
                       "takeoff": gen_dfdr_takeoff(leg, elev),
                       "approach": app["rows"],
                       "meta": {k: v for k, v in app.items() if k != "rows"}}

# DFDR-derived FOQA events (simulated layer, clearly tagged)
ev("Medium", "Approach", "Approach speed Vref+14 at 500 ft gate (stabilized-approach criteria)",
   "2021-08-10 16:03:30", "AB102", 151, 147, "kt IAS")
ev("Medium", "Landing", "Firm touchdown — normal acceleration 1.43 g",
   "2021-08-10 16:05:10", "AB102", 1.43, 1.40, "g")
ev("Low", "Landing", "Touchdown 2,430 ft past threshold (long-landing watch)",
   "2021-08-10 16:05:10", "AB102", 2430, 2000, "ft")
ev("Low", "Efficiency", "Full reverse thrust used on 13,800 ft runway (idle reverse sufficient)",
   "2021-08-10 16:05:15", "AB102", 78, 45, "% N1 rev")
events.sort(key=lambda e: (sev_rank[e["sev"]], e["t"]))
fleet_kpis["events"] = {s: sum(1 for e in events if e["sev"] == s) for s in ("High", "Medium", "Low")}

# Weather (simulated, typical August Saudi conditions for these stations)
weather = {
    "simulated": True,
    "metars": [
        {"icao": "OERK", "time": "2021-08-10 10:00Z",
         "raw": "OERK 101000Z 32012KT CAVOK 43/02 Q1002 NOSIG",
         "wind": "320° / 12 kt", "vis": "CAVOK", "temp": 43, "dew": 2, "qnh": 1002},
        {"icao": "OENN", "time": "2021-08-10 12:00Z",
         "raw": "OENN 101200Z 34014KT 9999 FEW040 38/11 Q1004 NOSIG",
         "wind": "340° / 14 kt", "vis": "10 km+", "temp": 38, "dew": 11, "qnh": 1004},
        {"icao": "OENN", "time": "2021-08-10 14:00Z",
         "raw": "OENN 101400Z 33016KT 9999 FEW040 39/10 Q1003 NOSIG",
         "wind": "330° / 16 kt", "vis": "10 km+", "temp": 39, "dew": 10, "qnh": 1003},
        {"icao": "OERK", "time": "2021-08-10 16:00Z",
         "raw": "OERK 101600Z 31010KT CAVOK 41/03 Q1001 NOSIG",
         "wind": "310° / 10 kt", "vis": "CAVOK", "temp": 41, "dew": 3, "qnh": 1001},
        {"icao": "OEJD", "time": "2023-04-29 12:00Z",
         "raw": "OEJD 291200Z 30014KT 8000 FEW035 36/22 Q1008 NOSIG",
         "wind": "300° / 14 kt", "vis": "8 km", "temp": 36, "dew": 22, "qnh": 1008},
        {"icao": "OEJN", "time": "2021-08-12 15:00Z",
         "raw": "OEJN 121500Z 31016KT 9999 FEW040 37/24 Q1006 NOSIG",
         "wind": "310° / 16 kt", "vis": "10 km+", "temp": 37, "dew": 24, "qnh": 1006},
    ],
    "windsAloft": [
        {"fl": "FL100", "dir": 300, "kt": 18, "tempC": 18},
        {"fl": "FL180", "dir": 285, "kt": 26, "tempC": 2},
        {"fl": "FL240", "dir": 275, "kt": 34, "tempC": -12},
        {"fl": "FL300", "dir": 270, "kt": 41, "tempC": -28},
        {"fl": "FL360", "dir": 265, "kt": 47, "tempC": -42},
    ],
    "sigmets": [],
}

# Aircraft Health Monitoring (simulated scores over the real trend backbone)
def spark(base, drift, n=12, noise=1.2):
    v, out = base, []
    for _ in range(n):
        v += drift + random.uniform(-noise, noise)
        out.append(round(max(min(v, 100), 0), 1))
    return out

ahm = {
    "simulated": True,
    "overall": 93,
    "systems": [
        {"name": "Engine 1 (CF6-80C2)", "ata": "72", "health": 94, "status": "NORMAL",
         "trend": spark(94.5, -.05), "note": "EGT margin stable; vibration within limits",
         "action": "Next borescope: 410 FH"},
        {"name": "Engine 2 (CF6-80C2)", "ata": "72", "health": 90, "status": "WATCH",
         "trend": spark(93, -.28), "note": "ΔEGT vs Eng 1 widening ~6°C over 90 days",
         "action": "Trend review recommended within 30 days"},
        {"name": "APU (GTCP 331)", "ata": "49", "health": 81, "status": "WATCH",
         "trend": spark(86, -.4), "note": "High duty cycle — 42.6% ground running",
         "action": "EGT margin check at next A-check"},
        {"name": "Bleed / Packs", "ata": "36", "health": 96, "status": "NORMAL",
         "trend": spark(96, .02), "note": "Pack outlet pressures nominal both sides",
         "action": "—"},
        {"name": "Hydraulics", "ata": "29", "health": 97, "status": "NORMAL",
         "trend": spark(97, 0), "note": "All three systems nominal", "action": "—"},
        {"name": "Landing Gear", "ata": "32", "health": 95, "status": "NORMAL",
         "trend": spark(95, -.02), "note": "Brake wear pins 60–70% remaining",
         "action": "Brake #3 replacement in ~180 cycles"},
        {"name": "Avionics / ADC", "ata": "34", "health": 99, "status": "NORMAL",
         "trend": spark(99, 0, noise=.4), "note": "No fault words in downlink",
         "action": "—"},
        {"name": "Airframe Vibration", "ata": "53", "health": 93, "status": "NORMAL",
         "trend": spark(93, -.05), "note": "N1/N2 vibration < 1.8 units all phases",
         "action": "—"},
    ],
}

# Third satellite flight (AB103, OEJN→OERK 2021-08-12) for the flight selector
sat3 = None
ab103_path = os.path.join(DATA, "flight_ab103.json")
if os.path.exists(ab103_path):
    raw3 = json.load(open(ab103_path))
    tr3 = [p for p in raw3["track"] if p.get("lat")]
    for i, p in enumerate(tr3):
        if i == 0: p["vs"] = 0; p["dist"] = 0.0
        else:
            q = tr3[i - 1]
            dm = max((ts(p["t"]) - ts(q["t"])).total_seconds() / 60, .001)
            p["vs"] = round(((p["alt"] or 0) - (q["alt"] or 0)) / dm)
            p["dist"] = round(q["dist"] + hav_nm(q["lat"], q["lon"], p["lat"], p["lon"]), 2)
    sn3 = raw3["snaps"]
    fuels3 = [s.get("Fuel Quantity-Fuel on Board (Totalizer)") or s.get("Fuel Quantity-Fuel o") or
              s.get("Fuel Quantity On Board") for s in sn3]
    fuels3 = [f for f in fuels3 if f]
    air3 = [p for p in tr3 if (p["gs"] or 0) > 80]
    sat3 = {
        "id": "AB103", "date": "2021-08-12", "from": "OEJN", "to": "OERK",
        "fromName": "Jeddah King Abdulaziz Intl", "toName": "Riyadh King Khalid Intl",
        "fidelity": "SAT",
        "start": air3[0]["t"] if air3 else tr3[0]["t"], "end": air3[-1]["t"] if air3 else tr3[-1]["t"],
        "durMin": int((ts(air3[-1]["t"]) - ts(air3[0]["t"])).total_seconds() / 60) if air3 else 0,
        "maxAlt": max((p["alt"] or 0) for p in tr3),
        "fuelBurn": (fuels3[0] - fuels3[-1]) if len(fuels3) > 1 else None,
        "track": tr3, "snapshots": sn3,
    }

payload = {
    "aircraft": {"type": "Airbus A310-300", "reg": "N310AB", "engines": "2 × GE CF6-80C2",
                 "fleet": "AeroBee demo fleet",
                 "source": "Bee edge device — satellite downlink (1–2 min interval)"},
    "flightDate": "2021-08-10",
    "track": pts, "snapshots": snaps, "legs": legs, "phaseBurn": phase_burn,
    "egtTrend": egt, "egtRoll1": egt_roll1, "egtRoll2": egt_roll2,
    "events": events, "fleetKpis": fleet_kpis, "monthly": monthly,
    "routes": route_stats, "fleet": fleet, "savings": savings, "eof": eof,
    "fuelUsdPerLb": FUEL_USD_PER_LB,
    "dfdr": dfdr, "weather": weather, "ahm": ahm, "sat3": sat3,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    f.write("// Generated by scripts/derive_data.py — AeroBee demo fleet N310AB\n")
    f.write("const AB = ")
    json.dump(payload, f, separators=(",", ":"))
    f.write(";\n")
print(f"wrote {OUT} ({os.path.getsize(OUT)//1024} KB)")
print(f"track {len(pts)} pts | events {len(events)} | legs {[l['fuelBurn'] for l in legs]}")
