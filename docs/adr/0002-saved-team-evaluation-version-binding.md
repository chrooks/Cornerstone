# Saved Team — Evaluation Version binding and re-eval policy

**Status:** accepted
**Date:** 2026-05-15
**Related issue:** #9 Evaluation Version publishing
**Related ADR:** [0001-engine-v2-hybrid-evaluator](./0001-engine-v2-hybrid-evaluator.md)
**Related memory:** `eval-version-editor-scope`

## Context

A Saved Team must remain explainable in the Evaluation Version it was scored under, even after newer Versions publish. Today `saved_team_evaluations.evaluation_version` is a `text` column defaulting to `'cohesion-v1'` with no FK target — there's no `evaluation_versions` table yet, and slug renames or row deletions would silently break historical bindings. The policy for what happens when a Saved Team is opened after a newer Version publishes is also undefined.

## Decision

1. **Binding shape: FK only, slug immutable after publish.** Drop `saved_team_evaluations.evaluation_version` text column. Add `evaluation_version_id uuid REFERENCES evaluation_versions(id)`. Slug lives on `evaluation_versions(slug text UNIQUE NOT NULL)`. A trigger or status-gated check forbids editing `slug` once the row's `status = 'published'`. Display always joins.

2. **Re-eval policy: never silent.** Saved Teams are **never re-scored** when a newer Evaluation Version publishes. The only path to re-evaluate is explicit user action: open the Saved Team as a Build in the Lab → system runs a compat check against the current active Evaluation Version → user resolves any taxonomy mismatches → evaluation runs under the current Version. The original `saved_team_evaluations` row is immutable history; a new row records the re-eval.

3. **Bootstrap.** The v1 migration inserts the `cohesion-v1` row into `evaluation_versions`, then `UPDATE saved_team_evaluations SET evaluation_version_id = (SELECT id FROM evaluation_versions WHERE slug = 'cohesion-v1')`, then drops the text column. The `saved_teams.evaluation_version` denormalized column added by an earlier migration is dropped or replaced with FK (defer choice to implementation; `saved_team_evaluations` is the authoritative log).

## Considered Alternatives

- **FK + denormalized slug snapshot on saved_team_evaluations** — rejected because immutable slugs make denormalization redundant and create drift risk.
- **Slug-as-PK, no FK** — rejected because Postgres-enforced referential integrity is cheap and prevents whole classes of bugs.
- **Silent re-eval on Version publish** — rejected because Saved Teams are user-owned and represent a specific snapshot of intent; the score shifting underneath the user violates the Honest Signifier contract.
- **Background re-eval queue** — rejected because compute cost scales with Saved Team count and the user might never reopen most of them. Lazy re-eval at Lab open time is sufficient.

## Consequences

- The Evaluation Version publish dialog (Standard publish gate per Q6) does not need to compute "N Saved Teams would re-score" impact previews. It can later show "N Saved Teams reference taxonomy that will need migration when reopened" once the compat check Surface lands, but that is v3 scope.
- Saved Team detail Surface can display the bound Version slug as a chip — explains "this Team was scored under `cohesion-v1`" without ambiguity.
- v3 work (Saved Team Build reopen with taxonomy migration UI) builds on this contract — compat check runs at Lab open, not at publish.
