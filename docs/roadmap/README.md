# Cornerstone Living Diagrams

Two interactive diagrams, each with a committed JSON model as source of truth and an HTML build product (NOT committed) in `.diagram-exports/`:

| Diagram | Model | HTML |
|---|---|---|
| **Roadmap** — open issues by workstream, dependency edges | `cornerstone-roadmap-model.json` | `cornerstone-roadmap.html` |
| **Architecture** — container/component view: frontend surfaces → apiFetch → Flask → services → Supabase/externals | `cornerstone-architecture-model.json` | `cornerstone-architecture.html` |

## Viewing it

1. Rebuild (always safe — swap in the model/html pair you want):
   ```bash
   python3 ~/.claude/skills/diagram/scripts/build-diagram.py \
     docs/roadmap/cornerstone-roadmap-model.json \
     .diagram-exports/cornerstone-roadmap.html
   ```
2. Serve + open (hestia is remote — no localhost URLs):
   ```bash
   cd .diagram-exports && python3 -m http.server 8931 --bind 0.0.0.0
   ```
   Then open http://100.69.82.20:8931/cornerstone-roadmap.html or
   http://100.69.82.20:8931/cornerstone-architecture.html (Tailscale), or let VS Code forward port 8931.

Interactions: drag nodes (positions are pinned in the model), click a node/edge for its description and issue link, pan/zoom.

## Update contract — keep it honest

A stale living diagram is worse than none.

**Architecture model** — update when reality changes: a blueprint/service/engine is added, removed, or re-scoped; a data flow changes (e.g. Claude calls move off the request path per #79/#80/#81); a new external dependency or deploy path lands. Conventions:

- **Layered zones are the point** — the model's `zones` array draws horizontal layer bands (Client → Frontend → API → Services → Data → Infra, External as a right-side band). New nodes go INSIDE their layer's band rectangle; if a layer gains nodes, widen the band, don't spill.
- Node `label` = name + role; `meta.tech`/`meta.dir` for tech and location; `group` = layer.
- Edges are labeled, directional runtime data/control flows only — no deploy-time arrows (the Infra band's description carries the deploy story), no decorative edges. Intra-band edges may drop labels when adjacency makes them obvious.
- After editing, rebuild AND visually confirm (Playwright screenshot or open it) before calling it done.

**Roadmap model** — whenever issues change, edit the model in the same pass:

- **Issue closed** → either delete its node (and edges) or, if it capped a milestone, fold it into that milestone's ✅ summary node description.
- **New issue** → add a node: `label` leads with state emoji (`✅` closed, `🧍` waiting-on-human/hitl, none = open + agent-ready), includes the issue number; `group` = workstream; `description` = one-liner; `meta.url` = the GitHub issue URL; pinned `x`/`y` near its workstream cluster.
- **Issue reprioritized / relabeled / moved milestone** → update its `label`, `description`, and `meta`.
- **New dependency discovered** → add an edge blocker → blocked, with a `description` saying what the dependency actually is. Only real dependencies — no decorative edges.
- After any model edit, **rebuild the HTML** (step 1 above).

Conventions (full spec: `/diagram` skill, `roadmap` kind):

- Groups carry meaning: `snapshot`, `lab`, `engine`, `archetypes`, `public`, `done`.
- Keep `options.physics: false` and pinned coordinates — that's what makes hand-arranged positions survive rebuilds.

## For agents

When a session closes, creates, or re-scopes issues in this repo (e.g. via `/to-issues` or `/roadmap`), update this model as part of the same unit of work.
