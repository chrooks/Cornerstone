# Research prototype for #17, 2026-09-21; port reference only, not imported by the app
"""Tier-gated DEFENSE roles, SPEC round (#119 Player Archetypes, defense end). READ-ONLY.
Copy of ../defense-tiers/r2/tiers2.py (round 2; its docstring lists F1-F9, all kept) with the 2026-09-21 decisions:

  D22  a MAIN role plus at most ONE second role. Every role is ranked once:
         1. the five core roles (Anchor, Assignment defender, Point-of-attack defender, Switchable, Off-ball disruptor),
            highest tier first, a tie by the round-2 list (rim roles lead a tie only at Elite+);
         2. Possession ender (rebounder Elite+), always below every core role ('a less important part of defense');
         3. the negative (Cone for guards/wings, Defensive target for bigs), on the round-2 strict bar.
       main = the first role in that ranking. second = the next role in it that reads a DIFFERENT Skill (so
       Assignment defender never gets Point-of-attack or Switchable as a second: it already reads both Skills).
       Each role keeps its OWN bar; nothing is lowered for a second slot.
  Negatives: a negative needs all four core Skills at None, so no core role can sit next to it. The only role that
       can co-exist with it is Possession ender, and then both show (Drummond: Possession ender + Defensive target).
       Rebounder is never read by the negative bar, so a rebound tier can never hide or create a negative.
  Possession ender returns (Chris reversed the drop): rebounder Elite+, stats-only, trusted as rated. It names a
       role on a low read, like every positive role.
  D20  the neutral default is 'Neutral Defender', shown only when no role applies (main or second) on a full read.
  D21  a negative needs a None Chris reviewed on its claim Skills. The preview still names negatives on the proxies
       and tags each 'pending review (D21)'; the count that could show today is reported.
Proxies (until #152): point_of_attack_defender = reviewed perimeter_disruptor tier; off_ball_disruptor = steals +
deflections per 36 percentile; rim_protector = proposed quality rule. Inputs are the cached round-2 pickles/JSON only:
no network, no DB, no service imports.
Run: /home/chrooks/projects/cornerstone/backend/venv/bin/python defense.py -> demo() asserts, writes defense_results.json"""
import collections, json, os, pickle, sys
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__)) + "/"
S = HERE + "../"
sys.path.insert(0, S + "defense-tiers")
import tiers as t1   # ponytail: reuse the round-1 loader (release tiers, evidence percentiles, PD source, Ringer rank)

T, NAME = t1.T, t1.NAME
C, P, E, A = 1, 2, 3, 4

KEYS = ("poa", "obd", "vd", "rp")          # the four core Skills. rebounder ("rb") names only Possession ender, never a negative

# ---- size (portable): listed height + weight ----
GUARD_MAX_IN = 77                  # 6'5" and under
BIG_MIN_IN = 82                    # 6'10" and over
HEAVY_MIN_IN, HEAVY_LB = 80, 240   # or 6'8"+ at 240 lb+ (Bam, Jarrett Allen, Robert Williams, Isaiah Stewart)

# ---- role bars ----
BAR = P                            # every positive role: its Skill at Proficient or higher
RIM_TIE_MIN = E                    # Anchor wins a tie only at Elite+
PRIORITY_HI = ["Anchor", "Assignment defender", "Point-of-attack defender", "Switchable", "Off-ball disruptor"]
PRIORITY_LO = ["Assignment defender", "Point-of-attack defender", "Switchable", "Anchor", "Off-ball disruptor"]
NEGATIVE = {"Cone", "Defensive target"}
PE_MIN = E                         # Possession ender: rebounder Elite+ (HIGH stats-only Skill, trusted as rated)
NEUTRAL = "Neutral Defender"       # D20: shown only when no defense role applies (main or second) on a full read
# D22: which Skills each role reads. A second role must read a Skill the main role does not (no double count).
READS = {"Anchor": {"rp"}, "Assignment defender": {"poa", "vd"}, "Point-of-attack defender": {"poa"},
         "Switchable": {"vd"}, "Off-ball disruptor": {"obd"}, "Possession ender": {"rb"},
         "Cone": set(KEYS), "Defensive target": set(KEYS)}
CLAIM = {"Cone": ("poa", "obd"), "Defensive target": ("rp", "vd")}

# ---- read gates (actives, preview) ----
READ_MIN = 500
FULL_MIN, FULL_GP = 1000, 30
RIM_SAMPLE = 150                   # season <6 ft FGA defended: a SAMPLE floor for rim FG%, never a rate or a tier input
VD_SAMPLE = 200                    # versatile_defender's own gate (season matchup possessions)
REVIEWED = {"resolved", "manual_override"}

# ---- proposed rim_protector stat rule (quality only). rim_pm = opp FG% <6 ft minus expected, in points ----
RIM_RULE = [(E, lambda pm, b: pm <= -10 and b >= 2.0),
            (P, lambda pm, b: (pm <= -7 and b >= 1.2) or (pm <= -4 and b >= 2.5)),
            (C, lambda pm, b: pm <= -3 or b >= 2.0)]

# ---- F8: stand-in legend split of the folded PD tier (POA, OBD). Chris's #152 legend pass replaces it. ----
LEGEND_SPLIT = {
    "Allen Iverson": (C, E, "3x steals leader, a passing-lane gambler; small, not a containment defender"),
    "Steph Curry": (C, P, "value came from hands and positioning, not from containing the ball"),
    "Russell Westbrook": (C, P, "gambler for steals; never an All-Defense containment guard"),
    "Isiah Thomas": (P, E, "pesky hands (1.9 steals/g); on-ball good, not elite"),
    "Kobe Bryant": (E, P, "12x All-Defense as an on-ball stopper; hands good, not his calling card"),
    "Tracy McGrady": (C, P, "length and help-side blocks; not a known stopper"),
}


def inches(h):
    return t1.inches(h)


def size_class(ht, wt):
    """Listed height + weight. Listed position is a team designation (D17) and is never read."""
    if not np.isnan(ht) and (ht >= BIG_MIN_IN or (ht >= HEAVY_MIN_IN and wt == wt and wt is not None and wt >= HEAVY_LB)):
        return "big"
    return "guard" if (not np.isnan(ht) and ht <= GUARD_MAX_IN) else "wing"




# ------------------------------------------------------------------------------------------ the rule
def ranked_roles(t, size, rated, full_read):
    """Every role whose OWN bar he clears, in D22 rank order: [(role, why)]."""
    g = lambda k: t.get(k) or 0
    cands = []
    if g("rp") >= BAR:
        cands.append((g("rp"), "Anchor", f"rim_protector {NAME[g('rp')]}"))
    if size == "wing" and min(g("poa"), g("vd")) >= BAR:
        cands.append((max(g("poa"), g("vd")), "Assignment defender",
                      f"point_of_attack_defender {NAME[g('poa')]} + versatile_defender {NAME[g('vd')]}, wing size"))
    if size != "big" and g("poa") >= BAR:
        cands.append((g("poa"), "Point-of-attack defender", f"point_of_attack_defender {NAME[g('poa')]}"))
    if g("vd") >= BAR:
        cands.append((g("vd"), "Switchable", f"versatile_defender {NAME[g('vd')]}"))
    if g("obd") >= BAR:
        cands.append((g("obd"), "Off-ball disruptor", f"off_ball_disruptor {NAME[g('obd')]}"))
    # highest tier first; a tie by one fixed list (rim roles lead a tie only at Elite+)
    rank = lambda c: (-c[0], (PRIORITY_HI if c[0] >= RIM_TIE_MIN else PRIORITY_LO).index(c[1]))
    out = [(role, why) for _, role, why in sorted(cands, key=rank)]
    if g("rb") >= PE_MIN:
        out.append(("Possession ender", f"rebounder {NAME[g('rb')]}"))
    neg = "Defensive target" if size == "big" else "Cone"
    if full_read and all(g(k) == 0 for k in KEYS) and all(rated.get(k) for k in CLAIM[neg]):
        out.append((neg, f"every core defensive Skill at None; {' + '.join(CLAIM[neg])} rated None on a full read"))
    return out


def classify(t, size, rated, full_read):
    """-> (main, why, second, why2). main None = Empty State."""
    ranked = ranked_roles(t, size, rated, full_read)
    if not ranked:
        if not full_read:
            return None, "Empty State: no defensive Skill at a role bar, and the neutral chip needs a full read", None, None
        peak = max(KEYS, key=lambda k: t.get(k) or 0)
        return NEUTRAL, f"no defensive role applies; nearest {peak} {NAME.get(t.get(peak) or 0, 'None')}", None, None
    main, why = ranked[0]
    second, why2 = next(((r, w) for r, w in ranked[1:] if not READS[r] & READS[main]), (None, None))
    return main, why, second, why2


# ------------------------------------------------------------------------------------------ preview data
def load():
    df = t1.load()
    players, stats, profs = pickle.load(open(S + "defense/sep_db.pkl", "rb"))
    rel = json.load(open(S + "jkm/archetype_players.json"))
    wt = {(p["name"], p["is_legend"]): p["weight"] for p in rel}
    df["weight"] = [wt.get((n, l)) for n, l in zip(df.name, df.is_legend)]
    df["weight"] = df.weight.astype(float)
    nba_of = {x["id"]: x["nba_api_id"] for x in players}
    blob = {}
    for row in sorted(stats, key=lambda r: r["fetched_at"]):
        if nba_of.get(row["player_id"]):
            blob[int(nba_of[row["player_id"]])] = row["stats"]
    df["blk_pct"] = df.nba_id.map(lambda i: np.nan if i is None or i != i else
                                  ((blob.get(int(i)) or {}).get("advanced") or {}).get("blk_pct", np.nan)).astype(float) * 100
    pid = {}
    for x in players:
        pid.setdefault(x["name"], x["id"])
    prof = {x["player_id"]: x["profile"] for x in profs}
    src = lambda n, k: ((prof.get(pid.get(n)) or {}).get(k) or {}).get("source")
    df["vd_source"] = df.name.map(lambda n: src(n, "versatile_defender"))
    df["rp_source"] = df.name.map(lambda n: src(n, "rim_protector"))
    return df


def obd_cuts(df):
    """PREVIEW off_ball_disruptor = steals + deflections per 36 percentile, cut at today's PD tier shares among
    full-read actives (F9: one None meaning, 'not notable'). It is a stat tier; no Claude, no review."""
    full = df[~df.is_legend & (df.MIN >= FULL_MIN) & (df.GP >= FULL_GP) & df.p_hands.notna()]
    share = full.skills.map(lambda s: T[s["perimeter_disruptor"]]).value_counts(normalize=True)
    cuts, above = {}, 0.0
    for tier in (4, 3, 2, 1):
        above += share.get(tier, 0.0)
        cuts[tier] = float(np.quantile(full.p_hands, 1 - above))
    return cuts, share.sort_index().to_dict()


def rim_tier(pm_pts, blk):
    return next((tier for tier, f in RIM_RULE if f(pm_pts, blk)), 0)


def preview_inputs(r, cuts):
    """-> (tiers, rated, full_read, size, status). status per key: reviewed | agreed | stat | curated | unknown."""
    sk = r["skills"]
    size = size_class(inches(r["height"]), r["weight"])
    pd_t = T[sk["perimeter_disruptor"]]
    t = {"vd": T[sk["versatile_defender"]], "rp": T[sk["rim_protector"]], "poa": pd_t, "rb": T[sk["rebounder"]]}
    if r["is_legend"]:
        poa, obd, _ = LEGEND_SPLIT.get(r["name"], (pd_t, pd_t, ""))
        t.update(poa=poa, obd=obd)
        st = {k: "curated" for k in KEYS}
        if r["name"] not in LEGEND_SPLIT:
            st["obd"] = "curated (PD fold)"
        return t, {k: True for k in KEYS}, True, size, st
    has_read = not pd.isna(r["MIN"]) and r["MIN"] >= READ_MIN
    full = bool(has_read and r["MIN"] >= FULL_MIN and r["GP"] >= FULL_GP)
    h = r["p_hands"]
    t["obd"] = None if (not has_read or pd.isna(h)) else next((k for k in (4, 3, 2, 1) if h >= cuts[k]), 0)
    rim_n = 0 if pd.isna(r["rim_fga"]) else r["rim_fga"]
    rim_ok = rim_n >= RIM_SAMPLE and not pd.isna(r["rim_pm"]) and not pd.isna(r["blk_pct"])
    if r["rp_source"] in REVIEWED:
        rp_status = "reviewed"
    elif rim_ok:
        t["rp"], rp_status = rim_tier(r["rim_pm"] * 100, r["blk_pct"]), "stat"
    else:   # under the sample floor: today's tier stands in for Claude + review; unrated, never a negative
        rp_status = "stat (today's tier, under sample floor)"
    lvl = lambda s: "reviewed" if s in REVIEWED else ("agreed" if s == "auto_accepted" else "pending")
    st = {"poa": lvl(r["pd_source"]), "obd": "stat" if t["obd"] is not None else "unknown",
          "vd": lvl(r["vd_source"]), "rp": rp_status}
    rated = {"poa": full, "obd": full and t["obd"] is not None,
             "vd": full and r["vd_poss"] >= VD_SAMPLE,
             "rp": full and (rp_status == "reviewed" or rim_ok)}
    return t, rated, full, size, st




def run(df=None, cuts=None):
    df = load() if df is None else df
    if cuts is None:
        cuts, _ = obd_cuts(df)
    out = []
    for _, r in df.iterrows():
        t, rated, full, size, st = preview_inputs(r, cuts)
        main, why, second, why2 = classify(t, size, rated, full)
        neg = next((x for x in (main, second) if x in NEGATIVE), None)
        if r["is_legend"]:
            tag = "TIERS (legend)"
        elif neg:
            unrev = [k for k in CLAIM[neg] if st[k] != "reviewed"]
            tag = "ok" if not unrev else "NEG pending review (D21): " + "+".join(unrev)
        else:
            tag = "ok" if full else ("LOW read" if not pd.isna(r["MIN"]) and r["MIN"] >= READ_MIN else "no read")
        ev = {k: (None if pd.isna(r.get(k)) else round(float(r[k]), 3 if k == "rim_pm" else 1)) for k in
              ("MIN", "GP", "p_handler_share", "p_matchup_difficulty", "p_hands", "p_rim_pm", "rim_pm", "rim_fga",
               "rim_fga_g", "blk_pct", "p_dreb_pct", "defl_g", "vd_poss")}
        out.append({"name": r["name"], "is_legend": bool(r["is_legend"]), "role": main, "why": why, "second": second,
                    "why2": why2, "tag": tag, "size": size, "position": r["position"], "height": r["height"],
                    "weight": r["weight"], "ringer": r["ringer"],
                    "tiers": {k: (NAME.get(v, "None") if v is not None else "unknown") for k, v in t.items()},
                    "rated": rated, "status": st, "full_read": full, "evidence": ev})
    return out, cuts


def neg_eligible(x):
    """Recompute the negative bar from the output row (independent of classify's ranking)."""
    neg = "Defensive target" if x["size"] == "big" else "Cone"
    ok = x["full_read"] and all(x["tiers"][k] == "None" for k in KEYS) and all(x["rated"][k] for k in CLAIM[neg])
    return neg if ok else None


# ------------------------------------------------------------------------------------------ checks
def demo(res, df, cuts):
    by = {(x["name"], x["is_legend"]): x for x in res}
    a = lambda n, legend=False: by[(n, legend)]["role"]
    two = lambda n, legend=False: (by[(n, legend)]["role"], by[(n, legend)]["second"])
    z = dict(poa=0, obd=0, vd=0, rp=0, rb=0)
    R = {k: True for k in KEYS}
    cl = lambda t, size, rated=R, full=True: classify({**z, **t}, size, rated, full)[::2]   # (main, second)
    # round-2 main-role cases (unchanged rule for the main slot)
    assert cl({"rp": E, "vd": E}, "big") == ("Anchor", "Switchable")                        # Elite tie -> rim role main
    assert cl({"rp": P, "vd": P}, "big") == ("Switchable", "Anchor")                        # Proficient tie -> Switchable main
    assert cl({"rp": P, "obd": P}, "big") == ("Anchor", "Off-ball disruptor")
    assert cl({"rp": P}, "wing")[0] == "Anchor"
    assert cl({"poa": P, "vd": E}, "wing") == ("Assignment defender", None)                 # no second from the same Skills
    assert cl({"poa": P, "vd": E, "rp": P}, "wing") == ("Assignment defender", "Anchor")    # Draymond shape
    assert cl({"poa": P, "vd": E}, "big") == ("Switchable", None)                           # a big's POA names no role
    assert cl({"poa": E, "vd": E}, "guard") == ("Point-of-attack defender", "Switchable")
    assert cl({"poa": E, "obd": P}, "guard") == ("Point-of-attack defender", "Off-ball disruptor")   # Chris's White example
    assert cl({"poa": E, "obd": E}, "guard") == ("Point-of-attack defender", "Off-ball disruptor")   # tie: on-ball main
    assert cl({"poa": C, "obd": P}, "guard") == ("Off-ball disruptor", None)
    assert cl({"poa": P, "obd": P}, "big") == ("Off-ball disruptor", None)
    # Possession ender: below every core role; main only when no core role clears its bar
    assert cl({"rp": P, "rb": A}, "big") == ("Anchor", "Possession ender")
    assert cl({"rp": P, "vd": P, "rb": A}, "big") == ("Switchable", "Anchor")               # at most one second
    assert cl({"vd": C, "rb": E}, "wing") == ("Possession ender", None)
    assert cl({"rb": P, "vd": C}, "wing") == (NEUTRAL, None)                                # Proficient is below its bar
    assert cl({"rb": P}, "wing") == ("Cone", None)                                          # ... and never blocks a negative
    assert cl({"rb": E}, "big", R, False) == ("Possession ender", None)                    # a positive role on a low read
    # negatives: strict bar, the only partner is Possession ender, and it never hides the negative
    assert cl({}, "guard") == ("Cone", None) and cl({}, "big") == ("Defensive target", None)
    assert cl({"rb": E}, "big") == ("Possession ender", "Defensive target")                 # Drummond shape
    assert cl({"rb": A}, "guard") == ("Possession ender", "Cone")
    assert cl({"rp": C}, "wing") == (NEUTRAL, None) and cl({"vd": C}, "guard") == (NEUTRAL, None)
    assert cl({"obd": C, "rb": E}, "big") == ("Possession ender", None)                     # OBD Capable blocks the target
    assert cl({}, "big", {**R, "vd": False}) == (NEUTRAL, None)                            # a gated None is no evidence
    assert cl({}, "guard", {**R, "rp": False, "vd": False}) == ("Cone", None)               # Cone's claim = POA + OBD
    assert cl({}, "guard", R, False) == (None, None)                                        # no full read -> Empty State
    assert cl({"rb": E}, "guard", {**R, "poa": False}, True) == ("Possession ender", None)
    # exhaustive sweep of the rule on every tier combination (5^5 x 3 sizes): the D22 invariants
    import itertools
    for vals in itertools.product(range(5), repeat=5):
        t = dict(zip(("poa", "obd", "vd", "rp", "rb"), vals))
        for size in ("guard", "wing", "big"):
            main, _, sec, _ = classify(t, size, R, True)
            ranked = [r for r, _ in ranked_roles(t, size, R, True)]
            assert main and (sec is None or (sec != main and not READS[sec] & READS[main])), (t, size)
            assert (main == NEUTRAL) == (not ranked)                                           # neutral only when no role
            negs = [r for r in ranked if r in NEGATIVE]
            if negs:
                assert negs[0] in (main, sec) and {main, sec} - {negs[0]} <= {"Possession ender", None}, (t, size)
            if t["rb"] >= PE_MIN and not negs and main != "Possession ender":
                assert main in PRIORITY_HI                                                     # a core role outranks rebounding
            t2 = {**t, "rb": 0}                                                                # rebounder never moves a core/negative role
            m2, _, s2, _ = classify(t2, size, R, True)
            assert {main, sec} - {"Possession ender", NEUTRAL, None} == {m2, s2} - {"Possession ender", NEUTRAL, None}, (t, size)
    # size: height + weight, never position
    assert size_class(81, 250) == "big" and size_class(81, 210) == "wing" and size_class(82, 200) == "big"
    assert size_class(77, 250) == "guard" and size_class(80, 239) == "wing"
    # anchors that must hold (preview proxies)
    for n in ("Victor Wembanyama", "Rudy Gobert", "Evan Mobley", "Chet Holmgren", "Jaren Jackson Jr.", "Brook Lopez"):
        assert a(n) == "Anchor", (n, a(n))
    assert two("Victor Wembanyama") == ("Anchor", "Switchable") and two("Evan Mobley") == ("Anchor", "Switchable")
    assert a("Bam Adebayo") == "Switchable"
    for n in ("OG Anunoby", "Scottie Barnes", "Mikal Bridges", "Herbert Jones"):
        assert a(n) == "Assignment defender", (n, a(n))
    assert two("Draymond Green") == ("Assignment defender", "Anchor")
    for n in ("Jrue Holiday", "Luguentz Dort", "Cason Wallace", "Alex Caruso", "Marcus Smart", "Derrick White"):
        assert a(n) == "Point-of-attack defender", (n, a(n))
    assert two("Derrick White") == ("Point-of-attack defender", "Switchable")   # OBD proxy None; see the report
    assert a("Trae Young") is None
    for n in ("Jalen Brunson", "Tyler Herro", "Zach LaVine"):
        assert a(n) == "Cone", (n, a(n))
    assert two("Andre Drummond") == ("Possession ender", "Defensive target")
    for n in ("Karl-Anthony Towns", "Nikola Jokić"):                              # rebounding returns; no negative to hide
        assert two(n) == ("Possession ender", None), (n, two(n))
    for n in ("Luka Dončić", "Stephen Curry", "LeBron James"):
        assert two(n) == (NEUTRAL, None), (n, two(n))
    for n in ("Julius Randle", "Sandro Mamukelashvili", "Lauri Markkanen", "Matas Buzelis", "Deni Avdija"):
        assert a(n) == NEUTRAL, (n, a(n))
    assert a("Anthony Davis") == "Anchor"
    assert a("Bill Russell", True) == a("Hakeem Olajuwon", True) == a("Tim Duncan", True) == "Anchor"
    assert a("Scottie Pippen", True) == a("Michael Jordan", True) == "Assignment defender"
    assert a("Kevin Durant", True) == "Switchable" and a("Allen Iverson", True) == "Off-ball disruptor"
    assert a("Steve Nash", True) == "Cone"
    # output invariants on every row
    for x in res:
        m, s = x["role"], x["second"]
        assert s is None or (m and s != m and not READS[s] & READS[m]), x["name"]
        neg = neg_eligible(x)
        if neg:   # never hidden: the negative shows, and its only partner is Possession ender
            assert neg in (m, s) and {m, s} - {neg} <= {"Possession ender", None}, x["name"]
        else:
            assert not {m, s} & NEGATIVE, x["name"]
        if m == NEUTRAL:
            assert s is None and x["full_read"] and T[x["tiers"]["rb"]] < PE_MIN, x["name"]
        if "Possession ender" in (m, s):
            assert T[x["tiers"]["rb"]] >= PE_MIN, x["name"]
        if m is None:
            assert not x["full_read"] and s is None, x["name"]
    # D19: scrambling every deployment column leaves every active's two roles unchanged
    base = {x["name"]: (x["role"], x["second"]) for x in res if not x["is_legend"]}
    rng = np.random.default_rng(0)
    s = df.copy()
    for c in ("p_handler_share", "p_matchup_difficulty", "handler_share", "matchup_difficulty", "team_top_share",
              "mpos", "p_dreb_pct", "dreb_pct", "rim_fga36", "p_rim_fga36", "rim_fga_g", "pos_entropy", "p_pos_entropy"):
        s[c] = rng.uniform(0, 100, len(s))
    res2, _ = run(s, cuts)
    moved = [x["name"] for x in res2 if not x["is_legend"] and base[x["name"]] != (x["role"], x["second"])]
    assert not moved, moved
    # rebounder moves only Possession ender (and Neutral Defender in its place): never a core role, never a negative
    s = df.copy()
    s["skills"] = [{**k, "rebounder": rng.choice(list(T)[1:])} for k in s.skills]
    res3, _ = run(s, cuts)
    strip = lambda p: set(p) - {"Possession ender", NEUTRAL, None}
    moved = [x["name"] for x in res3 if not x["is_legend"] and strip(base[x["name"]]) != strip((x["role"], x["second"]))]
    assert not moved, moved
    # rim volume above the sample floor never matters (tripling it changes nothing)
    s = df.copy()
    s["rim_fga"] = [v * 3 if v == v and v >= RIM_SAMPLE else v for v in s.rim_fga]
    res4, _ = run(s, cuts)
    assert all(base[x["name"]] == (x["role"], x["second"]) for x in res4 if not x["is_legend"])
    return True


def counts(res):
    L = []
    for grp, nm in (([x for x in res if not x["is_legend"]], "ACTIVES"), ([x for x in res if x["is_legend"]], "LEGENDS")):
        c = collections.Counter(x["role"] for x in grp)
        c2 = collections.Counter(x["second"] for x in grp if x["second"])
        L.append(f"{nm} {len(grp)} main: " + ", ".join(f"{k or 'Empty State'} {v}" for k, v in c.most_common()))
        L.append(f"{nm} second ({sum(c2.values())}): " + ", ".join(f"{k} {v}" for k, v in c2.most_common()))
        L.append(f"{nm} pairs: " + ", ".join(f"{m} + {s} {v}" for (m, s), v in
                                             collections.Counter((x["role"], x["second"]) for x in grp if x["second"]).most_common()))
    act = [x for x in res if not x["is_legend"]]
    neg = [x for x in act if {x["role"], x["second"]} & NEGATIVE]
    L.append(f"active negatives {len(neg)}; showable today under D21 (claim Nones reviewed): {sum(x['tag'] == 'ok' for x in neg)}")
    L.append("negative + Possession ender: " + ", ".join(f"{x['name']}{' (L)' if x['is_legend'] else ''}" for x in res
                                                        if {x['role'], x['second']} & NEGATIVE and 'Possession ender' in (x['role'], x['second'])))
    return "\n".join(L)


if __name__ == "__main__":
    df = load()
    res, cuts = run(df)
    demo(res, df, cuts)
    json.dump({"cuts": cuts, "players": res}, open(HERE + "defense_results.json", "w"), indent=1, ensure_ascii=False, default=str)
    print(counts(res))
    print("demo() ok; wrote defense_results.json")
