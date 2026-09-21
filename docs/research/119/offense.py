# Research prototype for #17, 2026-09-21; port reference only, not imported by the app
# Skill-set OFFENSE role classifier (#119 / #15), SPEC round (copy of ../jkm/skillset/classify.py, round 2). Read-only:
# reads ../jkm/skillset/players.json only (the pass-2 SELECT dump of the DEV Supabase active Snapshot Release).
#
# SPEC ROUND (2026-09-21, Decision Ledger D16 + D22 + the logged offense defaults):
#  - D22: a MAIN role plus at most ONE second role. Main = the existing rules (load rung first, then the strongest diet
#    with family-first and the list tie order), or the admin override. Second = the strongest OTHER role whose own gate
#    he clears (same bars, never lowered), skipping (a) a role from the main role's GROUP (one creation role, one
#    catch-and-shoot role: 'Primary creator + Secondary creator' says one thing twice) and (b) the Play finisher fallback
#    (it means 'no diet at its own bar', so it is main-only).
#  - 'Primary scorer/facilitator' -> 'Scorer/facilitator'. 'Transition engine' dropped (it read team pace, D17).
#  - Volume scorer's family follows his diet: a creator door (iso + PnR share, or the passing door) -> Advantage
#    creator, else the family of his strongest diet. Tiers path: creator (a tier lead reads the on-ball Skills).
#  - Admin override list (D16, no tier re-curation): Dejounte -> Secondary creator, Porzingis -> Stretch big, legend
#    MJ -> Primary creator, legend AD -> Volume scorer (never below active AD). The MJ passer re-curation is gone.
#
# PRINCIPLE (Chris, 2026-09-21): an archetype describes a player's PORTABLE SKILL SET, measured across the league,
# never his role on his current team. The Lab puts every player on a new team, so the label must stay true when he
# moves. So this file reads NO team data: no teams.json, no game log, no team lead, no share of a team's top load,
# no team transition mean, no season-end team, no traded flag. Every bar is a league bar on a per-possession or
# per-36 rate, or a curated Skill tier.
#
# Three paths, one label set.
#  - LOAD LADDER (actives with a 2025-26 row): capacity + the Creation Load Index (CLI), both league-relative.
#      capacity = usage >= LOAD_USG at LOAD_MPG+ minutes and LOAD_GP+ games.
#      CLI      = z(USG%) + z(AST%) + z(ball), ball = max(time of possession / 36, touches / 36). z against the
#                 league rotation pool (20+ mpg, 10+ GP), each z capped at Z_CAP so one extreme rate cannot carry him.
#      Primary creator = capacity + CLI >= CLI_BAR + AST% >= PRIM_AST. A capacity center who runs the offense by
#      passing is a Fulcrum playmaker (shape before scorer rung). Other capacity players read Scorer/facilitator (passing share) or Volume scorer.
#  - STATS DIET (everyone else with a usable play-type feed): WHAT he does, strength = signal / bar.
#  - TIERS (legends; actives with no 2025-26 row, 0 GP, or an unusable feed): curated Skill tiers.
#  - ADMIN OVERRIDE (last): a named label per player, shown as an override. Rules stay the source of truth.
#
# Round 2 (skeptic check on round 1): the Fulcrum gate reads per-36 touches (Nurkic); Transition engine yields to a
# half-court creator, because a transition share carries his team's pace (Quickley); a split-season play-type feed
# is flagged PARTIAL (one team's stint, not his season); Dejounte gets an admin override; MJ's passer tier has a
# proposed re-curation (legend data, Chris's call).
import collections, json, os, statistics, sys

DIR = os.path.dirname(os.path.abspath(__file__)) + "/"
DATA = DIR + "../jkm/skillset/"   # ponytail: read the round-2 players.json in place (read-only), no copy
T = {"None": 0, "Capable": 1, "Proficient": 2, "Elite": 3, "All-Time Great": 4}
C, P, E, A = 1, 2, 3, 4
MIN_GP = 25              # below this: LOW confidence (sample size is portable; it is not team context)

# ---- load ladder knobs (actives). League bars only. See sensitivity.py ----
ROT_MPG, ROT_GP = 20.0, 10   # the league rotation pool the z-scores compare against
LOAD_MPG, LOAD_GP = 24.0, 10  # a load rung needs starter minutes and a real sample (bench rates run hot vs bench units)
LOAD_USG = 0.255          # capacity: usage >= .255 (about p81 of the rotation pool; sits in the .253 -> .256 gap)
Z_CAP = 3.0
CLI_BAR = 5.2             # Primary creator: sits in the CLI gap 5.56 (Harden) -> 4.91 (Avdija), the widest from 4 to 7
PRIM_AST, PRIM_RATIO = 0.20, 0.68   # Scorer/facilitator: AST% >= .20 and AST%/USG >= .68; also PC's AST% floor

# ---- diet bars (stats path). strength = signal / bar ----
ON_BALL = 0.30                     # iso + PnR ball-handler share of possessions
CREATOR_AST = 0.25                 # ... or he creates by passing: AST% p85 with AST%/USG >= 1 (watering plants)
PULL_SH, PULL36 = 0.40, 4.5        # pull-up FGA share, pull-up FGA per 36
DRIVES36, RIM_SH = 10.0, 0.30      # drives per 36, and restricted-area FGA share (a slasher gets to the rim)
POST, POST_MAX_CS3 = 0.15, 0.20    # post-up share; a stretch big (C&S 3s >= 20% of FGA) is not a post player
CS3_SH, CS3_36, MOVING = 0.30, 3.0, 0.15             # C&S 3PA share + volume; off-screen + handoff share
FINISH, FINISH_RIM = 0.25, 0.40    # roll + cut share, rim share
OREB, PUTBACK = 0.10, 0.25         # OREB% (p90 of 15+ mpg); putback + misc share of possessions
CUT = 0.15
CONNECT_RATIO, CONNECT_USG = 1.1, 0.18   # watering plants: AST%/USG >= 1.1 at low usage, off the ball
FULC_AST, FULC_RATIO = 0.19, 0.85        # a center who passes: AST% >= .19 and AST%/USG >= .85
FULC_TCH36, FULC_POST36 = 72.0, 4.5      # ... and the offense runs through him: touches/36 (gap 68.8 Hartenstein ->
                                         # 76.9 Sengun among passing centers) and elbow + post touches/36. Per 36, so
                                         # his coach's minutes do not ride along (round 1 read per game: Nurkic).
FEED_GAP = 0.15   # play-type volume vs box-score volume (FGA + .44 FTA + TOV). NBA.com splits a traded player's play
                  # types by team and the pipeline keeps one row, so a gap means the feed holds one stint. Single-team
                  # players stay within 11.6% (D'Angelo Russell). Root fix: merge per-team rows in the pipeline.
PLAYMAKER = 3.0                    # fixed strength: playmaking roles beat shot diets
PLAYMAKING = ("Fulcrum playmaker", "Connector")

PT = ["isolation", "pr_ball_handler", "pr_roll_man", "spotup", "offscreen", "handoff", "cut", "transition", "postup"]
BIG_CORE = ("pr_roll_man", "cut", "transition")  # every rotation big has these; 2+ missing = the feed missed him

CREATOR, EXPLOITER = "Advantage creator", "Advantage exploiter"
# label -> (family, source, ladder rung)
ROLES = {
    "Primary creator": (CREATOR, "Big Board role ('Primary/supplementary creator', #7 Flemings); was 'Offensive hub'", 4),
    "Scorer/facilitator": (CREATOR, "Big Board role (glossary 'Primary')", 3),
    "Volume scorer": (CREATOR, "Big Board role", 3),
    "Secondary creator": (CREATOR, "Big Board role (absorbs 'Supplementary creator')", 2),
    "Fulcrum playmaker": (CREATOR, "Big Board role (glossary 'Playmaking hub (big)')", 1),
    "Pull-up shooter": (CREATOR, "glossary (alias 'Dribble pull-up guy'; Big Board badge 'Pull-up Threat')", 0),
    "Slasher": (CREATOR, "Big Board role", 0),
    "Traditional post player": (CREATOR, "glossary", 0),
    "Movement shooter": (EXPLOITER, "glossary + Big Board role", 0),
    "Floor spacer": (EXPLOITER, "glossary + Big Board role", 0),
    "Stretch big": (EXPLOITER, "ours (a big the Floor spacer rule catches)", 0),
    "Rim finisher": (EXPLOITER, "Big Board role (Mara; absorbs 'Lob threat', 'Roller', 'Dunker spot mainstay'); was 'Play finisher'", 0),
    "Glass eater": (EXPLOITER, "Big Board role", 0),
    "Cutter": (EXPLOITER, "Big Board role", 0),
    "Connector": (EXPLOITER, "glossary + Big Board role", 0),
    "Play finisher": (EXPLOITER, "Big Board role, forwards sense ('play finisher, at the rim or from 3'); was 'Advantage converter'", 0),
}
LOAD_ROLES = ("Primary creator", "Scorer/facilitator", "Volume scorer")
# D22 groups: a player holds at most one role per group. Every other role is its own group.
GROUP = {**{r: "creation" for r in LOAD_ROLES + ("Secondary creator",) + PLAYMAKING},
         **{r: "catch-and-shoot" for r in ("Movement shooter", "Floor spacer", "Stretch big")}}
FALLBACK = ("Play finisher",)   # main-only: it means 'no diet at its own bar'

# ADMIN OVERRIDE (D16 default, veto open): the rules stay the source of truth; the override names the MAIN role a fan
# reads, and the row says so. The second role still comes from the rules. Key = (name, is_legend).
#  - Dejounte: 14 GP after his Achilles injury, CLI 5.59 mostly from time of possession on a thin roster.
#  - Porzingis: capacity at exactly the 24.0-mpg floor with a .00 iso + PnR share; his diet is Stretch big.
#  - legend MJ: his passer tier (Capable) keeps him off the top rung; override, no tier re-curation (D16).
#  - legend AD: tiers see his finishing, not his peak load; never below active AD (Volume scorer).
OVERRIDES = {("Dejounte Murray", False): "Secondary creator", ("Kristaps Porziņģis", False): "Stretch big",
             ("Michael Jordan", True): "Primary creator", ("Anthony Davis", True): "Volume scorer"}

players = json.load(open(DATA + "players.json"))
P_BY_NAME = {p["name"]: p for p in players if not p["is_legend"]}  # actives only: legend names clash with twins
P_BY_LEGEND = {p["name"]: p for p in players if p["is_legend"]}


def _raw(st, path):
    grp, k = path.split(".")
    return ((st or {}).get(grp) or {}).get(k)


def _g(st, path):
    v = _raw(st, path)
    return v if v is not None else 0.0


def inches(h):
    try:
        f, i = str(h).split("-")
        return int(f) * 12 + int(i)
    except (ValueError, AttributeError):
        return None


def is_big(p):
    h = inches(p["height"])
    return p["position"] in ("C", "FC") or (h is not None and h >= 82)


def is_center(p):
    """Fulcrum playmaker is a center's role: position C, or 6-10+. A 6-9 FC face-up forward is not one."""
    h = inches(p["height"])
    return p["position"] == "C" or (h is not None and h >= 82)


def gp(p):
    return _g(p["stats"], "metadata.games_played")


def mpg(p):
    return _g(p["stats"], "metadata.minutes_per_game")


def has_row(p):
    """A 2025-26 row with at least one game. A 0-GP row is no data (it would divide volumes by 0 minutes)."""
    return not p["is_legend"] and bool(p["stats"]) and gp(p) > 0


def feed_state(p):
    """ok / none / unusable. Missing play types are None (below NBA.com's floor), never 0."""
    pt = (p["stats"] or {}).get("play_type") or {}
    vals = {k: pt.get(k + "_freq") for k in PT}
    if all(v is None for v in vals.values()):
        return "none", 1.0, []
    resid = 1 - sum(v for v in vals.values() if v is not None)
    missing = [k for k, v in vals.items() if v is None]
    core_missing = [k for k in BIG_CORE if vals[k] is None]
    if resid >= 0.5 and (not is_big(p) or len(core_missing) >= 2):
        return "unusable", resid, missing
    return "ok", resid, missing


# ---- league pools: ACTIVES ONLY. Legends never enter. ----
LOAD_POOL = [p for p in players if has_row(p)]


def _rates(p):
    s = p["stats"]
    per36 = 36 / mpg(p)
    return {"usg": _g(s, "advanced.usage_rate"), "ast": _g(s, "advanced.ast_pct"),
            "top36": _g(s, "tracking_possessions.time_of_possession") * per36,
            "tch36": _g(s, "tracking_possessions.touches") * per36,
            "post36": (_g(s, "tracking_elbow_touch.elbow_touches") + _g(s, "tracking_post_touch.post_touches")) * per36}


ROT_POOL, _Z = [], {}  # the league rotation pool and its (mean, sd) per rate; filled by build()


def _z(k, v):
    mu, sd = _Z[k]
    return min(Z_CAP, (v - mu) / sd)


def load_features(p):
    r = _rates(p)
    z = {k: _z(k, r[k]) for k in _Z}
    f = {"usg": r["usg"], "ast": r["ast"], "ast_usg": r["ast"] / max(r["usg"], 0.01), "z": z,
         "cli": z["usg"] + z["ast"] + max(z["top36"], z["tch36"]),
         "tch36": r["tch36"], "post36": r["post36"], "big": is_big(p)}
    f["capacity"] = gp(p) >= LOAD_GP and mpg(p) >= LOAD_MPG and r["usg"] >= LOAD_USG
    return f


_LF = {}


def build():
    """League context from the current knobs (the sensitivity probe re-runs it after moving a knob)."""
    ROT_POOL[:] = [p for p in LOAD_POOL if mpg(p) >= ROT_MPG and gp(p) >= ROT_GP]
    _Z.update({k: (statistics.mean(_rates(p)[k] for p in ROT_POOL), statistics.pstdev([_rates(p)[k] for p in ROT_POOL]))
               for k in ("usg", "ast", "top36", "tch36")})
    _LF.clear()
    _LF.update({p["name"]: load_features(p) for p in LOAD_POOL})


build()


def diet_features(p):
    s = p["stats"]
    f = {k: _g(s, f"play_type.{k}_freq") for k in PT}
    fga = max(_g(s, "box_score.fga"), 0.5)
    per36 = 36 / mpg(p)  # has_row guarantees GP > 0, so mpg > 0
    f.update(_LF[p["name"]])
    f.update(center=is_center(p), on_ball=f["isolation"] + f["pr_ball_handler"], moving=f["offscreen"] + f["handoff"],
             finish=f["pr_roll_man"] + f["cut"], resid=feed_state(p)[1],
             pull_sh=_g(s, "tracking_shooting.pullup_fga") / fga, pull36=_g(s, "tracking_shooting.pullup_fga") * per36,
             cs3_sh=_g(s, "tracking_shooting.catch_shoot_fg3a") / fga, cs3_36=_g(s, "tracking_shooting.catch_shoot_fg3a") * per36,
             drives36=_g(s, "tracking_drives.drives_per_game") * per36, pull=_g(s, "tracking_shooting.pullup_fga"),
             drives=_g(s, "tracking_drives.drives_per_game"), rim_sh=_g(s, "shot_zones.restricted_area_fga") / fga,
             oreb_pct=_g(s, "advanced.oreb_pct"))
    return f


def _shooter(f):
    return f["cs3_36"] >= CS3_36 and f["cs3_sh"] >= CS3_SH


def _creator(f):
    """Creates with the ball (iso + PnR share) or by passing (AST% p85, AST%/USG >= 1). 0 = not a creator."""
    by_pass = f["ast"] / CREATOR_AST if f["ast"] >= CREATOR_AST and f["ast_usg"] >= 1.0 else 0
    by_ball = f["on_ball"] / ON_BALL if f["on_ball"] >= ON_BALL else 0
    return max(by_pass, by_ball)


def _fulcrum(f):
    return (f["center"] and f["ast"] >= FULC_AST and f["ast_usg"] >= FULC_RATIO and f["on_ball"] < ON_BALL
            and f["tch36"] >= FULC_TCH36 and f["post36"] >= FULC_POST36)


# (label, gate, strength). Order = tie-break order. strength = signal / bar unless PLAYMAKER.
DIET_RULES = [
    ("Fulcrum playmaker", _fulcrum, lambda f: PLAYMAKER),
    ("Connector", lambda f: f["ast_usg"] >= CONNECT_RATIO and f["usg"] <= CONNECT_USG and f["on_ball"] < ON_BALL,
     lambda f: PLAYMAKER),
    ("Secondary creator", _creator, _creator),
    ("Pull-up shooter", lambda f: f["pull_sh"] >= PULL_SH and f["pull36"] >= PULL36, lambda f: f["pull_sh"] / PULL_SH),
    ("Slasher", lambda f: f["drives36"] >= DRIVES36 and f["rim_sh"] >= RIM_SH and f["drives"] >= 1.5 * f["pull"]
     and not (_creator(f) and f["ast_usg"] >= 1.0),
     lambda f: f["drives36"] / DRIVES36),
    ("Traditional post player", lambda f: f["postup"] >= POST and f["cs3_sh"] < POST_MAX_CS3, lambda f: f["postup"] / POST),
    ("Movement shooter", lambda f: _shooter(f) and f["moving"] >= MOVING, lambda f: f["cs3_sh"] / CS3_SH),
    ("Stretch big", lambda f: _shooter(f) and f["moving"] < MOVING and f["big"], lambda f: f["cs3_sh"] / CS3_SH),
    ("Floor spacer", lambda f: _shooter(f) and f["moving"] < MOVING and not f["big"], lambda f: f["cs3_sh"] / CS3_SH),
    ("Rim finisher", lambda f: f["finish"] >= FINISH and f["rim_sh"] >= FINISH_RIM and (f["big"] or f["pr_roll_man"] >= 0.08),
     lambda f: f["finish"] / FINISH),
    ("Glass eater", lambda f: f["oreb_pct"] >= OREB and f["resid"] >= max(f["finish"], PUTBACK), lambda f: f["oreb_pct"] / OREB),
    ("Cutter", lambda f: f["cut"] >= CUT and not f["big"], lambda f: f["cut"] / CUT),
    # ponytail: fallback. Off the ball, 2+ exploiter diets at 10%+, none at its own bar.
    ("Play finisher", lambda f: f["on_ball"] < ON_BALL and sum(f[k] >= 0.10 for k in ("spotup", "moving", "finish", "transition", "postup")) >= 2,
     lambda f: 0.01),
]


def load_role(p):
    """Primary creator, Fulcrum playmaker (a capacity center who passes), the scorer rung, or None. League bars only."""
    f = _LF[p["name"]]
    if not f["capacity"]:
        return None, f
    if f["cli"] >= CLI_BAR and f["ast"] >= PRIM_AST:
        return "Primary creator", f
    if path(p) == "stats" and _fulcrum(diet_features(p)):
        return "Fulcrum playmaker", f  # shape before scorer rung: a hub big is not a Scorer/facilitator (Sengun)
    if f["ast"] >= PRIM_AST and f["ast_usg"] >= PRIM_RATIO:
        return "Scorer/facilitator", f
    return "Volume scorer", f


# ---- TIERS path (legends; actives with no usable data). Unchanged from pass 3 except labels. Calibration:
#   passer    -> AST%:   C .20 (p72) | P .29 (p90) | E .39 (p98)
# So: lead = two usage Skills at P/E, or one All-Time Great; Primary bar (AST% .20) = passer >= Capable; Primary
# creator = passer >= Elite with a ball door, or Proficient with an Elite+ ball-screen game or an ATG drive game.
# Tiers cannot see AST%/USG, so a tier lead with no passer tier is the Volume scorer.
TIER_CAL = {"passer": {C: 0.20, P: 0.286, E: 0.385}}


def tier_lead(s):
    if s["passer"] >= E and s["pnr_ball_handler"] >= E:
        return True
    sig = [s["isolation_scorer"] >= P, s["pnr_ball_handler"] >= P, s["off_dribble_shooter"] >= E, s["driver"] >= E,
           s["low_post_player"] >= E, s["mid_post_player"] >= E]
    ups = [s[k] for k in ("isolation_scorer", "pnr_ball_handler", "off_dribble_shooter", "driver", "low_post_player", "mid_post_player")]
    return sum(sig) >= 2 or max(ups) == A


def _q(ok, strength):
    return strength if ok else 0


def tier_primary(s, p):
    ball_door = s["pnr_ball_handler"] >= P or s["driver"] >= E or (s["isolation_scorer"] >= P and not is_big(p))
    return (s["passer"] >= E and ball_door) or (s["passer"] >= P and (s["pnr_ball_handler"] >= E or s["driver"] == A))


TIER_LOAD_RULES = [
    ("Primary creator", lambda s, p: _q(tier_lead(s) and tier_primary(s, p), 10.2)),
    ("Scorer/facilitator", lambda s, p: _q(tier_lead(s) and s["passer"] >= C, 10.1)),
    ("Volume scorer", lambda s, p: _q(tier_lead(s), 10.0)),
]
TIER_DIET_RULES = [
    ("Fulcrum playmaker", lambda s, p: _q(is_big(p) and s["passer"] >= E and max(s["low_post_player"], s["mid_post_player"]) >= E, s["passer"] + 0.5)),
    ("Secondary creator", lambda s, p: _q(max(s["pnr_ball_handler"], s["driver"], s["isolation_scorer"]) >= P and s["passer"] >= P,
                                          max(s["pnr_ball_handler"], s["driver"], s["isolation_scorer"]) + 0.25)),
    ("Pull-up shooter", lambda s, p: _q(s["off_dribble_shooter"] >= P and s["off_dribble_shooter"] > max(s["driver"], s["pnr_ball_handler"]),
                                        s["off_dribble_shooter"])),
    ("Slasher", lambda s, p: _q(s["driver"] >= P, s["driver"])),
    ("Traditional post player", lambda s, p: _q(s["low_post_player"] >= P and s["spot_up_shooter"] < P, s["low_post_player"])),
    ("Movement shooter", lambda s, p: _q(s["movement_shooter"] >= P and s["movement_shooter"] >= s["spot_up_shooter"], s["movement_shooter"])),
    ("Stretch big", lambda s, p: _q(is_big(p) and s["spot_up_shooter"] >= P, s["spot_up_shooter"])),
    ("Floor spacer", lambda s, p: _q(not is_big(p) and s["spot_up_shooter"] >= P, s["spot_up_shooter"])),
    ("Glass eater", lambda s, p: _q(s["offensive_rebounder"] >= E, s["offensive_rebounder"])),
    ("Rim finisher", lambda s, p: _q(max(s["vertical_spacer"], s["pnr_finisher"]) >= P, max(s["vertical_spacer"], s["pnr_finisher"]))),
    ("Cutter", lambda s, p: _q(s["cutter"] >= P, s["cutter"] - 0.5)),
    ("Connector", lambda s, p: _q(s["passer"] >= P, s["passer"] - 0.25)),
]
assert all(r in ROLES for r, *_ in DIET_RULES + TIER_LOAD_RULES + TIER_DIET_RULES)
TRACKING_DIETS, TRACK_MPG = ("Pull-up shooter", "Stretch big", "Floor spacer"), 12.0  # no play types needed
DIET_RULES_BY_LABEL = [(label, gate) for label, gate, _ in DIET_RULES]


def tiers_of(p):
    return collections.defaultdict(int, {k: T.get(v, 0) for k, v in p["skills"].items()})  # key-absent = None


def path(p):
    if p["is_legend"]:
        return "tiers-legend"
    if not p["stats"]:
        return "tiers-norow"
    if gp(p) == 0:
        return "tiers-0gp"
    return "stats" if feed_state(p)[0] == "ok" else "stats-load+tiers-diet"


def feed_cover(p):
    """Play-type volume / box-score volume per game. 1.0 = the feed covers his season. None = no feed or no shots."""
    s = p["stats"]
    pt = s.get("play_type") or {}
    freq = sum(pt.get(k + "_freq") or 0 for k in PT)
    poss = sum(pt.get(k + "_poss") or 0 for k in PT if pt.get(k + "_freq") is not None)
    box = _g(s, "box_score.fga") + 0.44 * _g(s, "box_score.fta") + _g(s, "box_score.tov")
    return poss / freq / box if freq > 0 and box > 0 else None


def confidence(p):
    pth = path(p)
    if pth == "tiers-legend":
        return "legend: curated Skill tiers"
    if pth == "tiers-norow":
        return "LOW: no 2025-26 row; from Skill tiers"
    if pth == "tiers-0gp":
        return "LOW: 0 GP in 2025-26; from Skill tiers"
    state, resid, missing = feed_state(p)
    if state != "ok":
        why = "no play-type feed" if state == "none" else f"play-type feed misses {resid:.0%} of his possessions"
        return f"LOW: {why}; diet from tracking shots, else Skill tiers"
    if gp(p) < MIN_GP:
        return f"LOW: {int(gp(p))} GP"
    cover = feed_cover(p)
    if cover is not None and abs(cover - 1) > FEED_GAP:
        return f"PARTIAL: play-type feed holds {cover:.0%} of his box-score volume (likely one team's stint of a split season)"
    if is_big(p) and resid >= 0.5:
        return f"PARTIAL: {resid:.0%} of possessions outside the play-type feed (putbacks + gaps)"
    gaps = [k for k in ("transition", "spotup") if k in missing and (k == "transition" or not is_big(p))]
    if gaps and mpg(p) >= 20:
        return "PARTIAL: feed has no " + "/".join(gaps)
    return "ok"


def _rank(scored):
    return [(label, round(st, 2)) for st, _, label in sorted(scored, reverse=True) if st > 0]


def _scored(p, pth):
    """Every non-load role scored on its OWN gate, no family filter: [(strength, -list index, label)]."""
    if pth.startswith("tiers"):
        s = tiers_of(p)
        return [(rule(s, p), -i, label) for i, (label, rule) in enumerate(TIER_LOAD_RULES + TIER_DIET_RULES)]
    if pth == "stats":
        f = diet_features(p)
        return [(st(f) if gate(f) else 0, -i, label) for i, (label, gate, st) in enumerate(DIET_RULES)]
    # No usable play-type feed: the shot diets read tracking shots; anything else falls to his Skill tiers.
    scored = []
    if mpg(p) >= TRACK_MPG:
        f = diet_features(p)
        scored = [(st(f) if gate(f) else 0, -i, label) for i, (label, gate, st) in enumerate(DIET_RULES) if label in TRACKING_DIETS]
    if not any(st > 0 for st, _, _ in scored):
        s = tiers_of(p)
        scored = [(rule(s, p), -i, label) for i, (label, rule) in enumerate(TIER_DIET_RULES)]
    return scored


def classify(p):
    """-> (main, hits, all_hits). hits = the main-role race (family-first on the stats path); all_hits = every role
    whose own gate he clears, strongest first, with the load rung on top (the D22 second-role pool)."""
    pth = path(p)
    scored = _scored(p, pth)
    all_hits = _rank(scored)
    if not pth.startswith("tiers"):
        role, _ = load_role(p)
        if role:
            return role, [(role, "load")], [(role, "load")] + all_hits
        if pth == "stats":
            # Family first: a creator (either door of _creator) chooses only among creator roles; the playmaking
            # roles keep their priority over the family (Draymond, Dyson).
            fam = (CREATOR,) if _creator(diet_features(p)) else (CREATOR, EXPLOITER)
            hits = _rank([x for x in scored if ROLES[x[2]][0] in fam or x[2] in PLAYMAKING])
            return (hits[0][0] if hits else None), hits, all_hits
    return (all_hits[0][0] if all_hits else None), all_hits, all_hits


def second_role(main, all_hits):
    """D22: the strongest OTHER role he clears on its own gate, from a different group, never the fallback."""
    if not main:
        return None
    grp = GROUP.get(main, main)
    return next((l for l, _ in all_hits if l != main and l not in FALLBACK and GROUP.get(l, l) != grp), None)


def family(p, main, all_hits):
    """Volume scorer follows his diet: a creator door -> creator, else his strongest diet's family (logged default)."""
    if not main:
        return None
    if main != "Volume scorer" or path(p) != "stats":
        return ROLES[main][0]   # tiers: a tier lead reads the on-ball Skills, so creator
    if _creator(diet_features(p)):
        return CREATOR
    diet = next((l for l, _ in all_hits if l not in LOAD_ROLES), None)
    return ROLES[diet][0] if diet else CREATOR


def diet_source(p, off):
    pth = path(p)
    if pth.startswith("tiers") or not off:
        return "tiers" if off else None
    if off in LOAD_ROLES:
        return "load"
    if pth == "stats":
        return "diet"
    return "tracking" if off in TRACKING_DIETS and mpg(p) >= TRACK_MPG and dict(DIET_RULES_BY_LABEL)[off](diet_features(p)) else "tiers"


def empty_reason(p):
    conf = confidence(p)
    if conf.startswith("LOW"):
        return "no data: " + conf[5:].replace("; from Skill tiers", "").replace("; diet from tracking shots, else Skill tiers", "") + ", and no Skill at Proficient+"
    return "no role: no diet reaches its bar"


def run():
    out = []
    for p in players:
        rule_off, hits, all_hits = classify(p)
        off, src, conf = rule_off, diet_source(p, rule_off), confidence(p)
        if (p["name"], p["is_legend"]) in OVERRIDES:
            off, src = OVERRIDES[(p["name"], p["is_legend"])], "override"
            conf = f"admin override (proposed): rules say {rule_off}; {conf}"
        out.append({**p, "off": off, "off2": second_role(off, all_hits), "rule_off": rule_off, "off_hits": hits,
                    "all_hits": all_hits, "family": family(p, off, all_hits), "path": path(p), "src": src, "conf": conf,
                    "empty_reason": None if off else empty_reason(p)})
    return out


SIX = ("Luka Dončić", "Nikola Jokić", "Shai Gilgeous-Alexander", "Jalen Brunson", "Trae Young", "Cade Cunningham")


def demo():
    """Regression anchors. One accepted role per anchor unless a second is a documented taste boundary."""
    want_act = {
        # Chris 2026-09-21: the top rung, league-elite only
        **{n: {"Primary creator"} for n in SIX},
        # Chris's check list (reported, not his ruling)
        "Giannis Antetokounmpo": {"Primary creator"}, "James Harden": {"Primary creator"},
        "Tyrese Haliburton": {"Primary creator"},                  # LOW: no 2025-26 row; tiers
        "LeBron James": {"Scorer/facilitator"},            # usage .258 (next to Luka) clears .255 by .003
        "Tyrese Maxey": {"Scorer/facilitator"}, "Devin Booker": {"Scorer/facilitator"},
        "Alperen Sengun": {"Fulcrum playmaker"},                   # capacity center who passes: shape before scorer rung
        "Anthony Edwards": {"Volume scorer"},
        # scorer rung, league bars (were team leads in pass 3)
        "Stephen Curry": {"Scorer/facilitator"}, "Donovan Mitchell": {"Scorer/facilitator"},
        "Kevin Durant": {"Scorer/facilitator"}, "Jamal Murray": {"Scorer/facilitator"},
        "Paolo Banchero": {"Scorer/facilitator"}, "Jaylen Brown": {"Scorer/facilitator"},
        "Victor Wembanyama": {"Volume scorer"}, "Joel Embiid": {"Volume scorer"}, "Kawhi Leonard": {"Volume scorer"},
        "Pascal Siakam": {"Volume scorer"}, "Anthony Davis": {"Volume scorer"},
        # no longer team leads: the league bars send them to their diet
        "Scottie Barnes": {"Secondary creator"}, "Bam Adebayo": {"Play finisher", "Rim finisher"},
        "Alex Sarr": {"Play finisher", "Rim finisher", "Stretch big"},
        # creators below the load rungs (Secondary + Supplementary merged)
        "Kevin Porter Jr.": {"Secondary creator"}, "Ryan Rollins": {"Secondary creator"}, "De'Aaron Fox": {"Secondary creator"},
        "Stephon Castle": {"Secondary creator"}, "Payton Pritchard": {"Secondary creator"}, "T.J. McConnell": {"Secondary creator"},
        "Amen Thompson": {"Secondary creator", "Slasher"}, "Reed Sheppard": {"Secondary creator"},
        "Immanuel Quickley": {"Secondary creator"},    # round 2: creator door (AST% .26) beats a pace-bound transition share
        "Jusuf Nurkić": {"Fulcrum playmaker"},         # round 2: per-36 touches 79.0, elbow + post 5.6/36; 0% on-ball
        "Dejounte Murray": {"Secondary creator"},      # admin override (proposed); rules say Primary creator at 14 GP
        "Quenton Jackson": {"Slasher"},                # Transition engine dropped: his next diet names him
        # diets
        "Desmond Bane": {"Pull-up shooter", "Secondary creator", "Floor spacer"},
        "Trey Murphy III": {"Movement shooter"}, "Nickeil Alexander-Walker": {"Movement shooter"},
        "Julius Randle": {"Scorer/facilitator", "Slasher"},  # usage .258: the same .003 edge as LeBron
        "Tyler Herro": {"Pull-up shooter"}, "Jaime Jaquez Jr.": {"Slasher"},
        "Grayson Allen": {"Floor spacer", "Secondary creator"}, "Jerami Grant": {"Floor spacer"},
        "Tobias Harris": {"Floor spacer"}, "OG Anunoby": {"Floor spacer"}, "Harrison Barnes": {"Floor spacer"},
        "Ivica Zubac": {"Traditional post player"}, "Jonas Valančiūnas": {"Traditional post player"},
        "Domantas Sabonis": {"Fulcrum playmaker"}, "Precious Achiuwa": {"Cutter"}, "Bradley Beal": {"Pull-up shooter"},
        "Oso Ighodaro": {"Connector"}, "Bub Carrington": {"Pull-up shooter"},
        "Kyshawn George": {"Pull-up shooter", "Secondary creator"},  # taste boundary: on-ball .35 vs pull-ups .42
        "Jared McCain": {"Movement shooter"}, "Isaiah Joe": {"Movement shooter"},
        "Josh Hart": {"Connector"}, "Draymond Green": {"Connector"}, "Ayo Dosunmu": {"Floor spacer"},
        # renames: Rim finisher (rim-running bigs), Stretch big (bigs the Floor spacer rule catches)
        "Rudy Gobert": {"Rim finisher"}, "Evan Mobley": {"Rim finisher"}, "Day'Ron Sharpe": {"Rim finisher", "Glass eater"},
        "Nic Claxton": {"Rim finisher", "Connector"}, "Isaiah Hartenstein": {"Connector", "Rim finisher"},
        "Mitchell Robinson": {"Glass eater"},
        "Nikola Jović": {"Stretch big"}, "Bobby Portis": {"Floor spacer"},  # 6-9 F: not a big by is_big (C/FC or 6-10+)
        "Moritz Wagner": {"Stretch big"},
        "Brook Lopez": {"Stretch big"}, "Kristaps Porziņģis": {"Stretch big"},  # admin override; rules say Volume scorer (24.0 mpg)
        # renamed fallback: Play finisher in JKM's forwards sense (Chris's examples)
        "Karl-Anthony Towns": {"Play finisher"}, "Jaren Jackson Jr.": {"Play finisher"}, "Chet Holmgren": {"Play finisher"},
        "Miles Bridges": {"Play finisher"}, "Aaron Gordon": {"Play finisher"}, "Derik Queen": {"Play finisher"},
    }
    want_leg = {
        "Magic Johnson": {"Primary creator"}, "Oscar Robertson": {"Primary creator"}, "Larry Bird": {"Primary creator"},
        "Steve Nash": {"Primary creator"}, "LeBron James": {"Primary creator"}, "Giannis Antetokounmpo": {"Primary creator"},
        "Steph Curry": {"Primary creator"}, "Kobe Bryant": {"Primary creator"},
        "Michael Jordan": {"Primary creator"},  # admin override (D16); rules say Scorer/facilitator
        "Julius Erving": {"Primary creator"}, "Tracy McGrady": {"Primary creator"}, "Russell Westbrook": {"Primary creator"},
        "Allen Iverson": {"Scorer/facilitator"}, "Kevin Durant": {"Scorer/facilitator"},
        "Kareem Abdul-Jabbar": {"Scorer/facilitator"}, "Tim Duncan": {"Scorer/facilitator"},
        "Hakeem Olajuwon": {"Scorer/facilitator"},
        "Joel Embiid": {"Scorer/facilitator"}, "Kawhi Leonard": {"Volume scorer"},
        "Scottie Pippen": {"Secondary creator"}, "Kevin Garnett": {"Fulcrum playmaker"},
        "Dwight Howard": {"Rim finisher"}, "Bill Russell": {"Glass eater"},
        "Anthony Davis": {"Volume scorer"},  # admin override: never below active AD; rules say Rim finisher
    }
    rows = run()
    act = {r["name"]: r for r in rows if not r["is_legend"]}
    leg = {r["name"]: r for r in rows if r["is_legend"]}
    bad = [(n, act[n]["off"]) for n, ok in want_act.items() if act[n]["off"] not in ok]
    # Chris's six land on the top rung by the RULES, never by an override
    bad += [(n, act[n]["rule_off"]) for n in SIX if act[n]["rule_off"] != "Primary creator" or (n, False) in OVERRIDES]
    bad += [(n + " (legend)", leg[n]["off"]) for n, ok in want_leg.items() if leg[n]["off"] not in ok]
    assert not bad, bad
    # the top rung is league-elite only: about 10 actives (Chris), and each one clears every bar on its own numbers
    pc = [r for r in act.values() if r["rule_off"] == "Primary creator"]
    assert 8 <= len(pc) <= 14, [r["name"] for r in pc]
    for r in pc:
        if r["name"] in _LF:
            f = _LF[r["name"]]
            assert f["capacity"] and f["cli"] >= CLI_BAR and f["ast"] >= PRIM_AST, r["name"]
    # skill-set principle: no team input. Guard against a regression that brings team context back.
    assert not any(k in globals() for k in ("TEAM", "TEAM_GP", "TEAM_HUB", "TEAM_TRANS", "_TMAX", "CO_STAR", "HUB_RATIO", "traded"))
    assert not any("team" in r for r in rows), "a team field leaked into the rows"
    # legend twins sit at or above their own 2025-26 season (AD is the documented admin-override case)
    for n in set(act) & set(leg):   # AD included: the legend override holds him at Volume scorer
        assert ROLES[leg[n]["off"]][2] >= ROLES[act[n]["off"]][2], (n, leg[n]["off"], act[n]["off"])
    # confidence: <25 GP, no row, 0 GP, and unusable feeds are LOW; traded players are no longer flagged
    for n in ("Tyrese Haliburton", "Kyrie Irving", "Damian Lillard", "Fred VanVleet", "Domantas Sabonis", "Trae Young",
              "Ron Harper Jr.", "Marvin Bagley III", "Precious Achiuwa", "Bradley Beal", "Anthony Davis"):
        assert act[n]["conf"].startswith("LOW"), (n, act[n]["conf"])
    assert not any("traded" in r["conf"] for r in rows)
    for n in ("James Harden", "Coby White", "Ivica Zubac"):  # were LOW: traded in pass 3
        assert not act[n]["conf"].startswith("LOW"), (n, act[n]["conf"])
    # family first. A creator (either door) never lands in the exploiter family, except a playmaking role
    for r in rows:
        if r["path"] == "stats" and r["off"] and r["off"] not in LOAD_ROLES and _creator(diet_features(r)):
            assert r["family"] == CREATOR or r["off"] in PLAYMAKING, (r["name"], r["off"])
    # every active Fulcrum carries hub touches; every Stretch big is a big; no Floor spacer is
    for r in act.values():
        if r["off"] == "Fulcrum playmaker" and r["path"] == "stats":
            assert _LF[r["name"]]["tch36"] >= FULC_TCH36 and _LF[r["name"]]["post36"] >= FULC_POST36, r["name"]
    for r in rows:
        if r["off"] in ("Stretch big", "Floor spacer"):
            assert is_big(r) == (r["off"] == "Stretch big"), (r["name"], r["off"])
    # no load rung without capacity (league bars), and every capacity player holds a load rung or Fulcrum
    for n, f in _LF.items():
        assert (act[n]["rule_off"] in LOAD_ROLES + ("Fulcrum playmaker",)) >= f["capacity"], (n, act[n]["rule_off"])
        if act[n]["rule_off"] in LOAD_ROLES:
            assert f["capacity"], n
    assert all(r.get("team") is None for r in leg.values())
    assert act["Ron Harper Jr."]["path"] == "tiers-0gp" and "Ron Harper Jr." not in _LF
    assert not act["Russell Westbrook"]["conf"] == "ok"            # transition missing at 64 GP
    assert not any(p["is_legend"] for p in LOAD_POOL + ROT_POOL)   # league pools are actives only
    empty = [r for r in rows if not r["off"]]
    assert all(r["empty_reason"].startswith("no data") for r in empty), [(r["name"], r["empty_reason"]) for r in empty]
    assert len(empty) <= 20 and not any(r["is_legend"] for r in empty), len(empty)
    # round 2 fixes. (1) overrides are the only rows whose label differs from the rules, and they say so
    assert {(r["name"], r["is_legend"]) for r in rows if r["off"] != r["rule_off"]} == set(OVERRIDES)
    by = {(r["name"], r["is_legend"]): r for r in rows}
    assert all(by[k]["src"] == "override" and by[k]["conf"].startswith("admin override") for k in OVERRIDES)
    assert act["Dejounte Murray"]["rule_off"] == "Primary creator"
    # (2) the legend fixes ride the override list, not a tier re-curation (D16): the rules still say what they say
    assert leg["Michael Jordan"]["rule_off"] == "Scorer/facilitator" and leg["Anthony Davis"]["rule_off"] == "Rim finisher"
    assert act["Kristaps Porziņģis"]["rule_off"] == "Volume scorer"
    assert "CURATION" not in globals()
    # (3) a no-dribble center never reads Secondary creator (the pass door is a guard/wing door)
    for r in rows:
        if r["off"] == "Secondary creator" and r["path"] == "stats" and is_center(r):
            assert diet_features(r)["on_ball"] >= 0.10, r["name"]
    # (4) logged defaults: the rename and the drop leave no trace; Volume scorer's family follows his diet
    assert not any(k in globals() for k in ("TRANS_EX", "LEAGUE_TRANS"))
    for r in rows:
        assert not {r["off"], r["off2"], r["rule_off"]} & {"Transition engine", "Primary scorer/facilitator"}, r["name"]
        assert "Transition engine" not in [l for l, _ in r["all_hits"]]
    for n in ("Lauri Markkanen", "Michael Porter Jr."):
        assert act[n]["off"] == "Volume scorer" and act[n]["family"] == EXPLOITER, (n, act[n]["family"])
    for n in ("Anthony Edwards", "Kawhi Leonard", "Jalen Green", "Joel Embiid"):
        assert act[n]["off"] == "Volume scorer" and act[n]["family"] == CREATOR, (n, act[n]["family"])
    for r in rows:
        if r["off"] == "Volume scorer" and r["path"] == "stats" and _creator(diet_features(r)):
            assert r["family"] == CREATOR, r["name"]
    # (5) split-season feeds are flagged, never 'ok' (the 14 the round-1 check found, all multi-team in the game log)
    split = {r["name"] for r in rows if "one team's stint" in r["conf"]}
    assert split == {"Leonard Miller", "Ousmane Dieng", "Nick Richards", "Taylor Hendricks", "Rob Dillingham", "Kobe Brown",
                     "John Konchar", "Rayan Rupert", "Jaden Hardy", "Jevon Carter", "Josh Minott", "Buddy Hield",
                     "Jeremy Sochan", "Kyle Anderson"}, split
    assert all(r["src"] == "diet" for r in rows if r["name"] in split)  # the flag lands only where the feed drives the label
    labels = collections.Counter(r["off"] for r in rows)
    assert all(labels[r] > 0 for r in ROLES), [r for r in ROLES if not labels[r]]  # no dead roles
    # ---- D22: main + at most one second role ----
    for r in rows:
        s2 = r["off2"]
        if not r["off"]:
            assert s2 is None, r["name"]
        if s2 is None:
            continue
        assert s2 != r["off"] and s2 not in FALLBACK and GROUP.get(s2, s2) != GROUP.get(r["off"], r["off"]), (r["name"], r["off"], s2)
        assert s2 in [l for l, _ in r["all_hits"]], r["name"]
        # its OWN bar, never a lowered one: on the stats feed a diet's strength is signal / bar, so >= 1
        st = dict(r["all_hits"])[s2]
        if r["path"] == "stats" and s2 not in LOAD_ROLES + PLAYMAKING:
            assert st >= 1 and dict(DIET_RULES_BY_LABEL)[s2](diet_features(r)), (r["name"], s2, st)
        # it is the strongest qualifying role left: nothing eligible sits above it in the pool
        above = [l for l, _ in r["all_hits"][:[l for l, _ in r["all_hits"]].index(s2)]]
        assert all(l == r["off"] or l in FALLBACK or GROUP.get(l, l) == GROUP.get(r["off"], r["off"]) for l in above), (r["name"], above)
    # the second-role pool on the stats feed is exactly the roles whose gate passes (no family filter, no lowered bar)
    for r in rows:
        if r["path"] == "stats":
            f = diet_features(r)
            assert {l for l, _ in r["all_hits"]} - set(LOAD_ROLES) == {l for l, gate, _ in DIET_RULES if gate(f)}, r["name"]
    two = {n: (act[n]["off"], act[n]["off2"]) for n in act}
    assert two["Luka Dončić"] == ("Primary creator", "Pull-up shooter")
    assert two["Stephen Curry"] == ("Scorer/facilitator", "Movement shooter")
    assert two["Kristaps Porziņģis"] == ("Stretch big", "Volume scorer")          # override main, rules' main is his second
    assert two["Dejounte Murray"] == ("Secondary creator", "Pull-up shooter")      # never Primary creator as a second
    assert two["Draymond Green"] == ("Connector", "Floor spacer")
    assert two["Andre Drummond"] == ("Glass eater", "Rim finisher")
    assert two["Lauri Markkanen"] == ("Volume scorer", "Movement shooter")
    assert (leg["Michael Jordan"]["off"], leg["Michael Jordan"]["off2"]) == ("Primary creator", "Slasher")
    return rows


def tier_agreement():
    """Calibration check: does the legends' tier rule for Primary creator reproduce the actives' stats rule?"""
    stats_pc = {n for n, f in _LF.items() if f["capacity"] and f["cli"] >= CLI_BAR and f["ast"] >= PRIM_AST}
    tier_pc = {p["name"] for p in LOAD_POOL if tier_lead(tiers_of(p)) and tier_primary(tiers_of(p), p)}
    return sorted(stats_pc & tier_pc), sorted(stats_pc - tier_pc), sorted(tier_pc - stats_pc)


if __name__ == "__main__":
    rows = demo()
    for grp, keep in (("ACTIVES", False), ("LEGENDS", True)):
        rs = [r for r in rows if r["is_legend"] == keep]
        print(f"\n== {grp} (n={len(rs)}) ==")
        for label, n in collections.Counter(r["off"] for r in rs).most_common():
            ex = [r["name"] for r in rs if r["off"] == label][:10]
            print(f"  {n:3}  {label!s:28} {', '.join(ex)}")
        print("  confidence:", collections.Counter(r["conf"].split(":")[0] for r in rs).most_common())
        print("  family:", collections.Counter(r["family"] for r in rs).most_common())
    for keep in (False, True):
        rs = [r for r in rows if r["is_legend"] == keep]
        print(f"\n{'LEGENDS' if keep else 'ACTIVES'} with a second role (D22): {sum(bool(r['off2']) for r in rs)} of {len(rs)}; "
              + ", ".join(f"{m} + {s2} {n}" for (m, s2), n in collections.Counter((r["off"], r["off2"]) for r in rs if r["off2"]).most_common(12)))
    print("EMPTY:", [(r["name"], r["empty_reason"]) for r in rows if not r["off"]])
    both, stats_only, tier_only = tier_agreement()
    print(f"TIER AGREEMENT (Primary creator): both {len(both)}; stats only {stats_only}; tiers only {tier_only}")
    print("Z", {k: (round(m, 3), round(s, 3)) for k, (m, s) in _Z.items()})
    for a in sys.argv[1:]:
        for r in rows:
            if a.lower() in r["name"].lower():
                print(f"{r['name'][:24]:24} {'L' if r['is_legend'] else 'A'} {r['off']!s:24} + {r['off2']!s:22} {r['conf'][:40]:40} {r['all_hits'][:4]}")
    json.dump([{k: r[k] for k in ("name", "is_legend", "position", "off", "off2", "rule_off", "family", "off_hits", "all_hits", "path", "src", "conf", "empty_reason")}
               for r in rows], open(DIR + "offense_results.json", "w"), indent=1)
