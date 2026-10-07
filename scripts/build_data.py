"""Builds js/data.js from masters_rows.json + PhD rows + campus coordinates.
Run: python3 scripts/build_data.py"""
import json, os
HERE = os.path.dirname(__file__)
rows = json.load(open(os.path.join(HERE, "masters_rows.json")))

# Campus coordinates, city and website per university live in universities.json (also used by scripts/discover.mjs).
UNIS = json.load(open(os.path.join(HERE, "universities.json")))
GEO = {"Aberdeen":[57.149,-2.094],"Aberystwyth":[52.415,-4.083],"Bangor":[53.228,-4.129],"Bath":[51.381,-2.359],"Belfast":[54.597,-5.930],"Birmingham":[52.486,-1.890],"Bournemouth":[50.720,-1.880],"Bradford":[53.795,-1.759],"Brighton":[50.822,-0.137],"Bristol":[51.455,-2.588],"Cambridge":[52.205,0.119],"Canterbury":[51.280,1.079],"Cardiff":[51.481,-3.179],"Chester":[53.193,-2.893],"Colchester":[51.890,0.903],"Coventry":[52.407,-1.510],"Dundee":[56.462,-2.971],"Durham":[54.776,-1.576],"Edinburgh":[55.953,-3.188],"Egham":[51.431,-0.552],"Exeter":[50.718,-3.534],"Farnham":[51.215,-0.799],"Glasgow":[55.864,-4.252],"Guildford":[51.236,-0.570],"Hatfield":[51.763,-0.223],"Huddersfield":[53.645,-1.785],"Hull":[53.767,-0.327],"Keele":[53.003,-2.272],"Lancaster":[54.047,-2.801],"Leeds":[53.801,-1.549],"Leicester":[52.637,-1.140],"Lincoln":[53.231,-0.541],"Liverpool":[53.408,-2.992],"London":[51.507,-0.128],"Loughborough":[52.772,-1.206],"Luton":[51.879,-0.418],"Manchester":[53.481,-2.243],"Middlesbrough":[54.575,-1.235],"Newcastle":[54.978,-1.618],"Northampton":[52.237,-0.894],"Norwich":[52.630,1.297],"Nottingham":[52.954,-1.158],"Ormskirk":[53.567,-2.884],"Oxford":[51.752,-1.258],"Paisley":[55.846,-4.424],"Plymouth":[50.376,-4.143],"Pontypridd":[51.602,-3.342],"Portsmouth":[50.820,-1.088],"Preston":[53.763,-2.703],"Sheffield":[53.381,-1.470],"Southampton":[50.910,-1.404],"St Andrews":[56.340,-2.797],"Stirling":[56.117,-3.937],"Stoke-on-Trent":[53.003,-2.180],"Sunderland":[54.906,-1.381],"Swansea":[51.621,-3.944],"Wolverhampton":[52.587,-2.129],"Worcester":[52.192,-2.220],"Wrexham":[53.046,-2.993],"York":[53.960,-1.087],"Cranfield":[52.070,-0.630],"Ipswich":[52.056,1.148],"High Wycombe":[51.629,-0.748],"Winchester":[51.063,-1.308],"Reading":[51.454,-0.978]}

def gq(u, c):
    full = u.replace("Univ. of", "University of").replace("Univ.", "University")
    if u == "UCL": full = "University College London"
    return f"{full}, {c}, UK"

out, unis = [], {}
for r in rows:
    r = dict(r); r["lv"] = "Masters"; r["subj"] = [r["g"]]; out.append(r)
    if r["u"] not in unis:
        U = UNIS[r["u"]]
        unis[r["u"]] = {"c": r["c"], "lat": U["lat"], "lng": U["lng"], "q": gq(r["u"], r["c"]), "web": U["web"]}

# PhD rows: one per university. Fees estimated (≈85% of that university's masters fee), labelled "est."
SPECIAL = {
 "University of Cambridge": "Gates Cambridge / Cambridge Trust (full)",
 "University of Oxford": "Clarendon Fund (full)",
 "Imperial College London": "President's PhD Scholarships (full)",
}
by_uni = {}
# (Computing PhDs: estimated from that university's CS / AI / HCI master's only, not its health or nursing courses.)
for r in rows:
    if r["g"] in ("CS", "AI", "HCI"): by_uni.setdefault(r["u"], []).append(r)
for u, rs in by_uni.items():
    first = rs[0]
    fee = sum(x["f"] for x in rs) / len(rs) * 0.85
    fee = int(min(42000, max(15000, round(fee / 500) * 500)))
    warn = sorted({x["fl"] for x in rs if x["fl"] in ("UKVI action plan", "Intl recruitment paused 2026/27 (Nepal not exempt)")})
    out.append({
        "g": "CS", "subj": ["CS", "AI", "HCI"], "lv": "PhD", "u": u, "c": first["c"],
        "uk": first["uk"], "qs": first["qs"], "qss": first["qss"],
        "p": "PhD Computer Science (AI / HCI research groups)",
        "i": "Oct" if u in ("University of Cambridge", "University of Oxford") else "Oct, Jan, Apr",
        "f": fee, "fn": "est.", "l": first["l"], "t": fee + first["l"], "s": 0, "sl": "",
        "n": fee + first["l"],
        "o": SPECIAL.get(u, "UKRI / university studentships (competitive, open to intl)"),
        "pl": "No", "fl": "; ".join(warn), **({"nr": True} if first.get("nr") else {}),
    })

# Fee payment policies (deposit, installments, dates per intake) — from each university's own pages.
PAY = json.load(open(os.path.join(HERE, "payment_policies.json")))
for u in unis:
    if u in PAY: unis[u]["pay"] = PAY[u]

# Scholarships Nepali students can get (Nepal-specific, automatic, grade-based, apply, early-payment).
SCH = json.load(open(os.path.join(HERE, "scholarships.json")))
for u in unis:
    if u in SCH: unis[u]["sch"] = SCH[u]

data = {"rows": out, "unis": unis, "cities": GEO, "payChecked": PAY.get("_checked"), "schChecked": SCH.get("_checked")}

# Allowlist for api/refresh.js: the only pages the live refresher will fetch, grouped by university.
sources = {}
for r in rows:
    if r.get("url") and r["url"] not in sources.setdefault(r["u"], []): sources[r["u"]].append(r["url"])
with open(os.path.join(HERE, "..", "api", "_lib", "sources.js"), "w") as f:
    f.write("// Generated by scripts/build_data.py — course pages /api/refresh may fetch, per university.\n")
    f.write("export default " + json.dumps(sources, ensure_ascii=False, indent=1) + ";\n")
with open(os.path.join(HERE, "..", "js", "data.js"), "w") as f:
    f.write("// Generated by scripts/build_data.py — edit masters_rows.json or the script, then re-run.\n")
    f.write("window.UNIDATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(len(out), "rows,", len(unis), "universities,", sum(map(len, sources.values())), "source pages")
