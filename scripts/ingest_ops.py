#!/usr/bin/env python3
"""AeroBee — ingest operational demo/real datasets → assets/js/ops_data.js

Sources (stay outside the repo; only white-labeled derived data is emitted):
- AeroBee Raw Flight Data CSV  → demo flight AB301 (simulated, embedded events)
- FOQA Flight Summary CSV      → 158 real FDM events across 2023 (routes kept,
                                 no tail identifiers present)
- SMS FOQA Event Classification→ probability/severity risk matrix per event type
"""
import csv, json, os
from collections import Counter, defaultdict

DOCS = "/Users/anoopbrar/Documents/"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets", "js", "ops_data.js")

# ---------------- demo flight AB301 ----------------
rows = list(csv.DictReader(open(DOCS + "AeroBee - Raw Flight Data CSV.csv", encoding="utf-8-sig")))
track, events = [], []
for r in rows:
    try:
        track.append({
            "t": f'{r["Date"]} {r["Time"]}', "lat": float(r["Latitude"]), "lon": float(r["Longitude"]),
            "alt": float(r["Altitude_ft"]), "gs": float(r["Airspeed_kts"]), "hdg": float(r["Heading_deg"]),
            "vs": float(r["VerticalSpeed_ft_min"]), "phase": r["FlightPhase"],
            "n1a": float(r["Engine1_N1_perc"]), "n1b": float(r["Engine2_N1_perc"]),
            "egta": float(r["Engine1_Temp_C"]) * 2.2, "egtb": float(r["Engine2_Temp_C"]) * 2.2,
            "ff": float(r["FuelFlow_lb_h"]), "fuel": float(r["FuelQuantity_lbs"]),
            "oilpa": float(r["Engine1_OilPressure_psi"]), "oilpb": float(r["Engine2_OilPressure_psi"]),
            "flap": float(r["FlapSetting"]), "wspd": float(r["WindSpeed_kts"]), "wdir": float(r["WindDirection_deg"]),
        })
    except (ValueError, KeyError):
        continue
    if r.get("EventID"):
        sev = {"High": "High", "Moderate": "Medium", "Low": "Low"}.get(r["Severity"], "Low")
        events.append({"sev": sev, "cat": "Engine" if r["EventID"].startswith("ME") else "Flight",
                       "desc": r["EventName"], "t": f'{r["Date"]} {r["Time"]}', "flight": "AB301",
                       "value": None, "limit": None, "unit": "", "src": "demo data · simulated"})
demo = {
    "id": "AB301", "date": rows[0]["Date"], "from": "CYVR", "to": "KDFW",
    "fromName": "Vancouver Intl", "toName": "Dallas–Fort Worth",
    "fidelity": "SIM", "track": track, "events": events,
    "durMin": 360, "maxAlt": max(t["alt"] for t in track),
    "fuelBurn": track[0]["fuel"] - track[-1]["fuel"],
}

# ---------------- real FOQA history ----------------
frows = list(csv.DictReader(open(DOCS + "FOQA Flight Summary for DEMO CSV.csv", encoding="utf-8-sig")))
PHASES = {"TXI": "Taxi", "ENR": "En Route", "STD": "Standing", "APR": "Approach",
          "ICL": "Initial Climb", "TOF": "Takeoff", "LDG": "Landing", "": "—"}
hist = []
for r in frows:
    name = r["EVENT NAME"].strip()
    if not name or name == "No Deviations":
        continue
    hist.append({
        "date": r["TAKE OFF DATE"], "from": r["TAKEOFF AIRPORT"].replace("x", "—"),
        "to": r["LANDING AIRPORT"].replace("x", "—"),
        "phase": PHASES.get(r["PHASE"], r["PHASE"]), "event": name,
        "lat": float(r["LATITUDE EVENT START"]) if r["LATITUDE EVENT START"] else None,
        "lon": float(r["LONGITUDE EVENT START"]) if r["LONGITUDE EVENT START"] else None,
    })
pareto = Counter(h["event"] for h in hist).most_common(12)
by_month = defaultdict(int)
flights_by_month = defaultdict(set)
for r in frows:
    m = r["TAKE OFF DATE"][:7]
    flights_by_month[m].add(r["id"])
for h in hist:
    by_month[h["date"][:7]] += 1
months = sorted(set(list(by_month) + list(flights_by_month)))
monthly = [{"month": m, "events": by_month.get(m, 0), "flights": len(flights_by_month.get(m, []))}
           for m in months]

# ---------------- SMS risk classification ----------------
import openpyxl
wb = openpyxl.load_workbook(DOCS + "SMS FOQA Event Classification Table.xlsx", read_only=True, data_only=True)
ws = wb.active
sms = {}
for r in ws.iter_rows(min_row=2, values_only=True):
    if not r[0]:
        continue
    def num(v, d=1):
        try: return float(v)
        except (TypeError, ValueError): return d
    sms[str(r[0]).strip()] = {
        "cat": r[1], "sub": r[2],
        "prob": [num(r[3]), num(r[4]), num(r[5])],
        "sev": [num(r[6]), num(r[7]), num(r[8])],
    }
wb.close()

# risk matrix cells: classify each historic event at level-1 prob/sev
matrix = defaultdict(int)
scored = []
for h in hist:
    c = sms.get(h["event"])
    p = round(c["prob"][0]) if c else 3
    s_ = round(c["sev"][0]) if c else 2
    p = max(1, min(5, p)); s_ = max(1, min(5, s_))
    matrix[f"{p},{s_}"] += 1
    scored.append({**h, "prob": p, "sev": s_, "risk": p * s_,
                   "cat": (c or {}).get("cat"), "sub": (c or {}).get("sub")})
risk_by_month = defaultdict(list)
for s_ in scored:
    risk_by_month[s_["date"][:7]].append(s_["risk"])
risk_monthly = [{"month": m, "avgRisk": round(sum(v) / len(v), 2), "maxRisk": max(v), "n": len(v)}
                for m, v in sorted(risk_by_month.items())]

payload = {
    "demoFlight": demo,
    "foqa": {"events": scored, "pareto": pareto, "monthly": monthly,
             "riskMonthly": risk_monthly,
             "matrix": {k: v for k, v in matrix.items()},
             "flights": len(set(r["id"] for r in frows)),
             "period": f'{min(r["TAKE OFF DATE"] for r in frows)} → {max(r["TAKE OFF DATE"] for r in frows)}'},
    "smsCategories": sorted(set(v["cat"] for v in sms.values() if v["cat"])),
}
with open(OUT, "w") as f:
    f.write("// Generated by scripts/ingest_ops.py — demo flight + real FDM event history (white-labeled)\n")
    f.write("const OPS = ")
    json.dump(payload, f, separators=(",", ":"))
    f.write(";\n")
print(f"wrote {OUT} ({os.path.getsize(OUT)//1024} KB)")
print(f"demo track {len(track)} pts, {len(events)} events | foqa {len(hist)} events, {len(monthly)} months")
print("pareto top:", pareto[:4])
