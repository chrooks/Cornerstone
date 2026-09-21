# Research prototype for #17, 2026-09-21; port reference only, not imported by the app
"""Join the SPEC-round offense and defense classifiers (D22: main + at most one second role per end). READ-ONLY.
Runs both demo() suites, then the cross-end checks, then writes archetypes.json, anchor_table.md and report.txt.
Run: /home/chrooks/projects/cornerstone/backend/venv/bin/python archetypes.py"""
import collections, json, os
import offense as o
import defense as d

HERE = os.path.dirname(os.path.abspath(__file__)) + "/"

ACT = ["Derrick White", "Andre Drummond", "Nikola Jokić", "Karl-Anthony Towns", "Draymond Green", "Giannis Antetokounmpo",
       "Victor Wembanyama", "OG Anunoby", "Scottie Barnes", "Evan Mobley", "Luka Dončić", "Jalen Brunson", "Stephen Curry",
       "LeBron James", "Shai Gilgeous-Alexander", "Cade Cunningham", "Trae Young", "Anthony Edwards", "Kristaps Porziņģis",
       "Dejounte Murray", "Lauri Markkanen", "Michael Porter Jr.", "Rudy Gobert", "Bam Adebayo", "Alperen Sengun",
       "Jrue Holiday", "Mikal Bridges", "Josh Hart", "Chet Holmgren", "Domantas Sabonis", "Anthony Davis", "Tyler Herro"]
LEG = ["Michael Jordan", "Anthony Davis", "Magic Johnson", "Kobe Bryant", "Hakeem Olajuwon", "Dirk Nowitzki", "Steve Nash",
       "Karl Malone"]


def join():
    off = o.demo()
    df = d.load()
    dres, cuts = d.run(df)
    d.demo(dres, df, cuts)
    dd = {(x["name"], x["is_legend"]): x for x in dres}
    rows = []
    for r in off:
        x = dd[(r["name"], r["is_legend"])]
        rows.append({"name": r["name"], "is_legend": r["is_legend"], "off": r["off"], "off2": r["off2"],
                     "off_rule": r["rule_off"], "family": r["family"], "off_conf": r["conf"], "def": x["role"],
                     "def2": x["second"], "def_why": x["why"], "def_why2": x["why2"], "def_tag": x["tag"],
                     "size": x["size"], "ringer": x["ringer"]})
    return rows


def checks(rows):
    assert len(rows) == len({(r["name"], r["is_legend"]) for r in rows}) == 437
    for r in rows:
        # one main + at most one second per end; a second never exists without a main, never repeats it
        for m, s in ((r["off"], r["off2"]), (r["def"], r["def2"])):
            assert s is None or (m and s != m), r["name"]
        # the two ends never borrow each other's labels
        assert not {r["off"], r["off2"]} & (set(d.READS) | {d.NEUTRAL}), r["name"]
        assert not {r["def"], r["def2"]} & set(o.ROLES), r["name"]
    # every legend has both ends; no legend is Empty State on either end
    assert all(r["off"] and r["def"] for r in rows if r["is_legend"])


def label(m, s):
    return (m or "Empty State") + (f" (+ {s})" if s else "")


def anchor_table(rows):
    by = {(r["name"], r["is_legend"]): r for r in rows}
    L = ["| # | Player | Offense main (+ second) | Defense main (+ second) | Note |", "|---|---|---|---|---|"]
    for i, key in enumerate([(n, False) for n in ACT] + [(n, True) for n in LEG], 1):
        r = by[key]
        note = []
        if r["off"] != r["off_rule"]:
            note.append(f"offense override; rules say {r['off_rule']}")
        if r["off"] == "Volume scorer":
            note.append(f"family {r['family'].split()[-1]}")
        if r["def_tag"] not in ("ok", "TIERS (legend)"):
            note.append(r["def_tag"])
        L.append(f"| {i} | {r['name']}{' (legend)' if r['is_legend'] else ''} | {label(r['off'], r['off2'])} | "
                 f"{label(r['def'], r['def2'])} | {'; '.join(note)} |")
    return "\n".join(L)


def counts(rows):
    L = []
    for leg, nm in ((False, "ACTIVES"), (True, "LEGENDS")):
        g = [r for r in rows if r["is_legend"] == leg]
        pe_m = sum(r["def"] == "Possession ender" for r in g)
        pe_s = sum(r["def2"] == "Possession ender" for r in g)
        L.append(f"{nm} {len(g)}: second offense role {sum(bool(r['off2']) for r in g)}, second defense role "
                 f"{sum(bool(r['def2']) for r in g)}, both ends {sum(bool(r['off2'] and r['def2']) for r in g)}; "
                 f"Possession ender {pe_m + pe_s} (main {pe_m}, second {pe_s}); Neutral Defender {sum(r['def'] == d.NEUTRAL for r in g)}; "
                 f"defense Empty State {sum(r['def'] is None for r in g)}; offense Empty State {sum(r['off'] is None for r in g)}")
        L.append(f"  offense mains: " + ", ".join(f"{k} {v}" for k, v in collections.Counter(r["off"] for r in g).most_common()))
        L.append(f"  offense seconds: " + ", ".join(f"{k} {v}" for k, v in collections.Counter(r["off2"] for r in g if r["off2"]).most_common()))
        L.append(f"  defense mains: " + ", ".join(f"{k or 'Empty State'} {v}" for k, v in collections.Counter(r["def"] for r in g).most_common()))
        L.append(f"  defense seconds: " + ", ".join(f"{k} {v}" for k, v in collections.Counter(r["def2"] for r in g if r["def2"]).most_common()))
    act = [r for r in rows if not r["is_legend"]]
    neg = [r for r in act if {r["def"], r["def2"]} & d.NEGATIVE]
    L.append(f"active negatives {len(neg)} (Cone {sum('Cone' in (r['def'], r['def2']) for r in neg)}, Defensive target "
             f"{sum('Defensive target' in (r['def'], r['def2']) for r in neg)}); showable today under D21: "
             f"{sum(r['def_tag'] == 'ok' for r in neg)}; negative as a SECOND role: "
             + ", ".join(f"{r['name']} ({r['def']} + {r['def2']})" for r in rows if r["def2"] in d.NEGATIVE))
    obd2 = sum(r["def2"] == "Off-ball disruptor" for r in act)
    L.append(f"active defense seconds resting on the unreviewed off_ball_disruptor proxy: {obd2} of {sum(bool(r['def2']) for r in act)}")
    return "\n".join(L)


if __name__ == "__main__":
    rows = join()
    checks(rows)
    json.dump(rows, open(HERE + "archetypes.json", "w"), indent=1, ensure_ascii=False, default=str)
    tbl, txt = anchor_table(rows), counts(rows)
    open(HERE + "anchor_table.md", "w").write(tbl + "\n")
    open(HERE + "report.txt", "w").write(txt + "\n\nANCHOR TABLE\n" + tbl + "\n")
    print(txt + "\n\n" + tbl)
    print("all demo() and cross-end checks ok; wrote archetypes.json, anchor_table.md, report.txt")
