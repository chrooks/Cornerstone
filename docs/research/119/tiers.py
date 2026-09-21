# Research prototype for #17, 2026-09-21; port reference only, not imported by the app (round-1 loader that defense.py imports)
"""Tier-gated DEFENSE roles, round 1 (#119 Player Archetypes, defense end, D19). READ-ONLY.

D19: a defense label reads the REVIEWED defensive Skill tiers only, plus size. Deployment (matchup
difficulty, handler share), steals/deflections, rim FG% vs expected and DREB% are evidence for the
rating and the review; they never set a label here. The only stat use below is the documented PREVIEW
proxy for off_ball_disruptor, which does not exist until #152.

Inputs (cached, no network, no DB, no service imports):
  ../defense-roles/features.pkl + ../defense/sep_db.pkl   via roles2.load() (release tiers, 2025-26 evidence)
  ../defense/sep_db.pkl                                   composite profiles (tier source) + stat blobs (PD gate)
  research/ringer100.json                                  star check
Run: /home/chrooks/projects/cornerstone/backend/venv/bin/python tiers.py
-> demo() asserts; writes results.json and report.txt."""
import collections, json, os, pickle, sys
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__)) + "/"
S = HERE + "../"
sys.path.insert(0, S + "defense-roles/round2"); sys.path.insert(0, S + "defense-roles")
import roles2 as r2   # ponytail: reuse the cached loader (release tiers + p_* evidence percentiles + gate stats)

RESEARCH = "/home/chrooks/projects/cornerstone/.tasks/119-3d-archetypes/research/"
T = {None: 0, "None": 0, "Capable": 1, "Proficient": 2, "Elite": 3, "All-Time Great": 4}
NAME = {v: k for k, v in T.items() if k}
C, P, E = 1, 2, 3

# ---- size (portable): listed height, plus a listed C ----
GUARD_MAX_IN = 77        # 6'5" and under
BIG_MIN_IN = 82          # 6'10" and over, or C in the listed position

# ---- role bars (tiers) ----
BAR = {"Anchor": P, "Point of attack": P, "Off-ball disruptor": P, "Switchable": P}   # one bar: his best core defensive Skill at Proficient+
ASSIGN_MIN = P           # Assignment defender: on-ball AND versatility both at least Proficient, wing size (no grade step)
ENDER_MIN = E            # Possession ender: fallback role, rebounder Elite+
PRIORITY = ["Anchor", "Assignment defender", "Point of attack", "Switchable", "Off-ball disruptor"]  # tie order

# ---- read gates (actives) ----
READ_MIN = 500                   # below: no 2025-26 read (tiers still name a positive role: TIERS)
FULL_MIN, FULL_GP = 1000, 30     # a neutral (Help) or negative claim needs a full read
RP_GATE_PER_G = 4.0              # rim_protector's own volume gate (defended rim FGA per game)
OBD_NONE_BAND = 25               # PREVIEW: OBD None = bottom quartile of full-read hands (the proposed 'liability' band)

NEGATIVE = {"Cone", "Defensive target"}


def inches(h):
    try:
        f, i = str(h).split("-")
        return int(f) * 12 + int(i)
    except (ValueError, AttributeError):
        return np.nan


def size_class(pos, ht):
    if "C" in str(pos or "") or (not np.isnan(ht) and ht >= BIG_MIN_IN):
        return "big"
    return "guard" if (not np.isnan(ht) and ht <= GUARD_MAX_IN) else "wing"


# ------------------------------------------------------------------------------------ the rule
def classify(t, size, rated, full_read):
    """t: {'rp','poa','obd','vd','rb'} tier ints (None = unknown). size: guard|wing|big.
    rated: {key: bool} - the None is a rating (gate cleared on a full read), not missing data.
    full_read: bool. Returns (role or None, why)."""
    g = lambda k: t.get(k) or 0
    cands = []   # (strength, priority index, role, why)
    if g("rp") >= BAR["Anchor"]:
        cands.append((g("rp"), "Anchor", f"rim_protector {NAME[g('rp')]}"))
    if size == "wing" and min(g("poa"), g("vd")) >= ASSIGN_MIN:
        cands.append((max(g("poa"), g("vd")), "Assignment defender",
                      f"point_of_attack_defender {NAME[g('poa')]} + versatile_defender {NAME[g('vd')]}, wing size"))
    if size != "big" and g("poa") >= BAR["Point of attack"]:   # a perimeter job; a big's on-ball skill shows as Switchable
        cands.append((g("poa"), "Point of attack", f"point_of_attack_defender {NAME[g('poa')]}"))
    if g("vd") >= BAR["Switchable"]:
        cands.append((g("vd"), "Switchable", f"versatile_defender {NAME[g('vd')]}"))
    if g("obd") >= BAR["Off-ball disruptor"]:
        cands.append((g("obd"), "Off-ball disruptor", f"off_ball_disruptor {NAME[g('obd')]}"))
    if cands:   # his best defensive Skill names the role; a tie goes to the earlier role in PRIORITY
        s, role, why = max(cands, key=lambda c: (c[0], -PRIORITY.index(c[1])))
        return role, why
    if g("rb") >= ENDER_MIN:
        return "Possession ender", f"rebounder {NAME[g('rb')]} (no other defensive Skill at the role bar)"
    if not full_read:
        return None, "Empty State: no specialist tier, and a neutral or negative label needs a full read"
    if size != "big" and all(t.get(k) == 0 and rated.get(k) for k in ("poa", "obd")):
        return "Cone", "rated None on point_of_attack_defender AND off_ball_disruptor"
    if size == "big" and t.get("rp") == 0 and rated.get("rp") and g("vd") <= C:
        return "Defensive target", "rated None on rim_protector; versatile_defender Capable or lower"
    peak = max(("rp", "poa", "obd", "vd", "rb"), key=g)
    return "Help defender", f"no defensive Skill at a role bar; best is {peak} {NAME.get(g(peak), 'None')}"


# ------------------------------------------------------------------------------------ preview data
def load():
    df = r2.load()
    players, stats, profs = pickle.load(open(S + "defense/sep_db.pkl", "rb"))
    nba_of = {x["id"]: x["nba_api_id"] for x in players}
    blob = {}
    for row in sorted(stats, key=lambda r: r["fetched_at"]):
        if nba_of.get(row["player_id"]):
            blob[int(nba_of[row["player_id"]])] = row["stats"]
    bv = lambda i, sec, k: np.nan if i is None or i != i else ((blob.get(int(i)) or {}).get(sec) or {}).get(k, np.nan)
    df["defl_g"] = df.nba_id.map(lambda i: bv(i, "tracking_defense", "deflections")).astype(float)
    df["stl_pct"] = df.nba_id.map(lambda i: bv(i, "advanced", "stl_pct")).astype(float)
    pid = {}
    for x in players:
        pid.setdefault(x["name"], x["id"])
    prof = {x["player_id"]: x["profile"] for x in profs}
    df["pd_source"] = df.name.map(lambda n: ((prof.get(pid.get(n)) or {}).get("perimeter_disruptor") or {}).get("source"))
    ringer = json.load(open(RESEARCH + "ringer100.json"))["players"]
    rk = {p["db_name"]: p["rank"] for p in ringer}
    df["ringer"] = [None if l else rk.get(n) for n, l in zip(df.name, df.is_legend)]
    return df


def obd_cuts(df):
    """PREVIEW proxy for off_ball_disruptor: steals+deflections per 36 percentile mapped to tiers.
    This is the likely STAT tier of the #152 off-ball rule, before Claude and review; review moves some.
    Top cuts: quantile match to today's PD Proficient/Elite/ATG shares. None: the bottom OBD_NONE_BAND percent only,
    because a None that feeds a negative label must mean 'a liability at this job', not 'not notable'."""
    full = df[~df.is_legend & (df.MIN >= FULL_MIN) & (df.GP >= FULL_GP) & df.p_hands.notna()]
    share = full.skills.map(lambda s: T[s["perimeter_disruptor"]]).value_counts(normalize=True)
    cuts, above = {}, 0.0
    for tier in (4, 3, 2):    # the top end mirrors today's PD scarcity, so Off-ball disruptor is as rare as PD Proficient+
        above += share.get(tier, 0.0)
        cuts[tier] = float(np.quantile(full.p_hands, 1 - above))
    cuts[1] = float(np.quantile(full.p_hands, OBD_NONE_BAND / 100))   # None = the bottom band only (liability scale)
    return cuts, share.sort_index().to_dict()


def preview_inputs(r, cuts):
    """-> (tiers, rated, full_read, size, note). Legends: curated tiers (a None is a judgment)."""
    sk = r["skills"]
    size = size_class(r["position"], inches(r["height"]))
    pd_t = T[sk["perimeter_disruptor"]]
    t = {"rp": T[sk["rim_protector"]], "vd": T[sk["versatile_defender"]], "rb": T[sk["rebounder"]], "poa": pd_t}
    if r["is_legend"]:
        t["obd"] = pd_t   # PREVIEW: no legend OBD tier until the #152 legend pass; the folded PD tier covers both halves
        return t, {k: True for k in t}, True, size, "legend: curated tiers; OBD = PD until the #152 legend pass"
    has_read = not pd.isna(r["MIN"]) and r["MIN"] >= READ_MIN
    full = has_read and r["MIN"] >= FULL_MIN and r["GP"] >= FULL_GP
    h = r["p_hands"]
    t["obd"] = None if (not has_read or pd.isna(h)) else next((k for k in (4, 3, 2, 1) if h >= cuts[k]), 0)
    rim_g = r["rim_fga_g"] if not pd.isna(r["rim_fga_g"]) else np.nan
    rated = {
        "poa": full,   # PD's gate is an activity floor (deflections/g, STL%), not a sample gate: on a full read its None is a rating
        "obd": full and t["obd"] is not None,
        "rp": full and not pd.isna(rim_g) and rim_g >= RP_GATE_PER_G,
        "vd": full, "rb": full,
    }
    note = "ok" if full else ("LOW read" if has_read else "no 2025-26 read")
    return t, rated, full, size, note


def run():
    df = load()
    cuts, share = obd_cuts(df)
    out = []
    for _, r in df.iterrows():
        t, rated, full, size, note = preview_inputs(r, cuts)
        role, why = classify(t, size, rated, full)
        tag = "TIERS" if r["is_legend"] else ("ok" if full else ("TIERS, no read" if note == "no 2025-26 read" else "TIERS, LOW read"))
        ev = {k: (None if pd.isna(r.get(k)) else round(float(r[k]), 1)) for k in
              ("MIN", "GP", "p_handler_share", "p_matchup_difficulty", "p_hands", "p_rim_pm", "rim_fga", "rim_fga_g", "p_dreb_pct", "defl_g")}
        out.append({"name": r["name"], "is_legend": bool(r["is_legend"]), "role": role, "why": why, "tag": tag,
                    "size": size, "position": r["position"], "height": r["height"], "ringer": r["ringer"],
                    "tiers": {k: (NAME.get(v, "None") if v is not None else "unknown") for k, v in t.items()},
                    "rated": rated, "pd_source": r.get("pd_source"), "evidence": ev})
    return out, cuts, share


def demo(res):
    by = {(x["name"], x["is_legend"]): x for x in res}
    a = lambda n, legend=False: by[(n, legend)]["role"]
    # the rule itself (synthetic cases): tiers decide, size splits, ties, negatives need RATED Nones
    none = {k: False for k in ("rp", "poa", "obd", "vd", "rb")}
    rated = {k: True for k in none}
    z = dict(rp=0, poa=0, obd=0, vd=0, rb=0)
    assert classify({**z, "rp": E, "vd": E}, "big", rated, True)[0] == "Anchor"                      # tie -> Anchor
    assert classify({**z, "poa": P, "vd": E}, "wing", rated, True)[0] == "Assignment defender"       # OG shape
    assert classify({**z, "poa": E, "vd": E}, "guard", rated, True)[0] == "Point of attack"          # guard: no Assignment
    assert classify({**z, "poa": E, "obd": E}, "guard", rated, True)[0] == "Point of attack"         # on-ball wins a tie
    assert classify({**z, "poa": P, "vd": P}, "big", rated, True)[0] == "Switchable"                 # no Point of attack for bigs
    assert classify({**z, "poa": C, "obd": P}, "guard", rated, True)[0] == "Off-ball disruptor"      # strictly above on-ball
    assert classify({**z, "rp": E, "rb": 4}, "big", rated, True)[0] == "Anchor"                      # rebounding never outranks a role
    assert classify({**z, "vd": C, "rb": 4}, "wing", rated, True)[0] == "Possession ender"
    assert classify({**z, "vd": P, "rb": 4}, "wing", rated, True)[0] == "Switchable"                # a core Skill at the bar beats rebounding
    assert classify(z, "guard", rated, True)[0] == "Cone"
    assert classify(z, "guard", {**rated, "obd": False}, True)[0] == "Help defender"                 # gated None is no evidence
    assert classify(z, "guard", rated, False)[0] is None                                              # no full read -> Empty State
    assert classify(z, "big", rated, True)[0] == "Defensive target"
    assert classify(z, "big", {**rated, "rp": False}, True)[0] == "Help defender"
    # preview anchors that must hold
    for n in ("Victor Wembanyama", "Rudy Gobert", "Evan Mobley", "Chet Holmgren", "Jaren Jackson Jr."):
        assert a(n) == "Anchor", (n, a(n))
    for n in ("OG Anunoby", "Scottie Barnes", "Mikal Bridges", "Herbert Jones"):
        assert a(n) == "Assignment defender", (n, a(n))
    for n in ("Jrue Holiday", "Luguentz Dort", "Cason Wallace", "Alex Caruso", "Marcus Smart"):
        assert a(n) == "Point of attack", (n, a(n))
    assert a("Shai Gilgeous-Alexander") == "Point of attack" and a("Kawhi Leonard") == "Assignment defender"   # D19: no team context
    assert a("Karl-Anthony Towns") == "Possession ender" and a("Stephen Curry") == "Help defender"
    assert a("Bam Adebayo") == "Switchable" and a("Nikola Jokić") in ("Possession ender", "Off-ball disruptor")
    assert a("Trae Young") is None                                           # 384 min: Empty State, never Cone
    for n in ("Jalen Brunson", "Tyler Herro", "Zach LaVine", "Devin Booker"):
        assert a(n) == "Cone", (n, a(n))
    assert a("Bill Russell", True) == a("Hakeem Olajuwon", True) == a("Tim Duncan", True) == "Anchor"
    assert a("Kareem Abdul-Jabbar", True) == "Anchor"                         # rebounder ATG must not outrank rp Elite
    assert a("Scottie Pippen", True) == a("Michael Jordan", True) == "Assignment defender"
    assert a("Steve Nash", True) == "Cone"
    # negatives never stand on a gated or missing None
    for x in res:
        if x["role"] in NEGATIVE and not x["is_legend"]:
            assert x["tag"] == "ok", x["name"]
            keys = ("poa", "obd") if x["role"] == "Cone" else ("rp",)
            assert all(x["rated"][k] and x["tiers"][k] == "None" for k in keys), x["name"]
    # D19 guard: scrambling every deployment/quality evidence column leaves every active's role unchanged
    df = load(); cuts, _ = obd_cuts(df)
    rng = np.random.default_rng(0)
    for _, r in df[~df.is_legend].iterrows():
        t, rt, f, sz, _ = preview_inputs(r, cuts)
        base = classify(t, sz, rt, f)[0]
        s = r.copy()
        for c in ("p_handler_share", "p_matchup_difficulty", "p_rim_pm", "p_dreb_pct", "rim_fga"):
            s[c] = float(rng.uniform(0, 100))
        t, rt, f, sz, _ = preview_inputs(s, cuts)
        assert classify(t, sz, rt, f)[0] == base, r["name"]
    assert all(x["role"] for x in res if x["is_legend"]), "every legend gets a role"


def sensitivity():
    """Counts per knob (actives): Help share, Cone count, Ringer top-50 Help, Switchable count."""
    global OBD_NONE_BAND
    rows, keep = [], (dict(BAR), OBD_NONE_BAND)
    for label, bar, band in [("draft", {}, 25), ("Switchable bar Elite", {"Switchable": E}, 25),
                             ("Anchor bar Elite", {"Anchor": E}, 25), ("OBD None band p20", {}, 20),
                             ("OBD None band p33", {}, 33), ("OBD None = PD scale (56%)", {}, 56.5)]:
        BAR.update(bar); OBD_NONE_BAND = band
        res, _, _ = run()
        act = [x for x in res if not x["is_legend"]]
        c = collections.Counter(x["role"] for x in act)
        top = sum(1 for x in act if x["ringer"] and x["ringer"] <= 50 and x["role"] == "Help defender")
        rows.append(f"{label:28s} Help {c['Help defender']} ({100 * c['Help defender'] / len(act):.0f}%), Cone {c['Cone']}, "
                    f"Switchable {c['Switchable']}, Anchor {c['Anchor']}, Empty {c[None]}, Ringer-top-50 Help {top}")
        BAR.clear(); BAR.update(keep[0]); OBD_NONE_BAND = keep[1]
    return "\n".join(rows)


ANCHORS = [("Thinkies", n) for n in ("Derrick White", "Cason Wallace", "Ausar Thompson", "Luguentz Dort", "Alex Caruso",
            "Dyson Daniels", "Amen Thompson", "Jaden McDaniels", "Marcus Smart", "Toumani Camara")] + \
          [("Big", n) for n in ("Victor Wembanyama", "Rudy Gobert", "Evan Mobley", "Bam Adebayo", "Jaren Jackson Jr.",
            "Chet Holmgren", "Nikola Jokić", "Alperen Sengun", "Karl-Anthony Towns", "Kristaps Porziņģis", "Brook Lopez")] + \
          [("Wing/star", n) for n in ("OG Anunoby", "Scottie Barnes", "Mikal Bridges", "Herbert Jones", "Jrue Holiday",
            "Shai Gilgeous-Alexander", "Kawhi Leonard")] + \
          [("Known poor", n) for n in ("Trae Young", "Stephen Curry", "Jalen Brunson", "James Harden", "Tyler Herro",
            "Zach LaVine", "Devin Booker")] + \
          [("Legend", n) for n in ("Bill Russell", "Hakeem Olajuwon", "Tim Duncan", "Scottie Pippen", "Michael Jordan",
            "Steve Nash", "Magic Johnson", "Kobe Bryant")]
AB = {"rp": "rim", "poa": "POA", "obd": "OBD", "vd": "VD", "rb": "reb"}


def anchor_table(res):
    by = {(x["name"], x["is_legend"]): x for x in res}
    out = ["| # | Player | Group | Preview role | Tiers read (rim/POA*/OBD*/VD/reb) | Evidence for review (not an input) | Tag |",
           "|---|---|---|---|---|---|---|"]
    for i, (grp, n) in enumerate(ANCHORS, 1):
        x = by[(n, grp == "Legend")]
        t = "/".join(x["tiers"][k][:4] if x["tiers"][k] != "All-Time Great" else "ATG" for k in AB)
        e = x["evidence"]
        ev = "curated" if x["is_legend"] else (
            f"{e['MIN'] or 0:.0f} min; handler p{e['p_handler_share'] or 0:.0f}, difficulty p{e['p_matchup_difficulty'] or 0:.0f}, "
            f"hands p{e['p_hands'] or 0:.0f}, rim p{e['p_rim_pm'] or 0:.0f}, DREB p{e['p_dreb_pct'] or 0:.0f}")
        out.append(f"| {i} | {n} | {grp} | {x['role'] or 'Empty State'} | {t} ({x['size']}) | {ev} | {x['tag']} |")
    return "\n".join(out)


def review_queues(res):
    """D19 flow: evidence never sets a label; it flags a tier for Claude's informed rating + Chris's review."""
    act = [x for x in res if not x["is_legend"] and x["tag"] == "ok"]
    e = lambda x, k: x["evidence"][k] if x["evidence"][k] is not None else -1
    poa_up = [x["name"] for x in act if T[x["tiers"]["poa"]] <= C and max(e(x, "p_handler_share"), e(x, "p_matchup_difficulty")) >= 90]
    poa_dn = [x["name"] for x in act if T[x["tiers"]["poa"]] >= E and max(e(x, "p_handler_share"), e(x, "p_matchup_difficulty")) < 60]
    rim_up = [x["name"] for x in act if T[x["tiers"]["rp"]] <= C and e(x, "p_rim_pm") >= 90 and e(x, "rim_fga") >= 200]
    gate_cones = [x["name"] for x in act if x["role"] == "Cone" and (e(x, "defl_g") < 1.0)]
    return (f"POA proxy low (<=Capable) but on-ball deployment >= p90 -> review up? ({len(poa_up)}): {poa_up}\n"
            f"POA proxy Elite+ but deployment < p60 -> keep (deployment is the coach's choice) ({len(poa_dn)}): {poa_dn}\n"
            f"rim_protector <= Capable but rim FG% vs expected >= p90 on 200+ rim FGA -> review up ({len(rim_up)}): {rim_up}\n"
            f"Cones whose POA None failed PD's activity gate (<1.0 deflections/g) ({len(gate_cones)}): {gate_cones}")


def twins(res):
    act = {x["name"]: x["role"] for x in res if not x["is_legend"]}
    return ", ".join(f"{x['name']}: active {act[x['name']] or 'Empty'} / legend {x['role']}"
                     for x in res if x["is_legend"] and x["name"] in act)


def report(res, cuts, share):
    L = []
    act = [x for x in res if not x["is_legend"]]
    leg = [x for x in res if x["is_legend"]]
    L.append(f"OBD proxy cuts (hands percentile): {{{', '.join(f'{NAME[k]}: p{v:.1f}' for k, v in cuts.items())}}}; "
             f"PD tier shares among full-read actives: {{{', '.join(f'{NAME[k]}: {v:.3f}' for k, v in share.items())}}}")
    for grp, name in ((act, "ACTIVES"), (leg, "LEGENDS")):
        c = collections.Counter(x["role"] for x in grp)
        L.append(f"{name} {len(grp)}: " + ", ".join(f"{k or '(Empty State)'} {v} ({100 * v / len(grp):.0f}%)" for k, v in c.most_common()))
    tagc = collections.Counter((x["role"] is not None, x["tag"]) for x in act)
    L.append("active tags (has role, tag): " + str(sorted(tagc.items())))
    for top in (10, 25, 50):
        c = collections.Counter(x["role"] for x in act if x["ringer"] and x["ringer"] <= top)
        L.append(f"Ringer top {top}: " + ", ".join(f"{k or '(Empty State)'} {v}" for k, v in c.most_common()))
    return "\n".join(L)


if __name__ == "__main__":
    res, cuts, share = run()
    demo(res)
    json.dump({"cuts": cuts, "players": res}, open(HERE + "results.json", "w"), indent=1, ensure_ascii=False, default=str)
    df = load(); full = df[~df.is_legend & (df.MIN >= FULL_MIN) & (df.GP >= FULL_GP)]
    rho = full.skills.map(lambda s: T[s["perimeter_disruptor"]]).rank().corr(full.p_hands.rank())   # Spearman, no scipy
    txt = (report(res, cuts, share) + f"\nSpearman(POA proxy = PD tier, hands) among full-read actives: {rho:.2f}"
           + "\n\nSENSITIVITY\n" + sensitivity() + "\n\nREVIEW QUEUES (evidence -> rating, never -> label)\n" + review_queues(res)
           + "\n\nTWINS\n" + twins(res) + "\n\nANCHOR TABLE\n" + anchor_table(res))
    open(HERE + "report.txt", "w").write(txt + "\n")
    print(txt)
    print("demo() ok; wrote results.json, report.txt")
