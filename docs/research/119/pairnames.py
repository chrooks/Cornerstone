# Research prototype for #17, 2026-09-21; port reference only, not imported by the app
"""Pair names per D23 + D24 on the spec preview (archetypes.json). READ-ONLY. Main roles only (D22)."""
import collections, json, os
HERE = os.path.dirname(os.path.abspath(__file__)) + "/"
SHOOT = {"Floor spacer", "Movement shooter"}
LOAD = {"Primary creator", "Scorer/facilitator", "Volume scorer"}
PAIRS = [  # (name, offense mains, defense mains) -- offense sets are disjoint, so a cell gets at most one name
    ("3-and-D Wing", SHOOT, {"Assignment defender", "Switchable"}),
    ("3-and-D Guard", SHOOT, {"Point-of-attack defender"}),
    ("3-and-D Big", {"Stretch big"}, {"Anchor", "Switchable"}),
    ("Lob-and-Block Big", {"Rim finisher"}, {"Anchor"}),
    ("Two-Way Creator", {"Secondary creator"}, {"Point-of-attack defender", "Assignment defender", "Switchable"}),
    ("Two-Way Star", LOAD, {"Assignment defender", "Point-of-attack defender", "Switchable", "Anchor"}),
    ("Glue Guy", {"Connector"}, {"Anchor", "Assignment defender", "Point-of-attack defender", "Switchable"}),
]

def pair(off, de):
    hits = [n for n, o, d in PAIRS if off in o and de in d]
    assert len(hits) <= 1, (off, de, hits)
    return hits[0] if hits else None

def demo():
    assert pair("Floor spacer", "Assignment defender") == "3-and-D Wing"
    assert pair("Volume scorer", "Anchor") == "Two-Way Star"          # Two-Way Big merged in (D23)
    assert pair("Floor spacer", "Off-ball disruptor") is None          # no OBD names (D23)
    assert pair("Pull-up shooter", "Cone") is None                     # no negative names (D23)
    assert pair("Primary creator", "Possession ender") is None         # not in any research list
    rows = json.load(open(HERE + "archetypes.json"))
    c = collections.Counter(); pe = []
    for r in rows:
        p = pair(r["off"], r["def"]); r["pair"] = p
        c[(p, r["is_legend"])] += 1
        if r["def"] == "Possession ender": pe.append((r["name"], r["off"]))
    names = [n for n, _, _ in PAIRS]
    for n in names: print(f"{n}: actives {c[(n, False)]}, legends {c[(n, True)]}")
    print("named actives", sum(c[(n, False)] for n in names), "legends", sum(c[(n, True)] for n in names))
    print("Possession ender mains (no pair name):", pe)
    anchors = [l.split("|")[2].strip() for l in open(HERE + "anchor_table.md") if l.startswith("| ") and l.split("|")[1].strip().isdigit()]
    by = {(r["name"] + (" (legend)" if r["is_legend"] else "")): r for r in rows}
    for a in anchors:
        r = by.get(a) or by.get(a.replace(" (Legend)", " (legend)"))
        print(a, "->", r["pair"] if r else "??")

if __name__ == "__main__":
    demo()
