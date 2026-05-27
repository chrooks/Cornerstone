-- Issue #57 follow-up: drop the stale 3-arg overload of publish_snapshot_draft.
--
-- Discovery query in production showed two `publish_snapshot_draft` rows in
-- pg_proc: a 4-arg version (uuid, text, boolean, boolean) — properly locked
-- down by 20260527000010 — and a 3-arg version (uuid, text, boolean) left
-- over from before 20260527000003 added p_allow_open_flags. Postgres treats
-- different argument counts as distinct functions, so subsequent
-- `CREATE OR REPLACE FUNCTION` calls only replaced the 4-arg signature; the
-- 3-arg overload sat in the catalog with the default grants
-- (PUBLIC + anon + authenticated) still attached.
--
-- The only application caller (backend/services/snapshot_versions/repo.py)
-- always passes the 4-arg form, so the 3-arg overload is dead code. Drop it.

DROP FUNCTION IF EXISTS public.publish_snapshot_draft(uuid, text, boolean);
