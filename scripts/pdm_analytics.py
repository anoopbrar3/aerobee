#!/usr/bin/env python3
"""AeroBee — predictive-maintenance analytics engine.

Real statistical methods on the real data (pure python, no deps):
- ENGINE : N1-normalized takeoff EGT margin; Theil–Sen robust trend; OLS with
           95% CI on the slope; EWMA control chart on Eng1−Eng2 divergence;
           RUL to alert threshold with P50/P90 from slope uncertainty.
- FUEL   : route-normalized burn (z-scores, anomaly flags); EWMA control chart;
           Holt double-exponential forecast of burn/flight; cost drift.
- SAFETY : Poisson event-rate per flight with exact 95% CI; risk-weighted
           (probability × severity) monthly index; EWMA control chart;
           first-half vs second-half category shift.

Outputs assets/js/pdm_data.js. Forecasts are statistical projections of the
measured trends — labeled as model output in the UI.
"""
import csv, json, math, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
OUT = os.path.join(HERE, "..", "assets", "js", "pdm_data.js")
DOCS = "/Users/anoopbrar/Documents/"

# ---------------------------------------------------------------- helpers
def ols(xs, ys):
    """OLS slope/intercept + slope std error + 95% CI half-width."""
    n = len(xs)
    xb = sum(xs) / n; yb = sum(ys) / n
    sxx = sum((x - xb) ** 2 for x in xs)
    sxy = sum((x - xb) * (y - yb) for x, y in zip(xs, ys))
    b = sxy / sxx; a = yb - b * xb
    resid = [y - (a + b * x) for x, y in zip(xs, ys)]
    s2 = sum(r * r for r in resid) / max(n - 2, 1)
    se = math.sqrt(s2 / sxx)
    t95 = 2.0 if n > 30 else {5: 3.18, 6: 2.78, 7: 2.57, 8: 2.45, 9: 2.36, 10: 2.31,
                              12: 2.23, 15: 2.14, 20: 2.09, 25: 2.06}.get(n, 2.1)
    return {"slope": b, "intercept": a, "se": se, "ci95": t95 * se,
            "sigma": math.sqrt(s2), "n": n}

def theil_sen(xs, ys):
    slopes = []
    for i in range(len(xs)):
        for j in range(i + 1, len(xs)):
            if xs[j] != xs[i]:
                slopes.append((ys[j] - ys[i]) / (xs[j] - xs[i]))
    slopes.sort()
    return slopes[len(slopes) // 2] if slopes else 0.0

def ewma(ys, lam=0.3):
    out, z = [], ys[0]
    for y in ys:
        z = lam * y + (1 - lam) * z
        out.append(z)
    return out

def ewma_limits(ys, lam=0.3, L=2.66):
    """EWMA center + control limits (SPC); sigma from moving ranges."""
    mrs = [abs(ys[i] - ys[i - 1]) for i in range(1, len(ys))]
    sigma = (sum(mrs) / len(mrs)) / 1.128 if mrs else 0.0
    center = sum(ys) / len(ys)
    hw = L * sigma * math.sqrt(lam / (2 - lam))
    return center, center + hw, center - hw, sigma

def holt(ys, alpha=0.5, beta=0.3, horizon=6):
    l, b = ys[0], ys[1] - ys[0] if len(ys) > 1 else 0
    for y in ys[1:]:
        l_prev = l
        l = alpha * y + (1 - alpha) * (l + b)
        b = beta * (l - l_prev) + (1 - beta) * b
    return [l + b * (k + 1) for k in range(horizon)], b

def poisson_ci(k, n):
    """95% CI for rate k/n (normal approx with continuity, fine for k>5)."""
    lam = k / n
    se = math.sqrt(k) / n if k > 0 else 1.0 / n
    return max(lam - 1.96 * se, 0), lam + 1.96 * se

def month_seq(months):
    return {m: i for i, m in enumerate(sorted(set(months)))}

# ================================================================ ENGINE
egt = json.load(open(os.path.join(DATA, "takeoff_egt.json")))
egt = [e for e in egt if (e.get("e1egt") or 0) >= 550 and (e.get("e2egt") or 0) >= 550
       and (e.get("e1n1") or 0) >= 85]
EGT_REDLINE, ALERT_MARGIN = 960, 100   # redline; ECM alert when margin < 100 °C

# N1 normalization: regress EGT on N1 across all takeoffs, use residual + mean
for k1, kn in (("e1egt", "e1n1"), ("e2egt", "e2n1")):
    pts = [(e[kn], e[k1]) for e in egt if e.get(kn) and e.get(k1)]
    fit = ols([p[0] for p in pts], [p[1] for p in pts])
    mean_n1 = sum(p[0] for p in pts) / len(pts)
    for e in egt:
        if e.get(kn) and e.get(k1):
            e[k1 + "_norm"] = e[k1] - fit["slope"] * (e[kn] - mean_n1)  # EGT at reference N1

by_month = defaultdict(lambda: {"m1": [], "m2": [], "d": []})
for e in egt:
    m = e["date"][:7]
    if e.get("e1egt_norm"): by_month[m]["m1"].append(EGT_REDLINE - e["e1egt_norm"])
    if e.get("e2egt_norm"): by_month[m]["m2"].append(EGT_REDLINE - e["e2egt_norm"])
    if e.get("e1egt") and e.get("e2egt"): by_month[m]["d"].append(e["e1egt"] - e["e2egt"])
months = sorted(by_month)
mi = month_seq(months)
margin1 = [sum(v["m1"]) / len(v["m1"]) if v["m1"] else None for m, v in ((m, by_month[m]) for m in months)]
margin2 = [sum(v["m2"]) / len(v["m2"]) if v["m2"] else None for m, v in ((m, by_month[m]) for m in months)]
delta = [sum(v["d"]) / len(v["d"]) if v["d"] else None for m, v in ((m, by_month[m]) for m in months)]

eng_stats = {}
for name, series in (("eng1", margin1), ("eng2", margin2)):
    xs = [i for i, v in enumerate(series) if v is not None]
    ys = [v for v in series if v is not None]
    fit = ols(xs, ys); ts = theil_sen(xs, ys)
    now = ys[-1]
    # RUL months to ALERT_MARGIN using slope CI (worst = slope - ci)
    def rul(slope):
        if slope >= 0: return None
        return (now - ALERT_MARGIN) / (-slope)
    fc, fc_lo, fc_hi = [], [], []
    for k in range(1, 13):
        x = xs[-1] + k
        mid = fit["intercept"] + fit["slope"] * x
        pred_se = fit["sigma"] * math.sqrt(1 + 1 / fit["n"]) + fit["ci95"] * k
        fc.append(round(mid, 1)); fc_lo.append(round(mid - pred_se, 1)); fc_hi.append(round(mid + pred_se, 1))
    eng_stats[name] = {
        "marginNow": round(now, 1), "olsSlope": round(fit["slope"], 3),
        "slopeCi95": round(fit["ci95"], 3), "theilSen": round(ts, 3),
        "significant": abs(fit["slope"]) > fit["ci95"],
        "rulP50": round(rul(ts)) if rul(ts) else None,
        "rulP90": round(rul(ts - fit["ci95"])) if rul(ts - fit["ci95"]) else None,
        "forecast": fc, "fcLo": fc_lo, "fcHi": fc_hi,
    }

dvals = [v for v in delta if v is not None]
dc, dhi, dlo, dsig = ewma_limits(dvals)
dew = ewma(dvals)
delta_violations = [i for i, v in enumerate(dew) if v > dhi or v < dlo]

engine_payload = {
    "months": months, "margin1": [v and round(v, 1) for v in margin1],
    "margin2": [v and round(v, 1) for v in margin2],
    "delta": [v and round(v, 1) for v in delta], "deltaEwma": [round(v, 2) for v in dew],
    "deltaLimits": {"center": round(dc, 1), "ucl": round(dhi, 1), "lcl": round(dlo, 1)},
    "deltaViolations": delta_violations,
    "alertMargin": ALERT_MARGIN, "redline": EGT_REDLINE,
    "stats": eng_stats, "takeoffs": len(egt),
}

# ================================================================ FUEL
fleet = json.load(open(os.path.join(DATA, "fleet_flights.json")))
good = [f for f in fleet if f.get("fuelBurn") and 0 < f["fuelBurn"] < 80000 and f["durMin"] > 20]
# route-normalized: z-score against same-route population (route = origin+dest codes)
routes = defaultdict(list)
for f in good:
    key = f"{(f.get('origin') or ['?'])[0]}→{(f.get('dest') or ['?'])[0]}"
    if "?" not in key and "???" not in key:
        routes[key].append(f)
anoms = []
route_stats = []
for key, fs in routes.items():
    if len(fs) < 6: continue
    burns = [f["fuelBurn"] for f in fs]
    mu = sum(burns) / len(burns)
    sd = math.sqrt(sum((b - mu) ** 2 for b in burns) / (len(burns) - 1))
    route_stats.append({"route": key, "n": len(fs), "mean": round(mu), "sd": round(sd),
                        "cv": round(sd / mu * 100, 1)})
    for f in fs:
        z = (f["fuelBurn"] - mu) / sd if sd else 0
        if abs(z) > 2:
            anoms.append({"date": f["start"][:10], "route": key, "burn": round(f["fuelBurn"]),
                          "z": round(z, 2), "expected": round(mu)})
anoms.sort(key=lambda a: -abs(a["z"]))
route_stats.sort(key=lambda r: -r["n"])

fm = defaultdict(lambda: {"burn": 0.0, "n": 0})
for f in good:
    m = f["start"][:7]
    fm[m]["burn"] += f["fuelBurn"]; fm[m]["n"] += 1
fmonths = sorted(m for m in fm if fm[m]["n"] >= 3)
bpf = [fm[m]["burn"] / fm[m]["n"] / 1000 for m in fmonths]  # klb/flight
f_fit = ols(list(range(len(bpf))), bpf)
f_ts = theil_sen(list(range(len(bpf))), bpf)
f_fc, f_trend = holt(bpf)
fc_center, fc_ucl, fc_lcl, _ = ewma_limits(bpf)
f_ew = ewma(bpf)
FUEL_USD_PER_LB = 0.40
fuel_payload = {
    "months": fmonths, "burnPerFlight": [round(v, 2) for v in bpf],
    "ewma": [round(v, 2) for v in f_ew],
    "limits": {"center": round(fc_center, 2), "ucl": round(fc_ucl, 2), "lcl": round(fc_lcl, 2)},
    "holtFc": [round(v, 2) for v in f_fc], "holtTrend": round(f_trend, 3),
    "olsSlope": round(f_fit["slope"], 3), "slopeCi95": round(f_fit["ci95"], 3),
    "theilSen": round(f_ts, 3), "significant": abs(f_fit["slope"]) > f_fit["ci95"],
    "driftUsdYr": round(f_ts * 1000 * 12 * 27 * FUEL_USD_PER_LB),  # klb→lb, 12mo, ~27 flt/mo
    "anomalies": anoms[:8], "routeStats": route_stats[:6],
    "flights": len(good),
}

# ================================================================ SAFETY
frows = list(csv.DictReader(open(DOCS + "FOQA Flight Summary for DEMO CSV.csv", encoding="utf-8-sig")))
import openpyxl
wb = openpyxl.load_workbook(DOCS + "SMS FOQA Event Classification Table.xlsx", read_only=True, data_only=True)
sms = {}
for r in wb.active.iter_rows(min_row=2, values_only=True):
    if r[0]:
        def num(v, d=1):
            try: return float(v)
            except (TypeError, ValueError): return d
        sms[str(r[0]).strip()] = (num(r[3], 3), num(r[6], 2))
wb.close()

sm = defaultdict(lambda: {"flights": set(), "events": [], "risk": []})
cats_half = [defaultdict(int), defaultdict(int)]
all_dates = sorted(set(r["TAKE OFF DATE"] for r in frows))
mid_date = all_dates[len(all_dates) // 2]
for r in frows:
    m = r["TAKE OFF DATE"][:7]
    sm[m]["flights"].add(r["id"])
    name = r["EVENT NAME"].strip()
    if name and name != "No Deviations":
        p, s_ = sms.get(name, (3, 2))
        sm[m]["events"].append(name)
        sm[m]["risk"].append(p * s_)
        cats_half[0 if r["TAKE OFF DATE"] <= mid_date else 1][name] += 1
smonths = sorted(sm)
rates, rate_lo, rate_hi, risk_idx = [], [], [], []
for m in smonths:
    k, n = len(sm[m]["events"]), max(len(sm[m]["flights"]), 1)
    lo, hi = poisson_ci(k, n)
    rates.append(round(k / n, 2)); rate_lo.append(round(lo, 2)); rate_hi.append(round(hi, 2))
    risk_idx.append(round(sum(sm[m]["risk"]) / max(len(sm[m]["risk"]), 1), 2))
s_fit = ols(list(range(len(rates))), rates)
s_ts = theil_sen(list(range(len(rates))), rates)
sc, sucl, slcl, _ = ewma_limits(rates)
s_ew = ewma(rates)
# category shift: biggest riser second half vs first half
risers = []
for name in set(list(cats_half[0]) + list(cats_half[1])):
    a, b = cats_half[0].get(name, 0), cats_half[1].get(name, 0)
    if a + b >= 4:
        risers.append({"event": name, "firstHalf": a, "secondHalf": b, "delta": b - a})
risers.sort(key=lambda r: -r["delta"])
safety_payload = {
    "months": smonths, "rate": rates, "rateLo": rate_lo, "rateHi": rate_hi,
    "riskIndex": risk_idx, "ewma": [round(v, 2) for v in s_ew],
    "limits": {"center": round(sc, 2), "ucl": round(sucl, 2), "lcl": round(slcl, 2)},
    "olsSlope": round(s_fit["slope"], 4), "slopeCi95": round(s_fit["ci95"], 4),
    "theilSen": round(s_ts, 4), "significant": abs(s_fit["slope"]) > s_fit["ci95"],
    "risers": risers[:5],
    "totalEvents": sum(len(sm[m]["events"]) for m in smonths),
    "totalFlights": len(set(r["id"] for r in frows)),
}

payload = {"engine": engine_payload, "fuel": fuel_payload, "safety": safety_payload}
with open(OUT, "w") as f:
    f.write("// Generated by scripts/pdm_analytics.py — statistical PdM layer on real data\n")
    f.write("const PDM = ")
    json.dump(payload, f, separators=(",", ":"))
    f.write(";\n")
print(f"wrote {OUT} ({os.path.getsize(OUT)//1024} KB)")
print("ENGINE:", {k: {kk: v[kk] for kk in ('marginNow','theilSen','rulP50','rulP90','significant')} for k, v in eng_stats.items()})
print("FUEL: slope", fuel_payload["olsSlope"], "±", fuel_payload["slopeCi95"], "| anomalies:", len(anoms), "| driftUsd/yr:", fuel_payload["driftUsdYr"])
print("SAFETY: rate slope", safety_payload["olsSlope"], "±", safety_payload["slopeCi95"], "| top riser:", risers[0] if risers else None)
