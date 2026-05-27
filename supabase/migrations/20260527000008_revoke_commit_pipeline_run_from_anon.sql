-- M2 fix-forward 1: belt-and-suspenders REVOKE for commit_pipeline_run.
--
-- Supabase auto-grants EXECUTE directly to the `anon` and `authenticated`
-- roles (in addition to PUBLIC) when a function is created. REVOKE FROM PUBLIC
-- alone (migration 20260527000007) is insufficient because Postgres evaluates
-- direct role grants independently of PUBLIC grants. A role that holds a direct
-- EXECUTE grant is not affected by REVOKE FROM PUBLIC.
--
-- This migration explicitly REVOKEs from both roles and from PUBLIC, then
-- re-GRANTs only to service_role, achieving the intended security Contract.

REVOKE EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) TO service_role;
