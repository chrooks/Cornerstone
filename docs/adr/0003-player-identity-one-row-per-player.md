# Player identity — one row per Player; season history lives in Snapshot Releases

**Status:** accepted
**Date:** 2026-06-06
**Related issue:** #72 Replace the hardcoded '2025-26' season with a per-Snapshot-Release year
**Related plan:** `feature_requests/season-per-snapshot-release-plan.md`

## Context

Issue #72 replaces the hardcoded NBA season `'2025-26'` in the Snapshot Release
publish path with the release's own stored season (`snapshot_releases.season`).
That work surfaced a latent identity question: should the live, editable
`players` table hold **one row per Player**, or **one row per Player per season**
(stacked history)?

The schema carried a stale signal. The initial migration
(`supabase/migrations/20260325000000_initial_schema.sql`) commented
`players.nba_api_id` as "one row per Player per season", yet that column has a
global `UNIQUE NOT NULL` constraint — which makes per-season stacking impossible.
Review code already assumes `nba_api_id` is unique. The comment and the
constraint disagreed.

Frozen Snapshot Releases already capture a full, immutable copy of every Player's
evaluation data per release: `released_players` holds one frozen row per Player
or Legend, each with its own `stat_season` and `skill_profile_snapshot`. So
history is already recorded — in the releases, not in the live table.

## Decision

1. **One row per Player in the live `players` table.** `players.nba_api_id` keeps
   its global `UNIQUE NOT NULL` constraint. The live table is the current working
   set, not a history log.

2. **Season history lives in frozen Snapshot Releases**, not in stacked per-season
   `players` rows. Each published release is the authoritative record of how a
   Player's Skill Profile looked at that point in the season's lifecycle. A
   Player's (or Legend's) rating evolves release-to-release; the live table only
   ever shows the latest editable state.

3. **The stale comment is corrected.** Because applied migrations are immutable
   history, the fix is a fresh `COMMENT ON COLUMN public.players.nba_api_id` in
   the new migration (`20260606000000_publish_season_from_draft.sql`), not an edit
   to `20260325000000`. The corrected comment reads: "Globally unique NBA.com
   player id; one row per Player. Season history lives in Snapshot Releases
   (released_players), not in stacked per-season rows here."

4. **Season vs. label are two separate fields.** `snapshot_releases.season` is the
   NBA stat season (`YYYY-YY`) that drives the `nba_api` fetch, the freeze scope,
   and the gates. `snapshot_releases.label` is the free-text occasion (e.g.
   "Preseason", "Post-Playoffs"). Multiple releases in one season are distinct
   release rows that share one `season` and are told apart by `label`.

## Considered Alternatives

- **One row per Player per season (stacked history in `players`)** — rejected.
  It would re-key every roster / Saved-Team / cohesion query that points at
  `players`, drop the `nba_api_id` UNIQUE constraint that review code relies on,
  and duplicate history the frozen releases already hold.

- **A free-form season string serving both the stat key and the human occasion**
  — rejected. A free-form value would break the `nba_api` stat fetch and the
  freeze scope, both of which require a real NBA season key. In-season cadence is
  already expressible via separate release rows plus labels.

- **International seasons (Olympics/FIBA, e.g. `2024-OLY`) now** — deferred.
  International play is not an NBA stat season and is far down the roadmap. The
  season format is gated to NBA `YYYY-YY` now (`backend/services/season.py`); a
  documented extension point would add a separate validator later rather than
  loosening the current guard.

## Consequences

- Existing published releases do **not** orphan when the freeze season stops being
  `'2025-26'`. Lab read paths key off `snapshot_release_id`, never the season
  string (`released_repo.py`, `composites.py`), so old releases resolve untouched.
  No data backfill is required.

- The "gate scope = freeze scope" invariant holds for every frozen row, regular
  Player and Legend alike: both inherit the release's entered season at freeze.

- A future move to multi-season live editing (if ever needed) would be a
  deliberate, separately-designed change — not something the schema accidentally
  implies. This ADR is the record that the implied stacking was never intended.
