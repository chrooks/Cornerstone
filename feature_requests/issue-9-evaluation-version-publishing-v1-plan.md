# Evaluation Version publishing — v1 first Vertical Slice

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `~/.claude/PLAN.md`.

GitHub issue: [#9 Evaluation Version publishing](https://github.com/chrooks/Cornerstone/issues/9). Architectural commitments locked in:

- `docs/adr/0001-engine-v2-hybrid-evaluator.md`
- `docs/adr/0002-saved-team-evaluation-version-binding.md`

## Purpose / Big Picture

Today the cohesion engine cannot be calibrated safely. Weight edits made on `/admin/cohesion-calibration` persist only to a process-memory dict (`_WEIGHT_OVERRIDES` in `backend/api/cohesion_calibration.py:56`) and are lost on every backend restart. Saved Teams carry a text slug `evaluation_version = 'cohesion-v1'` that points at nothing — there is no `evaluation_versions` table. Every scoring-math change (`#16` Skill Tier retune, `#25` Subscore Tree restructure, `#18` public changelog, `#24` PnR Impact Trait) is therefore blocked behind a code release.

After this slice, the admin will:

1. Open `/admin/cohesion-calibration` and see a header band identifying the currently active Evaluation Version (e.g. `cohesion-v1`, status `published`).
2. Click **New Draft** to clone the published Version into a fresh draft row. The page chrome switches into "DRAFT" mode (amber band, persistent badge).
3. Edit any numeric weight, rename a Skill / Impact Trait / Subscore display label, or drag-reorder Subscores within the Subscore Tree. Every edit writes to the draft blob in the database.
4. Click **View diff** to open a side drawer that lists every field that differs between the draft and its parent published Version.
5. Click **Publish**, type a changelog note in the dialog, and confirm. The publish gate validates structural integrity (handlers exist, values complete, tree consistent, skills cover handlers, note non-empty). On success the draft becomes the new active published Version. The previous published Version becomes inactive but remains queryable.
6. Open the new RuleSet builder, save a Team, and confirm the new `saved_team_evaluations` row references the freshly-published Evaluation Version by foreign key.

To observe it working from a cold start:

    cd backend && source venv/bin/activate && python -m flask run --port=5001 &
    cd frontend && npm run dev &
    # Open http://localhost:3000/admin/cohesion-calibration
    # Confirm "cohesion-v1 · published · active" badge appears in header
    # Click "New Draft", change TIER_VALUES.Elite from 6.0 to 7.0
    # Click "View diff" → should show one row: tier_values.Elite  6.0 → 7.0
    # Click "Publish", type "test bump", confirm → header switches to cohesion-v2-... · published · active
    # Save any team via builder → check saved_team_evaluations.evaluation_version_id resolves to new version

The Engine v2 thesis lands here: **what is scored** (Skill list, Impact Trait list, Subscore Tree, weights) lives in the database as data, and **how scoring works** (formula handlers like `compute_spacing`) lives in code, registered by stable name. The `CohesionEngine` class is the runtime that joins them per request.

## Progress

- [ ] M1: Schema for `evaluation_versions` + bootstrap migration writes `cohesion-v1` from current Python constants.
- [ ] M2: `CohesionEngine` class with handler registry decorator. All existing modules import-time-register their handlers. No functional change yet.
- [ ] M3: Refactor formula modules (`composites.py`, `cohesion.py`, `roster.py`, `synergies.py`, `accentuation.py`, `bell_curve.py`, `ratios.py`) to read values from `engine.version.values` instead of importing `weights.py` constants directly. `evaluate_roster()` becomes a thin wrapper that instantiates `CohesionEngine(version=active_version())` and dispatches.
- [ ] M4: Backend API for Evaluation Versions (`/api/evaluation-versions/*`) — list, get active, get draft, create draft from published, patch draft, validate, publish, discard draft.
- [ ] M5: Editor grafted onto `/admin/cohesion-calibration/page.tsx` — `EvaluationVersionHeader`, `DraftBanner`, `DiffDrawer`, `PublishDialog`. Existing `WeightsEditor`, `LineupTester`, etc. continue to work but now bind to the draft Version when one exists.
- [ ] M6: Saved Team FK conversion — add `evaluation_version_id uuid` FK on `saved_team_evaluations`, backfill from existing `evaluation_version` text, drop text column. Update read/write paths.
- [ ] M7: Cleanup — header comments on `weights.py` and `services/skills.py` marking them historical reference, dead-code audit of `_WEIGHT_OVERRIDES`, manual end-to-end check, commit + PR.

## Surprises & Discoveries

Empty at start. Populate as work proceeds. Each entry:

- Observation: …
  Evidence: …

## Decision Log

Decisions captured before implementation began (sourced from the grilling session of 2026-05-15 and recorded in the ADRs):

- Decision: Evaluation Version stores taxonomy + values + formula_refs as a single JSONB blob (Q1=B, Q2=A).
  Rationale: Version is read whole every evaluation; per-field queries aren't useful. Taxonomy growth becomes data-only, not schema migration.
  Date/Author: 2026-05-15 / chrooks (interview transcript captured in ADR-0001).

- Decision: Python constants in `weights.py` and `services/skills.py` are kept as historical reference; bootstrap migration writes the v1 Version row from them; runtime canonical = DB (Q3=B).
  Rationale: Reversibility if v1 Editor has bugs; smaller blast radius than deleting constants in the same PR.
  Date/Author: 2026-05-15 / chrooks (ADR-0001).

- Decision: Runtime injection via `CohesionEngine` class instance per request, not `contextvars` or threading globals (Q4=D).
  Rationale: Matches Engine v2 thesis cleanly. Engine instance is the natural home for the handler registry plus the version blob. Trivially testable via `CohesionEngine(version=fake_blob)`.
  Date/Author: 2026-05-15 / chrooks (ADR-0001).

- Decision: Exactly one row may have `status='draft'` at a time. Partial unique index in Postgres enforces it (Q5=A).
  Rationale: Solo operator. Clear binary chrome (published vs draft). Discard friction is honest.
  Date/Author: 2026-05-15 / chrooks.

- Decision: Standard publish gate — block on L1 (handler existence), L2 (required value keys), L3 (Subscore Tree ↔ formula_refs consistency), L4 (handler-referenced Skills exist in taxonomy), L7 (changelog note non-empty). Defer L5/L6 (Snapshot/Saved Team impact) to v3 (Q6=B).
  Rationale: Catch structural bugs cheaply; force "why" capture for changelog (#18). Saved Team impact lives at Lab reopen time per ADR-0002.
  Date/Author: 2026-05-15 / chrooks.

- Decision: One Evaluation Version is globally active. Partial unique index `WHERE is_active = true` enforces it. RuleSet/Build/Save scoring uses the active Version. Calibration page scores against the draft Version using a separate `CohesionEngine` instance (Q7=A).
  Rationale: Scoring math is currently RuleSet-independent. Per-RuleSet pin is additive later if ever needed.
  Date/Author: 2026-05-15 / chrooks.

- Decision: v1 Editor edits only values + display-label rename + Subscore Tree reorder. No add/remove of Skills, Impact Traits, or formula_refs in v1 (Q8=B).
  Rationale: Add/remove couples to pipeline (Player Skill Profile shape) and formula handler additions (code releases). Keep v1 scope to "value calibration + taxonomy reorg".
  Date/Author: 2026-05-15 / chrooks.

- Decision: Saved Team binding is FK only; slug becomes immutable once Version `status='published'` (Q9=A).
  Rationale: Immutable slug eliminates drift; FK gives Postgres-enforced integrity.
  Date/Author: 2026-05-15 / chrooks (ADR-0002).

- Decision: Formula Handlers register via `@CohesionEngine.handler("name_v1")` decorator at module import time. `cohesion_engine/__init__.py` eagerly imports handler modules to populate the registry before any request (Q10=A).
  Rationale: Co-located with implementation; greppable; tests can register their own handlers.
  Date/Author: 2026-05-15 / chrooks (ADR-0001).

- Decision: Slugs are admin-typed at publish time, regex-validated `^cohesion-[a-z0-9-]+$`, UNIQUE constrained, pre-filled with `cohesion-v{N}` suggestion (Q11=B).
  Rationale: Intentful slugs become the headline of the future public changelog (#18).
  Date/Author: 2026-05-15 / chrooks.

- Decision: Editor lives on the existing `/admin/cohesion-calibration` page — additive header band, draft banner, diff drawer, publish dialog. No new route in v1 (Q12=A).
  Rationale: Smallest blast radius. Existing components (WeightsEditor, LineupTester) continue to work, rebinding from `_WEIGHT_OVERRIDES` to active draft Version.
  Date/Author: 2026-05-15 / chrooks.

- Decision: Saved Teams are never silently re-scored when a newer Version publishes. Re-evaluation only happens when the user opens the Saved Team as a Build in the Lab and runs a compat check.
  Rationale: Saved Teams represent user intent at a moment in time; silent re-scoring violates the Honest Signifier contract. (ADR-0002.)
  Date/Author: 2026-05-15 / chrooks.

## Outcomes & Retrospective

Empty until M7 completes.

## Code Review Findings

Populated after code review — leave blank until review is complete.

### High Risk

### Medium Risk

### Low Risk

## Context and Orientation

The reader is assumed to know nothing about Cornerstone. Read the project Lexicon at `/home/chrooks/projects/Cornerstone/CONTEXT.md` for terms used here (Evaluation Version, Skill, Skill Profile, Impact Trait, Subscore, Subscore Tree, Formula Handler, Snapshot Release, Saved Team, RuleSet, Lab, Build). The Lexicon takes precedence over generic engineering vocabulary in this document.

Cornerstone is a Flask backend + Next.js frontend + Supabase Postgres NBA roster builder. The cohesion engine — the scoring system at issue here — lives at `backend/services/cohesion_engine/`. It contains 3,417 lines of Python across:

- `backend/services/cohesion_engine/__init__.py` — re-exports `evaluate_roster` and `RosterEvaluation`.
- `backend/services/cohesion_engine/weights.py` — all numeric constants (`TIER_VALUES`, `COMPOSITE_COEFFICIENTS`, `COMPOSITE_NAMES`, `THEORETICAL_MAX`, `AMPLITUDE_MAP`, `VD_EXT`, `PD_DOWN`, `RP_UP`, `PEAK_SHIFT_*`, `BELL_*`, `DEFENSIVE_*`, `PASSING_*`, `PNR_*`, `STACKING_RETURNS`, `COHESION_ROLLUP_WEIGHTS`, more). All are imported directly by the formula modules below.
- `backend/services/cohesion_engine/composites.py` — `compute_player_composites()`, `tier_value()`. Reads `TIER_VALUES`, `COMPOSITE_COEFFICIENTS`, `THEORETICAL_MAX`, `COMPOSITE_NAMES`.
- `backend/services/cohesion_engine/cohesion.py` — `evaluate_lineup()`. Reads many `weights.py` constants. Calls into composites, ratios, synergies, accentuation, bell_curve.
- `backend/services/cohesion_engine/roster.py` — `evaluate_roster()`. Iterates Lineup Combinations and applies rotation-level rollup.
- `backend/services/cohesion_engine/synergies.py`, `accentuation.py`, `bell_curve.py`, `ratios.py`, `notes.py`, `team_description.py`, `types.py` — supporting modules.

Skill taxonomy lives at `backend/services/skills.py` (`SKILL_LIST`, `SKILL_LABELS`) and is mirrored in the frontend at `frontend/lib/skills.ts`. There are 21 Skills today (the "21-skill taxonomy is immutable" rule from `CLAUDE.md` is what this slice prepares to relax).

The calibration page lives at `frontend/app/admin/cohesion-calibration/page.tsx` (518 lines). It renders three panels (PlayerCompositePanel, tabbed center, ResultsPanel) plus a Weights tab editor (`WeightsEditor.tsx`). State is held in custom hooks (`useCohesionWeights`, `useLineupSlots`, `useTeamFill`, `useTestHistory`). The page calls `evaluateLineup`, `evaluateRotation`, `fetchPlayerComposites`, `fetchBellCurve` from `frontend/lib/api.ts`, plus calibration-specific endpoints in `backend/api/cohesion_calibration.py`.

The cohesion calibration API at `backend/api/cohesion_calibration.py` exposes `GET /api/cohesion-calibration/weights` (line 722) and `PUT /api/cohesion-calibration/weights` (line 737). Both operate on `_WEIGHT_OVERRIDES`, a module-level Python dict at line 56 that lives only in process memory. The `_get_all_weights()` helper (line 166) merges defaults from `weights.py` with whatever has been written into the dict.

Saved Teams use three tables introduced in `supabase/migrations/20260511000000_real_rulesets_saved_teams_domain.sql`:

- `saved_teams` — one row per Team; columns include `ruleset_version_id` FK and a denormalized `evaluation_version text` column.
- `saved_team_players` — slot order + Player references.
- `saved_team_evaluations` — append-only score log; columns `saved_team_id`, `evaluation_version text NOT NULL`, plus score fields. There is no FK target; the `'cohesion-v1'` text string is just folklore.

The migration that created `saved_team_evaluations` is at lines 148-160. The backfill that populated it is at lines 335-378. RLS policies for it sit at lines 390-429.

The RuleSet system in the same migration provides a strong precedent for how to structure Evaluation Versions: `rulesets`, `rules`, and `ruleset_versions` (lines 11-72) use a JSONB `rules_json` column, `status text` with a check constraint, `version_label`, and a content `rules_hash`. The schema this ExecPlan proposes deliberately mirrors that shape.

Auth: the `@require_admin` decorator at `backend/api/auth.py` verifies a Supabase JWT (HS256/RS256/ES256) and checks `user_roles` table for `role = 'admin'`. All write endpoints in this slice must use it.

The active branch is `feat/issue-9-evaluation-version-publishing`. Recent commits land ADR-0001, ADR-0002, and CONTEXT.md Lexicon additions for Evaluation Version (tightened), Formula Handler (new), Subscore (new), Subscore Tree (new).

## Architecture Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Version blob shape | Single JSONB column `payload` containing `taxonomy`, `values`, `formula_refs`, `meta` | Read whole; taxonomy growth = data-only |
| Source of truth | DB after v1; `weights.py` / `skills.py` become bootstrap-only references | Reversibility; minimal blast radius |
| Runtime injection | `CohesionEngine(version=active_version())` per request | Matches Engine v2 thesis; testable |
| Handler registry | `@CohesionEngine.handler("name_v1")` decorator | Co-located, greppable |
| Draft Invariant | Single draft; partial UNIQUE index | Solo operator; clear binary mode |
| Publish gate | L1+L2+L3+L4+L7 | Catch structural bugs; force changelog note |
| Active selection | Single global active; partial UNIQUE `WHERE is_active=true` | RuleSet-independent today |
| Editor scope v1 | Values + rename + Subscore Tree reorder | Unblocks #16/#25/#18; defers #24 |
| Saved Team binding | FK only; slug immutable post-publish | Postgres-enforced integrity |
| Slug naming | Admin-typed, regex-validated `^cohesion-[a-z0-9-]+$`, UNIQUE | Intentful slugs feed #18 changelog |
| Editor placement | Graft onto `/admin/cohesion-calibration` | Smallest blast radius |
| Re-eval policy | Never silent; reopen as Build in Lab + compat check | Honest Signifier; ADR-0002 |

## File Changes

### New Files

- `supabase/migrations/20260516000000_evaluation_versions.sql` — adds `evaluation_versions` table + bootstrap row + `saved_team_evaluations.evaluation_version_id` FK + partial unique indexes + RLS.
- `backend/services/cohesion_engine/engine.py` — defines `class CohesionEngine` with `handler()` class decorator, registry, `version` attribute, `evaluate_lineup()` / `evaluate_roster()` methods.
- `backend/services/cohesion_engine/handlers/__init__.py` — empty package marker. Imported eagerly by `cohesion_engine/__init__.py` to trigger handler registration.
- `backend/services/cohesion_engine/handlers/composites_v1.py` — re-exports the existing composite formulas decorated with `@CohesionEngine.handler("<name>_v1")`. Bodies remain in `composites.py` and accept an `engine` parameter; thin wrappers register them by name. Optional consolidation in this file.
- `backend/services/evaluation_versions/__init__.py` — package marker.
- `backend/services/evaluation_versions/repo.py` — DB access: `list_versions()`, `get_active()`, `get_draft()`, `create_draft_from_published(parent_id)`, `patch_draft(draft_id, patch)`, `publish_draft(draft_id, slug, changelog_note)`, `discard_draft(draft_id)`.
- `backend/services/evaluation_versions/validator.py` — runs the L1-L4+L7 publish gate. Returns list of structured violations. Pure function over a Version blob + registered handler index.
- `backend/services/evaluation_versions/bootstrap.py` — builds the v1 blob from `weights.py` + `services/skills.py` constants. Called by the migration's Python-side runner if we use a manual seed, or referenced by SQL `INSERT INTO evaluation_versions(...) VALUES (...)` if we hand-write the JSON in the migration.
- `backend/api/evaluation_versions.py` — Flask blueprint. Endpoints listed in "Data & API Changes".
- `frontend/lib/types/evaluation-version.ts` — TypeScript types mirroring backend response shapes (`EvaluationVersion`, `EvaluationVersionPayload`, `Taxonomy`, `Values`, `FormulaRefs`, `PublishGateViolation`).
- `frontend/lib/api/evaluation-versions.ts` — `listEvaluationVersions`, `getActiveEvaluationVersion`, `getDraftEvaluationVersion`, `createDraft`, `patchDraft`, `validateDraft`, `publishDraft`, `discardDraft`. All via `apiFetch<T>()`.
- `frontend/app/admin/cohesion-calibration/components/EvaluationVersionHeader.tsx` — Version Switcher dropdown + status chip + "New Draft" / "Continue draft" / "Discard draft" buttons. Mounted at the top of the calibration page.
- `frontend/app/admin/cohesion-calibration/components/DraftBanner.tsx` — persistent amber band shown whenever the page is in draft mode. Displays pending-changes count + "View diff" button.
- `frontend/app/admin/cohesion-calibration/components/DiffDrawer.tsx` — slide-in drawer listing field-level diffs grouped by section. Each row has a per-row "Revert" button.
- `frontend/app/admin/cohesion-calibration/components/PublishDialog.tsx` — modal with slug input (regex-validated, pre-filled), changelog note textarea, publish gate output, confirm button.
- `frontend/app/admin/cohesion-calibration/hooks/useEvaluationVersion.ts` — React state hook: holds `active`, `draft`, `diff`, mutation methods.
- `feature_requests/issue-9-evaluation-version-publishing-v1-plan.md` — this file (already created).

### Modified Files

- `backend/app.py` — register the new `evaluation_versions` blueprint.
- `backend/services/cohesion_engine/__init__.py` — re-export `CohesionEngine`; add eager imports for handler modules so decorators run on app startup.
- `backend/services/cohesion_engine/composites.py` — add `engine` parameter to `compute_player_composites()` and `tier_value()`; read values from `engine.version.values["tier_values"]` etc. Caller in `cohesion.py` passes `engine`. No formula body changes.
- `backend/services/cohesion_engine/cohesion.py` — `evaluate_lineup()` becomes `CohesionEngine.evaluate_lineup(self, lineup)` method (or accepts `engine` arg if kept as function). Replace direct `weights.py` imports with reads from `self.version.values`.
- `backend/services/cohesion_engine/roster.py` — same pattern: `evaluate_roster()` becomes a method on `CohesionEngine` (or thin wrapper). Public `cohesion_engine.evaluate_roster()` remains as the import surface, internally building a `CohesionEngine(version=active_version())` and delegating.
- `backend/services/cohesion_engine/synergies.py`, `accentuation.py`, `bell_curve.py`, `ratios.py` — same refactor: accept `engine` arg, read values from blob.
- `backend/services/cohesion_engine/weights.py` — add a module-top header comment: `# HISTORICAL REFERENCE ONLY. Runtime values come from the active Evaluation Version row in the database. This file is read at bootstrap (see services/evaluation_versions/bootstrap.py) and not at runtime.` Leave constants intact for the bootstrap path.
- `backend/services/skills.py` — same header comment. `SKILL_LIST` and `SKILL_LABELS` remain for bootstrap.
- `backend/api/cohesion_calibration.py` — the existing `GET /weights` and `PUT /weights` endpoints continue to exist but now read from / write to the **active draft Evaluation Version** instead of `_WEIGHT_OVERRIDES`. If no draft exists, `PUT /weights` auto-creates one. The `_WEIGHT_OVERRIDES` dict is deleted in M7.
- `backend/api/rosters.py` (or wherever `saved_team_evaluations` rows are created) — capture `evaluation_version_id` from active Version at score-time and persist on the new row.
- `frontend/app/admin/cohesion-calibration/page.tsx` — mount `EvaluationVersionHeader` at top; mount `DraftBanner` (conditional on draft existing); mount `DiffDrawer` and `PublishDialog`; thread `currentVersion` and `currentDraft` props into existing components so they bind to the draft blob.
- `frontend/lib/api.ts` — re-export new evaluation-version helpers.
- `frontend/lib/types.ts` — re-export `EvaluationVersion` etc.

### Deleted Files

None in v1. The `_WEIGHT_OVERRIDES` dict and unused imports get removed in M7 but no file is deleted.

## Data & API Changes

### New table `evaluation_versions`

    CREATE TABLE public.evaluation_versions (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug            text NOT NULL,                             -- 'cohesion-v1', 'cohesion-v2-tier-retune'
      status          text NOT NULL DEFAULT 'draft',             -- 'draft' | 'published' | 'archived'
      parent_id       uuid REFERENCES public.evaluation_versions(id) ON DELETE SET NULL,
      payload         jsonb NOT NULL,                            -- { taxonomy, values, formula_refs, meta }
      payload_hash    text NOT NULL,                             -- sha256 of canonical JSON; used for diff/dedup
      changelog_note  text,                                      -- required on publish; null while draft
      is_active       boolean NOT NULL DEFAULT false,            -- exactly one row may have true
      created_by      uuid REFERENCES auth.users(id),
      published_by    uuid REFERENCES auth.users(id),
      created_at      timestamptz NOT NULL DEFAULT now(),
      published_at    timestamptz,
      archived_at     timestamptz,

      CONSTRAINT chk_evaluation_versions_status
        CHECK (status IN ('draft', 'published', 'archived')),
      CONSTRAINT chk_evaluation_versions_slug_format
        CHECK (slug ~ '^cohesion-[a-z0-9-]+$'),
      CONSTRAINT chk_evaluation_versions_changelog_on_publish
        CHECK (status = 'draft' OR changelog_note IS NOT NULL),
      CONSTRAINT chk_evaluation_versions_published_at
        CHECK (status = 'draft' OR published_at IS NOT NULL),
      CONSTRAINT chk_evaluation_versions_active_only_published
        CHECK (NOT is_active OR status = 'published'),
      CONSTRAINT uq_evaluation_versions_slug UNIQUE (slug)
    );

    -- Exactly one draft at a time
    CREATE UNIQUE INDEX uq_evaluation_versions_single_draft
      ON public.evaluation_versions (status)
      WHERE status = 'draft';

    -- Exactly one active Version at a time
    CREATE UNIQUE INDEX uq_evaluation_versions_single_active
      ON public.evaluation_versions (is_active)
      WHERE is_active = true;

    -- Slug locked after publish: enforced via trigger
    CREATE OR REPLACE FUNCTION evaluation_versions_lock_slug_after_publish()
    RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.status = 'published' AND NEW.slug <> OLD.slug THEN
        RAISE EXCEPTION 'slug is immutable after publish (was %, attempted %)', OLD.slug, NEW.slug;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_evaluation_versions_lock_slug
      BEFORE UPDATE ON public.evaluation_versions
      FOR EACH ROW EXECUTE FUNCTION evaluation_versions_lock_slug_after_publish();

    ALTER TABLE public.evaluation_versions ENABLE ROW LEVEL SECURITY;

    -- Anyone can read (slugs surface on Saved Team detail)
    CREATE POLICY "Anyone can read evaluation versions"
      ON public.evaluation_versions FOR SELECT USING (true);

    -- Only service role + admins write (admin check happens in Flask)
    CREATE POLICY "Service role manages evaluation versions"
      ON public.evaluation_versions FOR ALL USING (auth.role() = 'service_role');

### Bootstrap row inserted by the same migration

A single `INSERT INTO public.evaluation_versions (slug, status, payload, payload_hash, is_active, published_at, changelog_note) VALUES ('cohesion-v1', 'published', '<HAND-WRITTEN JSON>', '<hash>', true, now(), 'Bootstrap from pre-versioning constants in services/cohesion_engine/weights.py and services/skills.py.');`. The hand-written JSON literally encodes the current Python constants. Generation is done locally by running `python backend/scripts/dump_v1_blob.py > /tmp/v1.json` (script added in M1), then pasting into the migration. The script's output is also checked into `supabase/migrations/data/evaluation_version_v1_seed.json` for diffability.

### `saved_team_evaluations.evaluation_version_id` FK migration

    ALTER TABLE public.saved_team_evaluations
      ADD COLUMN evaluation_version_id uuid REFERENCES public.evaluation_versions(id) ON DELETE RESTRICT;

    UPDATE public.saved_team_evaluations ste
      SET evaluation_version_id = (
        SELECT id FROM public.evaluation_versions WHERE slug = ste.evaluation_version
      );

    ALTER TABLE public.saved_team_evaluations
      ALTER COLUMN evaluation_version_id SET NOT NULL;

    ALTER TABLE public.saved_team_evaluations DROP COLUMN evaluation_version;

The denormalized `saved_teams.evaluation_version` column added by the prior migration is dropped (replaced with reading the latest `saved_team_evaluations` row).

### Blueprint `/api/evaluation-versions`

All admin-write endpoints require `@require_admin`. Read endpoints are public (the slug + payload are visible information).

- `GET /api/evaluation-versions` — list all Versions, newest first. Response `{ success, data: EvaluationVersion[] }`.
- `GET /api/evaluation-versions/active` — currently active Version. `{ success, data: EvaluationVersion }`.
- `GET /api/evaluation-versions/draft` — current draft Version or `null`. `{ success, data: EvaluationVersion | null }`.
- `GET /api/evaluation-versions/<id>` — single Version. `{ success, data: EvaluationVersion }`.
- `POST /api/evaluation-versions/drafts` — create a new draft from the active published Version. Fails if a draft already exists. Body: `{ parent_id?: uuid }` (defaults to active). Response: created draft.
- `PATCH /api/evaluation-versions/drafts/<id>` — apply a JSON-Patch-style operation to the draft's payload. Body: `{ patch: [{ op, path, value }, ...] }`. Returns updated draft. Reject if Version is not status=draft.
- `POST /api/evaluation-versions/drafts/<id>/validate` — run publish gate. Body: `{ changelog_note: string }`. Response: `{ success, data: { ok: boolean, violations: PublishGateViolation[] } }`. Does not mutate.
- `POST /api/evaluation-versions/drafts/<id>/publish` — atomic transaction: validate; if ok, set `slug=<typed>`, `status='published'`, `published_at=now()`, `changelog_note=<typed>`, then `UPDATE evaluation_versions SET is_active=false WHERE is_active=true`, then set the new row's `is_active=true`. Body: `{ slug: string, changelog_note: string }`. Response: published Version.
- `DELETE /api/evaluation-versions/drafts/<id>` — discard draft (hard delete). Response: `{ success }`.

### `EvaluationVersionPayload` JSON schema (informal)

    {
      "taxonomy": {
        "skills": [
          { "key": "isolation_scorer", "label": "Isolation Scorer", "order": 0 },
          ...
        ],
        "impact_traits": [ { "key": "spacing", "label": "Spacing", "order": 0 }, ... ],
        "subscore_tree": [
          {
            "category_key": "offense",
            "category_label": "Offense",
            "subscores": [
              { "key": "spacing", "label": "Spacing", "order": 0 },
              ...
            ]
          },
          { "category_key": "defense", ... }
        ]
      },
      "values": {
        "tier_values": { "None": 0.0, "Capable": 1.5, "Proficient": 3.0, "Elite": 6.0, "All-Time Great": 10.0 },
        "composite_coefficients": { "spacing_off_dribble": 0.5, ... },
        "amplitude_map": { ... },
        "rp_pd_boost": { ... },
        "theoretical_max": { "spacing": 25.0, ... },
        "vd_ext": { ... },
        "pd_down": { ... },
        "rp_up": { ... },
        "bell": { "min_inches": 72, "max_inches": 88, "down_steepness_base": 0.8, ... },
        "stacking_returns": [1.0, 0.5, 0.25, 0.1],
        "cohesion_rollup_weights": { ... }
      },
      "formula_refs": {
        "spacing": "spacing_v1",
        "finishing": "finishing_v1",
        "paint_touch": "paint_touch_v1",
        "anchor": "anchor_v1",
        "post_game": "post_game_v1",
        "pnr_screener": "pnr_screener_v1",
        "off_ball_impact": "off_ball_impact_v1",
        "shot_creation": "shot_creation_v1",
        "rebounding": "rebounding_v1",
        "transition": "transition_v1",
        "perimeter_defense": "perimeter_defense_v1",
        "interior_defense": "interior_defense_v1"
      },
      "meta": {
        "version_schema": 1,
        "bootstrap_source": "weights.py@<git sha>"
      }
    }

### Publish-gate violation shape

    interface PublishGateViolation {
      layer: 'L1' | 'L2' | 'L3' | 'L4' | 'L7';
      code: string;   // 'handler_not_registered', 'value_key_missing', 'subscore_orphan', 'skill_missing', 'changelog_empty'
      message: string;
      target?: string; // 'formula_refs.spacing', 'values.tier_values.Elite', etc.
    }

## Plan of Work

The work proceeds milestone-by-milestone. Each milestone leaves the system in a working state — backend imports, frontend builds, tests pass — even if the new feature isn't yet user-visible. Commit at each milestone boundary.

### M1: Schema + bootstrap migration

Write `supabase/migrations/20260516000000_evaluation_versions.sql`. Create the `evaluation_versions` table with the schema in "Data & API Changes", add partial unique indexes, add the slug-immutability trigger, enable RLS, add the two policies, and insert the `cohesion-v1` bootstrap row.

Generate the bootstrap blob first by writing `backend/scripts/dump_v1_blob.py`:

    """Dump the current cohesion_engine constants into the v1 Evaluation Version blob."""
    import json
    import hashlib
    from backend.services.cohesion_engine import weights as W
    from backend.services import skills as S

    payload = {
      "taxonomy": {
        "skills": [{"key": k, "label": v, "order": i} for i, (k, v) in enumerate(S.SKILL_LABELS.items())],
        "impact_traits": [...],
        "subscore_tree": [...]
      },
      "values": {
        "tier_values": W.TIER_VALUES,
        "composite_coefficients": W.COMPOSITE_COEFFICIENTS,
        ...
      },
      "formula_refs": {name: f"{name}_v1" for name in W.COMPOSITE_NAMES},
      "meta": {"version_schema": 1, "bootstrap_source": "weights.py + skills.py"}
    }

    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    h = hashlib.sha256(blob.encode()).hexdigest()
    print(json.dumps({"payload": payload, "payload_hash": h}, indent=2))

Run it once locally:

    cd /home/chrooks/projects/Cornerstone
    source backend/venv/bin/activate
    python backend/scripts/dump_v1_blob.py > supabase/migrations/data/evaluation_version_v1_seed.json

Then paste the payload + hash literally into the migration's `INSERT` statement. The on-disk seed file is committed for diffability against future bootstrap regenerations.

Acceptance: `supabase db push` applies cleanly. `psql` query returns one row with `slug='cohesion-v1'`, `status='published'`, `is_active=true`. `payload->'values'->'tier_values'->>'Elite'` equals `'6.0'`. Attempting `UPDATE evaluation_versions SET slug='other' WHERE slug='cohesion-v1'` raises the trigger error.

### M2: CohesionEngine class + handler registry decorator

Create `backend/services/cohesion_engine/engine.py`:

    from __future__ import annotations
    from typing import Callable, ClassVar, Any
    from dataclasses import dataclass

    @dataclass(frozen=True)
    class EvaluationVersion:
        id: str
        slug: str
        status: str
        payload: dict[str, Any]

        @property
        def values(self) -> dict[str, Any]:
            return self.payload["values"]

        @property
        def taxonomy(self) -> dict[str, Any]:
            return self.payload["taxonomy"]

        @property
        def formula_refs(self) -> dict[str, str]:
            return self.payload["formula_refs"]


    class CohesionEngine:
        _registry: ClassVar[dict[str, Callable]] = {}

        @classmethod
        def handler(cls, name: str) -> Callable:
            def deco(fn: Callable) -> Callable:
                if name in cls._registry:
                    raise RuntimeError(f"Formula Handler {name!r} already registered")
                cls._registry[name] = fn
                return fn
            return deco

        @classmethod
        def registered_handlers(cls) -> dict[str, Callable]:
            return dict(cls._registry)

        def __init__(self, version: EvaluationVersion):
            self.version = version

        def dispatch(self, handler_name: str, *args, **kwargs):
            try:
                fn = self._registry[handler_name]
            except KeyError as e:
                raise RuntimeError(f"No Formula Handler registered for name {handler_name!r}") from e
            return fn(self, *args, **kwargs)

Acceptance: pytest can `from backend.services.cohesion_engine.engine import CohesionEngine, EvaluationVersion`. A trivial test registers a handler and dispatches:

    def test_handler_register_and_dispatch():
        @CohesionEngine.handler("trivial_v1")
        def trivial(engine, x):
            return x * engine.version.values["coef"]

        v = EvaluationVersion(id="x", slug="x", status="draft", payload={"values": {"coef": 3}, "taxonomy": {}, "formula_refs": {}})
        e = CohesionEngine(v)
        assert e.dispatch("trivial_v1", 5) == 15

### M3: Refactor formula modules to receive `engine`

This is the largest mechanical step. For each formula module, add an `engine` parameter to public functions and replace `weights.py` constant imports with `engine.version.values[...]` lookups.

Order: `composites.py` first (most-imported), then the modules that depend on it (`cohesion.py`, `roster.py`, `synergies.py`, `accentuation.py`, `bell_curve.py`, `ratios.py`). Run pytest at each step; the existing test suite should stay green.

Then wrap each public function as a registered handler. Example for spacing:

    # backend/services/cohesion_engine/composites.py
    from .engine import CohesionEngine

    @CohesionEngine.handler("spacing_v1")
    def compute_spacing(engine: CohesionEngine, player_skills: dict) -> float:
        coef = engine.version.values["composite_coefficients"]
        # ... existing body, but references go through engine.version.values
        return ...

The 12 Subscores each become a registered handler. `evaluate_lineup` and `evaluate_roster` stay as direct methods on `CohesionEngine` — they orchestrate calls but the per-Subscore math is dispatched by name from `formula_refs`.

Update `backend/services/cohesion_engine/__init__.py` to eagerly import handler modules so decorators run:

    from .engine import CohesionEngine, EvaluationVersion
    from . import composites, cohesion, roster, synergies, accentuation, bell_curve, ratios  # noqa: F401 — eager-load for handler registration
    from .roster import evaluate_roster  # back-compat re-export

    __all__ = ["CohesionEngine", "EvaluationVersion", "evaluate_roster"]

Add a back-compat shim so existing callers don't break:

    # backend/services/cohesion_engine/__init__.py (continued)
    def evaluate_roster(*args, **kwargs):
        """Back-compat: build an Engine from the active Version and delegate."""
        from .repo import get_active_version  # see M4
        engine = CohesionEngine(version=get_active_version())
        return engine.evaluate_roster(*args, **kwargs)

Acceptance: full existing pytest suite passes. A new test scores a Lineup directly via `CohesionEngine(version=bootstrap_blob).evaluate_lineup(lineup)` and compares to the legacy path — outputs must be byte-for-byte equal (or within float epsilon). This proves the refactor is purely structural.

### M4: Evaluation Versions API

Implement `backend/services/evaluation_versions/repo.py` and `validator.py`, then `backend/api/evaluation_versions.py` blueprint, then register it in `backend/app.py`.

The publish flow runs as a single Supabase RPC or as a Python-side transaction:

    def publish_draft(draft_id, slug, changelog_note):
        violations = validate(draft_id, changelog_note)
        if violations:
            raise PublishGateError(violations)
        with supabase.transaction():
            supabase.table("evaluation_versions").update({"is_active": False}).eq("is_active", True).execute()
            supabase.table("evaluation_versions").update({
                "slug": slug,
                "status": "published",
                "changelog_note": changelog_note,
                "is_active": True,
                "published_at": "now()",
                "published_by": current_user_id(),
            }).eq("id", draft_id).execute()
        return get_version(draft_id)

The validator walks `formula_refs`, checks each name against `CohesionEngine.registered_handlers()` (L1), reads each registered handler's declared `required_value_keys` attribute (defaulted to empty if missing — most handlers can leave it empty for v1) (L2), confirms every Subscore in `taxonomy.subscore_tree` appears in `formula_refs` and vice versa (L3), confirms every Skill key referenced by handlers exists in `taxonomy.skills` (L4 — for v1 this is checked statically via a small `handler_skill_dependencies` dict, populated by hand per handler), and confirms `changelog_note` is non-empty (L7).

Acceptance: hit each endpoint with `curl` and confirm 200 / 4xx / 5xx as expected. The "create draft → patch → validate → publish" round-trip moves a draft to published and flips `is_active`.

### M5: Editor UI on `/admin/cohesion-calibration`

Add `EvaluationVersionHeader` and `DraftBanner` at the top of `frontend/app/admin/cohesion-calibration/page.tsx`. Add a `useEvaluationVersion` hook that fetches `active` and `draft` Versions, exposes a `patch(draft, jsonPatch)` mutator and a `publish(slug, note)` mutator.

Modify existing `WeightsEditor` so its onChange writes to the draft Version via the new hook instead of calling `PUT /api/cohesion-calibration/weights`. The existing `useCohesionWeights` hook can be adapted: it now wraps `useEvaluationVersion` and exposes the same surface (`weights`, `updateSection`).

The pending-changes count is derived by diffing the draft payload against the parent published payload (done in `useEvaluationVersion` via a deep-equal walk).

`DiffDrawer` renders the diff with three columns (Field, Published, Draft) grouped by section (values vs taxonomy). Each row has a "Revert" button that issues a JSON-Patch op restoring the published value.

`PublishDialog` calls `POST /drafts/<id>/validate` on open (with the typed changelog note debounced), displays violations inline, and only enables the "Publish" button when the gate is green and the slug input matches the regex.

Subscore Tree reorder: render the tree as a `react-dnd` or `@dnd-kit/sortable` list. On drop, patch the draft with the new order. Same for Skill / Impact Trait display-label rename (single text input per row).

Acceptance: manual verification per the steps in "Validation and Acceptance". The page renders header + banner + existing tabs. `npm run lint` clean.

### M6: Saved Team binding migration

Write `supabase/migrations/20260517000000_saved_team_evaluation_version_fk.sql`. Add `evaluation_version_id uuid REFERENCES evaluation_versions(id)`. Backfill from `evaluation_version` text. Make NOT NULL. Drop `evaluation_version` text column on `saved_team_evaluations`. Drop denormalized `evaluation_version` on `saved_teams` (read latest `saved_team_evaluations` row instead).

Update `backend/api/rosters.py` and any other writer of `saved_team_evaluations` to capture `evaluation_version_id` from `get_active_version().id` at score-time. Update reads to JOIN for slug display.

Acceptance: existing Saved Team Profile pages still render the slug. New Saves write the new FK column. `psql` query confirms `saved_team_evaluations.evaluation_version_id IS NOT NULL` for every row.

### M7: Cleanup + validation

1. Delete `_WEIGHT_OVERRIDES` from `backend/api/cohesion_calibration.py` and its read/write helpers. The endpoint now reads/writes the active draft Version via the new repo.
2. Add header comments to `weights.py` and `services/skills.py` marking them bootstrap-only.
3. Run full pytest suite. Confirm no regressions.
4. Run `npm run lint` in `frontend/`. Confirm clean.
5. Start dev servers, walk the manual verification steps end-to-end, capture a screenshot or short transcript showing draft → publish → saved team binding.
6. Update `Progress` to all checked. Write `Outcomes & Retrospective`. Commit the cleanup.
7. Open PR against `main` referencing this ExecPlan + #9.

## Concrete Steps

Working directory is `/home/chrooks/projects/Cornerstone` unless otherwise noted.

### M1

    git checkout feat/issue-9-evaluation-version-publishing
    mkdir -p backend/scripts supabase/migrations/data
    # Author backend/scripts/dump_v1_blob.py
    source backend/venv/bin/activate
    python backend/scripts/dump_v1_blob.py > supabase/migrations/data/evaluation_version_v1_seed.json
    # Author supabase/migrations/20260516000000_evaluation_versions.sql, pasting the seed JSON
    supabase db push
    psql "$(supabase status --output env | grep DB_URL | cut -d= -f2-)" -c \
      "SELECT slug, status, is_active, payload->'values'->'tier_values'->>'Elite' AS elite_value FROM public.evaluation_versions;"

Expected:

      slug        |  status   | is_active | elite_value
    --------------+-----------+-----------+-------------
     cohesion-v1  | published | t         | 6.0

    git add backend/scripts/ supabase/migrations/
    git commit -m "feat(eval-version): add evaluation_versions table + cohesion-v1 bootstrap (#9)"

### M2

    # Author backend/services/cohesion_engine/engine.py
    # Author backend/tests/services/cohesion_engine/test_engine.py
    source backend/venv/bin/activate
    pytest backend/tests/services/cohesion_engine/test_engine.py -v

Expected: 2-3 tests pass (register, dispatch, double-register raises).

    git commit -am "feat(eval-version): add CohesionEngine class + handler registry decorator (#9)"

### M3

    # Refactor composites.py, cohesion.py, roster.py, synergies.py, accentuation.py, bell_curve.py, ratios.py
    # Add @CohesionEngine.handler decorators on each public formula
    # Update __init__.py for eager imports + back-compat shim
    pytest backend/tests/ -v

Expected: full existing test suite passes. Add a regression test that compares legacy `evaluate_roster()` output to `CohesionEngine(version=bootstrap_blob).evaluate_roster()` output on a canned roster fixture; assertEqual within 1e-9.

    git commit -am "refactor(eval-version): route formula modules through CohesionEngine (#9)"

### M4

    # Author backend/services/evaluation_versions/repo.py, validator.py
    # Author backend/api/evaluation_versions.py
    # Register blueprint in backend/app.py
    python -m flask run --port=5001 &
    BACKEND_PID=$!
    curl -s http://localhost:5001/api/evaluation-versions/active | jq
    # POST a draft create (auth required — use dev admin token)
    curl -s -X POST http://localhost:5001/api/evaluation-versions/drafts -H "Authorization: Bearer $DEV_ADMIN_JWT" | jq
    # patch, validate, publish, discard — each verified
    kill $BACKEND_PID

Expected: each endpoint returns the envelope shape and walks the state machine cleanly.

    git commit -am "feat(eval-version): /api/evaluation-versions endpoints (#9)"

### M5

    cd frontend && npm run dev &
    FRONTEND_PID=$!
    # Open http://localhost:3000/admin/cohesion-calibration
    # Verify "cohesion-v1 · published · active" badge in header
    # Click "New Draft", change TIER_VALUES.Elite from 6.0 to 7.0 in the Weights tab
    # Confirm DRAFT banner appears with "1 change pending"
    # Click "View diff" → drawer shows tier_values.Elite  6.0 → 7.0
    # Click "Publish" → dialog opens
    # Type changelog "test elite bump", confirm regex-validated slug suggestion, click Publish
    # Confirm header now shows new slug as active
    npm run lint
    kill $FRONTEND_PID

Expected: end-to-end UI flow completes; lint clean.

    git commit -am "feat(eval-version): Editor UI on /admin/cohesion-calibration (#9)"

### M6

    # Author supabase/migrations/20260517000000_saved_team_evaluation_version_fk.sql
    supabase db push
    # Update backend writers + frontend types
    pytest backend/tests/
    npm run lint --prefix frontend
    git commit -am "feat(eval-version): FK Saved Team → Evaluation Version (#9)"

### M7

    # Delete _WEIGHT_OVERRIDES from backend/api/cohesion_calibration.py
    # Add header comments to weights.py + services/skills.py
    pytest backend/tests/
    npm run lint --prefix frontend
    git commit -am "chore(eval-version): retire _WEIGHT_OVERRIDES + mark constants as bootstrap-only (#9)"
    git push
    gh pr create --base main --title "feat(eval-version): publishing system (#9)" --body "$(cat <<'EOF'
    ## Summary
    Implements v1 first Vertical Slice for #9 per `feature_requests/issue-9-evaluation-version-publishing-v1-plan.md` and ADR-0001/0002.

    ## Test plan
    - [ ] Verify cohesion-v1 bootstrap row exists and is active.
    - [ ] Create a draft, edit a TIER_VALUES entry, view diff, publish.
    - [ ] Save a new Team and confirm saved_team_evaluations.evaluation_version_id is set.
    - [ ] Existing pytest suite green.
    - [ ] npm run lint green.

    Closes #9 (v1 slice; v2 visual Formula Handler picker and v3 Saved Team reopen tracked separately).
    EOF
    )"

## Validation and Acceptance

The system is acceptable when all of the following are observable:

1. `psql` confirms exactly one row in `public.evaluation_versions` with `is_active = true`, `status = 'published'`, and a non-empty `payload` JSONB containing all of `taxonomy`, `values`, `formula_refs`, `meta`.
2. Attempting to insert a second `status='draft'` row fails with the partial-unique-index error from Postgres.
3. Attempting to update a published Version's slug fails with the `slug is immutable after publish` error from the trigger.
4. `GET /api/evaluation-versions/active` returns the bootstrap Version with status 200.
5. `POST /api/evaluation-versions/drafts` creates a draft. A second `POST` while one exists returns HTTP 409 with `{ error: "draft_already_exists" }`.
6. `PATCH /api/evaluation-versions/drafts/<id>` accepts a JSON-Patch op and persists the change atomically.
7. `POST /api/evaluation-versions/drafts/<id>/validate` returns `{ ok: false, violations: [...] }` when handler refs point at unregistered names or values are missing required keys, and `{ ok: true, violations: [] }` when the draft is structurally sound and the changelog note is non-empty.
8. `POST /api/evaluation-versions/drafts/<id>/publish` flips the draft to `published`, sets `is_active = true`, and atomically deactivates the previously active row.
9. The admin can complete the full end-to-end manual flow described below using only the browser.
10. The legacy `evaluate_roster()` import path remains green and produces the same numeric output as `CohesionEngine(version=bootstrap_blob).evaluate_roster()` on a canned roster fixture (a parity test added in M3 must pass).
11. New Saved Team evaluations write `evaluation_version_id` from `get_active_version().id`. `psql SELECT evaluation_version_id, slug FROM saved_team_evaluations JOIN evaluation_versions ON ...` returns the correct slug.

### Manual Verification Steps

1. From a clean checkout of the branch, run `supabase db push`. Confirm two new migrations apply cleanly.
2. Start the backend: `cd backend && source venv/bin/activate && python -m flask run --port=5001`. Confirm no import errors and that `/api/health` returns 200.
3. Start the frontend: `cd frontend && npm run dev`. Confirm `http://localhost:3000` loads.
4. Sign in as an admin user (one with `user_roles.role = 'admin'`).
5. Navigate to `http://localhost:3000/admin/cohesion-calibration`. Observe a header band that reads "cohesion-v1 · published · active". No DRAFT banner. The existing tabs (Lineup Tester, Bell Curves, Weights) remain.
6. Click the "New Draft" button in the header. The page transitions: DRAFT banner appears with amber styling, the slug switches to a stub like "cohesion-v1-draft" or shows "(unsaved draft)", and the pending-changes count reads "0 changes".
7. Switch to the Weights tab. Change the value for `TIER_VALUES.Elite` from `6.0` to `7.0`. The DRAFT banner's count increments to "1 change pending". The field gets a small "changed" dot indicator.
8. Click "View diff" in the banner. A drawer slides in from the right. It shows a single row: `values.tier_values.Elite` with columns "Published: 6.0" and "Draft: 7.0", plus a Revert button.
9. Click "Publish" in the banner. The Publish dialog opens. The slug input is pre-filled with `cohesion-v2`. Type `cohesion-v2-elite-bump`. Type a changelog note: "Bumped Elite tier from 6.0 to 7.0 to test publishing pipeline."
10. The dialog's gate output reads "All checks passed". The Publish button enables. Click Publish.
11. The dialog closes. The DRAFT banner disappears. The header band now reads "cohesion-v2-elite-bump · published · active".
12. Navigate to `/builder` (or whatever the Lab entry is), assemble a Team, and save it. Confirm the Saved Team detail page displays the new slug `cohesion-v2-elite-bump` somewhere — most likely in a small chip near the score.
13. Query `saved_team_evaluations` directly to verify `evaluation_version_id` resolves to the v2 row.

## Testing Plan

### Unit Tests

- `backend/tests/services/cohesion_engine/test_engine.py`:
  - register handler, dispatch.
  - duplicate registration raises.
  - dispatch unknown name raises.
- `backend/tests/services/cohesion_engine/test_parity.py`:
  - legacy `evaluate_roster()` matches `CohesionEngine(version=bootstrap_blob).evaluate_roster()` byte-for-byte on a canned roster fixture.
- `backend/tests/services/evaluation_versions/test_validator.py`:
  - L1 violation when `formula_refs` points at unregistered name.
  - L2 violation when required value key missing.
  - L3 orphan in both directions.
  - L4 handler-referenced Skill missing.
  - L7 empty changelog note.
  - happy path returns no violations.
- `backend/tests/services/evaluation_versions/test_repo.py`:
  - create draft from active.
  - patch draft applies JSON-Patch ops.
  - publish flips active flag atomically.
  - discard removes draft row.
  - single-draft Invariant enforced (second create fails).

### Integration Tests

- `backend/tests/api/test_evaluation_versions.py`:
  - GET active returns 200 + envelope.
  - POST drafts without admin returns 403.
  - POST drafts with admin returns 201; second POST returns 409.
  - PATCH draft applies change.
  - POST validate returns gate output.
  - POST publish flips active row atomically; returns 200.
  - DELETE draft hard-deletes.

### E2E Tests

Add a Playwright test under `frontend/e2e/admin/evaluation-versions.spec.ts`:

- Admin login.
- Visit `/admin/cohesion-calibration`.
- Click "New Draft".
- Edit a weight value in the Weights tab.
- Open diff drawer; confirm one row.
- Open Publish dialog; type slug + note; submit.
- Confirm header chrome switches to new slug + status.

## Idempotence and Recovery

- The schema migration is wrapped with `IF NOT EXISTS` / `IF EXISTS` clauses where Postgres allows it. Re-applying is safe; the bootstrap `INSERT` uses `ON CONFLICT (slug) DO NOTHING`.
- The Saved Team backfill UPDATE is idempotent (it always sets the FK to the matching slug).
- The CohesionEngine handler registry rejects duplicate registration (`RuntimeError`), so accidental re-imports surface loudly rather than silently overriding.
- If publish fails halfway, the atomic transaction rolls back: the draft remains in draft state, no row becomes active. The admin can retry.
- If the bootstrap script produces a different hash on a re-run (e.g., dict ordering drift), the seed file diff makes it obvious; commit only after `git diff` is empty.

## Artifacts and Notes

Example bootstrap blob excerpt (illustrative — exact shape comes from the dump script):

    {
      "taxonomy": {
        "skills": [
          {"key": "isolation_scorer", "label": "Isolation Scorer", "order": 0},
          {"key": "off_dribble_shooter", "label": "Off-Dribble Shooter", "order": 1}
        ],
        "subscore_tree": [
          {"category_key": "offense", "category_label": "Offense", "subscores": [
            {"key": "spacing", "label": "Spacing", "order": 0}
          ]}
        ]
      },
      "values": {
        "tier_values": {"None": 0.0, "Capable": 1.5, "Proficient": 3.0, "Elite": 6.0, "All-Time Great": 10.0}
      },
      "formula_refs": {"spacing": "spacing_v1"}
    }

Example diff drawer row payload sent from frontend → backend on Revert:

    POST /api/evaluation-versions/drafts/<id>
    {
      "patch": [
        {"op": "replace", "path": "/values/tier_values/Elite", "value": 6.0}
      ]
    }

## Interfaces and Dependencies

The following symbols must exist by the end of this plan:

- `backend/services/cohesion_engine/engine.py`:

      @dataclass(frozen=True)
      class EvaluationVersion:
          id: str
          slug: str
          status: str
          payload: dict

      class CohesionEngine:
          @classmethod
          def handler(cls, name: str) -> Callable: ...
          @classmethod
          def registered_handlers(cls) -> dict[str, Callable]: ...
          def __init__(self, version: EvaluationVersion): ...
          def dispatch(self, handler_name: str, *args, **kwargs): ...
          def evaluate_lineup(self, lineup) -> LineupCohesion: ...
          def evaluate_roster(self, roster) -> RosterEvaluation: ...

- `backend/services/evaluation_versions/repo.py`:

      def list_versions() -> list[EvaluationVersion]: ...
      def get_active() -> EvaluationVersion: ...
      def get_draft() -> EvaluationVersion | None: ...
      def get_version(id: str) -> EvaluationVersion: ...
      def create_draft_from_published(parent_id: str | None = None) -> EvaluationVersion: ...
      def patch_draft(draft_id: str, patch: list[dict]) -> EvaluationVersion: ...
      def publish_draft(draft_id: str, slug: str, changelog_note: str) -> EvaluationVersion: ...
      def discard_draft(draft_id: str) -> None: ...

- `backend/services/evaluation_versions/validator.py`:

      def validate(payload: dict, changelog_note: str | None) -> list[PublishGateViolation]: ...

- `backend/api/evaluation_versions.py` — Flask blueprint named `evaluation_versions_bp` with the seven endpoints listed in "Data & API Changes".

- `frontend/lib/api/evaluation-versions.ts`:

      export async function listEvaluationVersions(): Promise<EvaluationVersion[]>;
      export async function getActiveEvaluationVersion(): Promise<EvaluationVersion>;
      export async function getDraftEvaluationVersion(): Promise<EvaluationVersion | null>;
      export async function createDraft(parentId?: string): Promise<EvaluationVersion>;
      export async function patchDraft(id: string, patch: JsonPatch): Promise<EvaluationVersion>;
      export async function validateDraft(id: string, changelogNote: string): Promise<{ ok: boolean; violations: PublishGateViolation[] }>;
      export async function publishDraft(id: string, slug: string, changelogNote: string): Promise<EvaluationVersion>;
      export async function discardDraft(id: string): Promise<void>;

- `frontend/app/admin/cohesion-calibration/hooks/useEvaluationVersion.ts` — React hook exposing `active`, `draft`, `diff`, `patch(op)`, `publish(slug, note)`, `discardDraft()`.

## Allusion to v2 and v3 (so v1 does not paint into a corner)

The v1 design deliberately leaves room for two follow-on slices. These are *not* in scope here, but the v1 surfaces are shaped to accept them without rework:

- **v2 — visual Formula Handler picker.** When `#24` (PnR Ball Handler Impact Trait) and similar additions land, the Editor will need a way to add a Subscore to the Subscore Tree by selecting a registered handler from a list (`CohesionEngine.registered_handlers()` is the source). The v1 `formula_refs` field already exists in the payload; the Editor just doesn't surface it for editing yet. Adding the picker is purely additive on the frontend.

- **v3 — Saved Team Build reopen with compat check.** When the user reopens a Saved Team from before the active Evaluation Version, the Lab will run a compat check (compare the Saved Team's stored Version's taxonomy footprint to the active Version's, surface renames / removals / additions, let the user resolve them) before evaluating. The v1 schema already records `evaluation_version_id` on every Saved Team and keeps every published Version queryable in `evaluation_versions`. The compat check Surface lives at Lab open time, not at publish time (ADR-0002). Nothing in v1 prevents this; the bookkeeping is already in place.

The intentional "no" decisions in v1 (add/remove of Skills, add/remove of Impact Traits, edit `formula_refs` pointers, Saved Team impact preview in publish dialog) are the explicit boundary between v1 and v2/v3. Future-you reading the Editor will see those affordances **absent** and that absence is the contract.

## Revision Note

Initial version, 2026-05-15. Captures all decisions from the grilling session that produced ADR-0001 and ADR-0002. No revisions yet.
