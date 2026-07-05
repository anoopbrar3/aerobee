#!/usr/bin/env python3
"""AeroBee — parse full-rate A310 FDR decodes (8 Hz, 6 tables per flight)
into web-ready flight JSON with FOQA event mining.

Outputs assets/js/fdr_data.js with 2 FDR flights (white-labeled AB201/AB202).
Raw CSVs stay outside the repo; only derived, de-identified data is emitted.
"""
import csv, json, math, os
from datetime import datetime, timedelta

SRC = "/Users/anoopbrar/Downloads/Star Navigation Files/OneDrive_1_6-26-2023/"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets", "js", "fdr_data.js")

FLIGHTS = [
    {"id": "AB201", "date": "2023-04-29", "from": "OERK", "to": "OEJD",
     "fromName": "Riyadh King Khalid Intl", "toName": "Jeddah King Abdulaziz Intl",
     "tables": {"dyn": "OERK-OEJD_Table_c24b", "cfg": "OERK-OEJD_Table_84c3",
                "spl": "OERK-OEJD_Table_4d2d", "wrn": "OERK-OEJD_Table_b294",
                "vlv": "OERK-OEJD_Table_f3e1"}},
    {"id": "AB202", "date": "2023-04-29", "from": "OEJD", "to": "OERK",
     "fromName": "Jeddah King Abdulaziz Intl", "toName": "Riyadh King Khalid Intl",
     "tables": {"dyn": "OEJD-OERK_Table_cbda", "cfg": "OEJD-OERK_Table_7d86",
                "spl": "OEJD-OERK_Table_5bb4", "wrn": "OEJD-OERK_Table_1947",
                "vlv": "OEJD-OERK_Table_71a7"}},
]

def load_table(suffix):
    path = f"{SRC}2023-04-29_A310_FDR_68wps_HZ-NSA_Fl_N_{suffix}.csv"
    with open(path) as fh:
        r = csv.reader(fh, delimiter=";")
        hdr = [h.strip() for h in next(r)]
        next(r)  # mnemonic row
        rows = list(r)
    return hdr, rows

def col(hdr, rows, name, cast=float):
    try:
        i = hdr.index(name)
    except ValueError:
        matches = [j for j, h in enumerate(hdr) if h.lower().startswith(name.lower())]
        if not matches:
            return [None] * len(rows)
        i = matches[0]
    out = []
    for r in rows:
        v = r[i] if i < len(r) else ""
        try:
            out.append(cast(v))
        except (ValueError, TypeError):
            out.append(None)
    return out

def tsec(t):
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)

fleet_out = []
for F in FLIGHTS:
    print(f"--- {F['id']} {F['from']}→{F['to']}")
    dh, dr = load_table(F["tables"]["dyn"])
    ch, cr = load_table(F["tables"]["cfg"])
    sh, sr = load_table(F["tables"]["spl"])
    wh, wr = load_table(F["tables"]["wrn"])
    vh, vr = load_table(F["tables"]["vlv"])
    n = min(len(dr), len(cr), len(sr), len(wr), len(vr))
    t = [tsec(r[0]) for r in dr[:n]]

    g = lambda name, cast=float: col(dh, dr[:n], name, cast)
    gc = lambda name, cast=float: col(ch, cr[:n], name, cast)
    gs_ = lambda name, cast=float: col(sh, sr[:n], name, cast)
    gw_ = lambda name, cast=float: col(wh, wr[:n], name, cast)
    gv_ = lambda name, cast=float: col(vh, vr[:n], name, cast)

    alt = g("Altitude Baro"); cas = g("COMPUTED AIRSPEED"); hdg = g("MAGNETIC HEADING")
    nz = g("Body Normal Acceleration"); pitch = g("PITCH ANGLE"); roll = g("ROLL ANGLE")
    n1a = g("N1 Actual Eng 1"); n1b = g("N1 Actual Eng 2")
    n2a = g("N2 ENG 1"); n2b = g("N2 ENG 2")
    egta = g("EGT ENG 1"); egtb = g("EGT ENG 2")
    KG2LB = 2.20462
    ffa = [v and v * KG2LB for v in g("Fuel Flow Eng 1")]   # FDR records kg/hr
    ffb = [v and v * KG2LB for v in g("Fuel Flow Eng 2")]
    gspd = g("GROUND SPEED"); wspd = g("WIND SPEED"); wdir = g("WIND DIRECTION")
    lat = g("Latitude"); lon = g("Longitude"); gw = g("Gross Weight")
    gsdev = g("GLIDE SLOPE DEVIATION 1"); locdev = g("LOCALIZER DEVIATION 1")
    elev = g("ELEVATOR POSITION"); rud = g("RUDDER POSITION")
    vib1 = g("EVM FAN ENG 1 <N1>"); vib2 = g("EVM FAN ENG 2 <N1>")
    oilq1 = g("Oil Quantity Eng 1"); oilq2 = g("Oil Quantity Eng 2")

    FLAP_SCALE = 40 / 174.0   # raw synchro units → degrees
    SLAT_SCALE = 30 / 25.0
    flap = [v and v * FLAP_SCALE for v in gc("Flaps Position")]
    slat = [v and v * SLAT_SCALE for v in gc("Slats Position")]
    ra = gc("Radio Height RA 1"); aoa = gc("ANGLE OF ATTACK (ADC 1)")
    tla1 = gc("Thrust Lever Angle Eng 1"); tla2 = gc("Thrust Lever Angle Eng 2")
    spdbrk = gc("Speed Brake Handle"); tat = gc("TAT")
    brkl = gc("Brake Pedal Deflection LH"); brkr = gc("Brake Pedal Deflection RH")

    airgnd = gs_("Air / Ground - Air", int)
    rev1 = gs_("Reverser in Position Eng 1", int); rev2 = gs_("Reverser in Position Eng 2", int)
    ap1 = gs_("A/P CMD #1", int); ap2 = gs_("A/P CMD #2", int)
    spo_lh1 = gs_("SPOILER 1 LH RET", int)  # 1 = retracted

    ovsp = gw_("VMO/MMO Overspeed", int); stall = gw_("Stall", int)
    gpws = gw_("GPWS Modes", int); wshear = gw_("WINDSHEAR WARNING", int)
    squat = gw_("LDG Squat Switch LH", int)
    gear_not_up = gw_("GEAR SELECTOR NOT UP", int)

    # airborne window
    air_idx = [i for i in range(n) if airgnd[i] == 1]
    i0, i1 = (air_idx[0], air_idx[-1]) if air_idx else (0, n - 1)
    liftoff, touchdown = t[i0], t[i1]
    print(f"  airborne {liftoff:.0f}→{touchdown:.0f} ({(touchdown-liftoff)/60:.1f} min), rows={n}")

    # ---------------- FOQA event mining over full 8 Hz ----------------
    events = []
    def ev(sev, cat, desc, i, value, limit, unit):
        events.append({"sev": sev, "cat": cat, "desc": desc,
                       "tSec": round(t[i], 1), "flight": F["id"],
                       "value": value, "limit": limit, "unit": unit})

    def scan_flag(series, sev, cat, desc):
        prev = 0
        for i in range(n):
            v = series[i] or 0
            if v == 1 and prev == 0 and i0 <= i <= i1:
                ev(sev, cat, desc, i, 1, 0, "flag")
            prev = v

    scan_flag(ovsp, "High", "Speed", "VMO/MMO overspeed warning")
    scan_flag(stall, "High", "Handling", "Stall warning activation")
    scan_flag(wshear, "High", "Weather", "Windshear warning")

    # GPWS mode triggers
    prev = 0
    for i in range(i0, i1):
        v = gpws[i] or 0
        if v > 0 and prev == 0:
            ev("High", "Terrain", f"GPWS alert (mode {v})", i, v, 0, "mode")
        prev = v

    # max Nz in flight & at touchdown
    td_win = [i for i in range(max(i1 - 40, 0), min(i1 + 40, n))]
    td_nz = max((nz[i] or 1) for i in td_win)
    if td_nz >= 1.4:
        ev("Medium", "Landing", "Firm touchdown", i1, round(td_nz, 2), 1.40, "g")
    infl = [(nz[i] or 1, i) for i in range(i0 + 80, i1 - 80)]
    mx, mi = max(infl); mn, mni = min(infl)
    if mx >= 1.5: ev("Medium", "Handling", "High normal acceleration in flight", mi, round(mx, 2), 1.5, "g")
    if mn <= 0.5: ev("Medium", "Handling", "Low normal acceleration in flight", mni, round(mn, 2), 0.5, "g")

    # speed below 10,000 ft
    trig = False
    for i in range(i0, i1):
        if (alt[i] or 0) < 10000 and (cas[i] or 0) > 255 and not trig:
            ev("Medium", "Speed", "CAS above 250 kt below 10,000 ft", i, round(cas[i]), 250, "kt"); trig = True
        if (cas[i] or 0) < 250: trig = False

    # bank angle
    trig = False
    for i in range(i0, i1):
        r_ = abs(roll[i] or 0)
        if r_ > 32 and not trig:
            sev = "High" if (ra[i] or 9999) < 400 else "Medium"
            ev(sev, "Handling", "Excessive bank angle", i, round(r_, 1), 32, "deg"); trig = True
        if r_ < 25: trig = False

    # high ROD below 2,000 ft RA (8 Hz derivative smoothed over 2 s)
    trig = False
    for i in range(i0 + 16, i1):
        if (ra[i] or 9999) < 2000 and (ra[i] or 0) > 50:
            rod = ((alt[i - 16] or 0) - (alt[i] or 0)) * 30  # ft/2s → fpm
            if rod > 1300 and not trig:
                ev("Medium", "Approach", "High rate of descent below 2,000 ft", i, round(rod), 1300, "fpm"); trig = True
            if rod < 1000: trig = False

    # pitch at touchdown (tailstrike margin) & max pitch takeoff
    mxp = max((pitch[i] or 0, i) for i in range(i1 - 80, i1 + 40))
    if mxp[0] >= 9:
        ev("Medium", "Landing", "High pitch attitude at landing (tailstrike margin)", mxp[1], round(mxp[0], 1), 9, "deg")

    # glideslope / localizer deviation below 1000 ft RA
    for nm_, series, lim in (("Glideslope", gsdev, 1.0), ("Localizer", locdev, 1.0)):
        trig = False
        for i in range(i0, i1):
            if 100 < (ra[i] or 0) < 1000 and abs(series[i] or 0) > lim and not trig:
                ev("Medium", "Approach", f"{nm_} deviation > 1 dot below 1,000 ft", i, round(series[i], 2), lim, "dots"); trig = True
            if abs(series[i] or 0) < lim * .7: trig = False

    # reverser usage & duration
    rev_on = [i for i in range(i1, n) if (rev1[i] or 0) == 1 or (rev2[i] or 0) == 1]
    rev_n1_max = max(((n1a[i] or 0) for i in rev_on), default=0)
    if rev_n1_max > 60:
        ev("Low", "Efficiency", "Full reverse thrust on landing (idle reverse may suffice)", rev_on[0], round(rev_n1_max), 60, "% N1")

    # dual-engine taxi-in
    taxi_in = [i for i in range(i1 + 400, n) if (gspd[i] or 0) > 5]
    if taxi_in and min((n2b[i] or 100) for i in taxi_in) > 50:
        ev("Low", "Efficiency", "Dual-engine taxi-in (single-engine taxi opportunity)", taxi_in[0],
           2, 1, "engines")

    sev_rank = {"High": 0, "Medium": 1, "Low": 2}
    events.sort(key=lambda e: (sev_rank[e["sev"]], e["tSec"]))
    print(f"  events: {len(events)}")

    # ---------------- approach gate analysis (real data!) ----------------
    vref = 137
    gates = {}
    for gate in (1000, 500, 100):
        idx = next((i for i in range(i1, i0, -1) if (ra[i] or 0) >= gate), None)
        if idx:
            rod2 = ((alt[idx - 16] or 0) - (alt[idx] or 0)) * 30
            gates[str(gate)] = {"cas": round(cas[idx] or 0), "rod": round(rod2),
                                "gsdev": round(gsdev[idx] or 0, 2), "locdev": round(locdev[idx] or 0, 2),
                                "flap": round(flap[idx] or 0), "gearDown": 1 if (gear_not_up[idx] or 0) else 0,
                                "n1": round(((n1a[idx] or 0) + (n1b[idx] or 0)) / 2, 1)}

    # ---------------- adaptive downsampling for web ----------------
    keep = []
    for i in range(0, n, 2):  # 4 Hz base scan
        low = (alt[i] or 0) < 10000 or (ra[i] or 0) < 3000
        step_ok = (i % 8 == 0) or (low and i % 4 == 0)
        near_td = abs(t[i] - touchdown) < 60 or abs(t[i] - liftoff) < 60
        if near_td and i % 2 == 0: keep.append(i)
        elif low and i % 8 == 0: keep.append(i)
        elif i % 32 == 0: keep.append(i)
    keep = sorted(set(keep))

    fields = ["t", "lat", "lon", "alt", "cas", "gs", "hdg", "pitch", "roll", "nz",
              "n1a", "n1b", "egta", "egtb", "ffa", "ffb", "flap", "slat", "ra",
              "gear", "spdbrk", "rev", "ap", "wspd", "wdir", "gsdev", "locdev",
              "vib1", "vib2", "aoa", "tla1", "air"]
    rows_out = []
    for i in keep:
        la, lo = lat[i], lon[i]
        if la is None or (abs(la) < 2 and abs(lo) < 2): la = lo = None  # IRS align garbage
        rows_out.append([
            round(t[i], 1), la and round(la, 5), lo and round(lo, 5),
            alt[i] and round(alt[i]), cas[i] and round(cas[i]), gspd[i] and round(gspd[i]),
            hdg[i] and round(hdg[i]), pitch[i] and round(pitch[i], 1), roll[i] and round(roll[i], 1),
            nz[i] and round(nz[i], 2),
            n1a[i] and round(n1a[i], 1), n1b[i] and round(n1b[i], 1),
            egta[i] and round(egta[i]), egtb[i] and round(egtb[i]),
            ffa[i] and round(ffa[i]), ffb[i] and round(ffb[i]),
            flap[i] and round(flap[i]), slat[i] and round(slat[i]),
            ra[i] and round(ra[i]), 1 if (gear_not_up[i] or 0) else 0,
            spdbrk[i] and round(spdbrk[i], 1),
            1 if ((rev1[i] or 0) or (rev2[i] or 0)) else 0,
            1 if ((ap1[i] or 0) or (ap2[i] or 0)) else 0,
            wspd[i] and round(wspd[i]), wdir[i] and round(wdir[i]),
            gsdev[i] and round(gsdev[i], 2), locdev[i] and round(locdev[i], 2),
            vib1[i] and round(vib1[i], 2), vib2[i] and round(vib2[i], 2),
            aoa[i] and round(aoa[i], 1), tla1[i] and round(tla1[i], 1),
            airgnd[i] or 0,
        ])
    print(f"  web rows: {len(rows_out)}")


    # ---------------- takeoff & landing performance analytics ----------------
    # Takeoff: brake release = first sustained gspd>3 before liftoff
    br = None
    for i in range(i0, max(i0 - 8 * 420, 0), -1):
        if (gspd[i] or 0) < 3: br = i; break
    if br is None:
        win = range(max(i0 - 8 * 420, 0), i0)
        br = min(win, key=lambda i: gspd[i] or 0)
    ground_roll_ft = 0.0
    for i in range(br + 1, i0 + 1):
        ground_roll_ft += ((gspd[i] or 0) * 1.68781) * (t[i] - t[i - 1])  # kt→ft/s
    n1_peak = max((n1a[i] or 0, n1b[i] or 0) for i in range(br, i0 + 8 * 60))
    egt_peak = max(max(egta[i] or 0, egtb[i] or 0) for i in range(br, i0 + 8 * 60))
    vr_cas = cas[i0] or 0
    # pitch rate at rotation (max over liftoff ±5 s, per second)
    rot_rate = max(((pitch[i + 8] or 0) - (pitch[i] or 0)) for i in range(i0 - 40, i0 + 40))
    alt_lo = alt[i0] or 0
    sec_to_1500 = next((t[i] - t[i0] for i in range(i0, i1) if (alt[i] or 0) >= alt_lo + 1500), None)
    # Landing: flare = RA 50 ft → touchdown
    i50 = next((i for i in range(i1, i0, -1) if (ra[i] or 0) >= 50), i1)
    flare_sec = round(t[i1] - t[i50], 1)
    td_pitch = max((pitch[i] or 0) for i in range(i1 - 24, i1 + 8))
    rev_idx = [i for i in range(i1, n) if (rev1[i] or 0) or (rev2[i] or 0)]
    rev_sec = round((t[rev_idx[-1]] - t[rev_idx[0]]), 1) if rev_idx else 0
    rev_max_n1 = round(max(((n1a[i] or 0) + (n1b[i] or 0)) / 2 for i in rev_idx), 1) if rev_idx else 0
    # deceleration kt/s over first 15 s after touchdown
    i15 = min(i1 + 8 * 15, n - 1)
    decel = round(((gspd[i1] or 0) - (gspd[i15] or 0)) / max(t[i15] - t[i1], 1), 2)
    # taxi-in time & fuel
    ti_idx = [i for i in range(i1, n) if (gspd[i] or 0) > 2]
    taxi_in_min = round((t[ti_idx[-1]] - t[i1]) / 60, 1) if ti_idx else 0
    taxi_fuel = 0.0
    for i in range(i1 + 1, n):
        taxi_fuel += ((ffa[i] or 0) + (ffb[i] or 0)) * (t[i] - t[i - 1]) / 3600
    # EGT-vs-N1 signature during takeoff acceleration (1 Hz for 100 s)
    sig = []
    for i in range(br, min(br + 8 * 100, n), 8):
        sig.append([round(n1a[i] or 0, 1), round(egta[i] or 0), round(n1b[i] or 0, 1), round(egtb[i] or 0)])
    EGT_REDLINE = 960
    perf = {
        "takeoff": {
            "n1Peak": round(n1_peak[0] if isinstance(n1_peak, tuple) else n1_peak, 1),
            "egtPeak": round(egt_peak), "egtMargin": round(EGT_REDLINE - egt_peak),
            "deratePct": round(100 - (n1_peak[0] if isinstance(n1_peak, tuple) else n1_peak), 1),
            "groundRollFt": round(ground_roll_ft), "vrCas": round(vr_cas),
            "rotRateDegS": round(rot_rate, 1),
            "secTo1500": round(sec_to_1500) if sec_to_1500 else None,
        },
        "landing": {
            # est. touchdown point past threshold: ground covered during flare
            # minus the ~950 ft from the 50 ft screen to the threshold (3 deg GS)
            "tdDistEstFt": round(max((gspd[i50] or 135) * 1.68781 * flare_sec - 950, 400)),
            "flareSec": flare_sec, "tdG": round(td_nz, 2), "tdPitch": round(td_pitch, 1),
            "revSec": rev_sec, "revMaxN1": rev_max_n1, "decelKtS": decel,
            "taxiInMin": taxi_in_min, "taxiInFuelLb": round(taxi_fuel),
        },
        "egtN1Sig": sig,
    }

    # summary
    fuel_used = None
    ff_int = 0.0
    for i in range(1, n):
        dt_h = (t[i] - t[i - 1]) / 3600
        ff_int += ((ffa[i] or 0) + (ffb[i] or 0)) * dt_h
    fuel_used = round(ff_int)
    dur = round((t[-1] - t[0]) / 60)
    air_min = round((touchdown - liftoff) / 60)
    mx_alt = max(a for a in alt if a is not None)
    winds_seen = [(wspd[i], wdir[i]) for i in range(i0, i1) if (wspd[i] or 0) > 5]
    max_wind = max(winds_seen, key=lambda x: x[0]) if winds_seen else (None, None)

    fleet_out.append({
        "id": F["id"], "date": F["date"], "from": F["from"], "to": F["to"],
        "fromName": F["fromName"], "toName": F["toName"], "fidelity": "FDR",
        "startSec": round(t[0], 1), "offSec": round(liftoff, 1), "onSec": round(touchdown, 1),
        "durMin": dur, "airMin": air_min, "maxAlt": mx_alt,
        "fuelUsedLb": fuel_used, "gwStart": next((w for w in gw if w and w > 100000), None),
        "tdNz": round(td_nz, 2), "maxWind": {"kt": max_wind[0], "dir": max_wind[1]},
        "vref": vref, "gates": gates, "events": events,
        "fields": fields, "rows": rows_out, "perf": perf,
    })

with open(OUT, "w") as f:
    f.write("// Generated by scripts/parse_fdr.py — 8 Hz FDR decodes, white-labeled\n")
    f.write("const FDR_FLIGHTS = ")
    json.dump(fleet_out, f, separators=(",", ":"))
    f.write(";\n")
print(f"\nwrote {OUT} ({os.path.getsize(OUT)//1024} KB)")
