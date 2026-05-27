-- Issue #57: lock down all SECURITY DEFINER RPCs in the public schema.
--
-- Postgres grants EXECUTE to PUBLIC by default for SECURITY DEFINER functions,
-- and Supabase additionally auto-grants `anon` and `authenticated` directly.
-- Any caller holding the project's anon key can therefore invoke these RPCs
-- via POST /rest/v1/rpc/<fn>. We REVOKE from all three principals and GRANT
-- only `service_role` (server-side callers) so the RPCs become a backend-only
-- surface.
--
-- This migration is REVOKE/GRANT-only. Function bodies stay as their last
-- CREATE OR REPLACE FUNCTION definition (see audit in issue #57). REVOKE on an
-- already-revoked grant is a no-op, so the migration is idempotent.
--
-- The previously-hardened RPC `commit_pipeline_run` (migrations 20260527000007
-- and 20260527000008) is intentionally excluded — it is already locked down.

-- 1. publish_evaluation_version(uuid, text, text, uuid)
REVOKE EXECUTE ON FUNCTION public.publish_evaluation_version(uuid, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_evaluation_version(uuid, text, text, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_evaluation_version(uuid, text, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.publish_evaluation_version(uuid, text, text, uuid) TO service_role;
COMMENT ON FUNCTION public.publish_evaluation_version(uuid, text, text, uuid) IS
  'Atomic publish for Evaluation Versions. SECURITY DEFINER; executable only by service_role.';

-- 2. reactivate_evaluation_version(uuid)
REVOKE EXECUTE ON FUNCTION public.reactivate_evaluation_version(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reactivate_evaluation_version(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reactivate_evaluation_version(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reactivate_evaluation_version(uuid) TO service_role;
COMMENT ON FUNCTION public.reactivate_evaluation_version(uuid) IS
  'Switch the active Evaluation Version. SECURITY DEFINER; executable only by service_role.';

-- 3. publish_snapshot_draft(uuid, text, boolean, boolean)
REVOKE EXECUTE ON FUNCTION public.publish_snapshot_draft(uuid, text, boolean, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_snapshot_draft(uuid, text, boolean, boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_snapshot_draft(uuid, text, boolean, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.publish_snapshot_draft(uuid, text, boolean, boolean) TO service_role;
COMMENT ON FUNCTION public.publish_snapshot_draft(uuid, text, boolean, boolean) IS
  'Atomic publish for Snapshot Releases. SECURITY DEFINER; executable only by service_role.';

-- 4. reactivate_snapshot_release(uuid)
REVOKE EXECUTE ON FUNCTION public.reactivate_snapshot_release(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reactivate_snapshot_release(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reactivate_snapshot_release(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reactivate_snapshot_release(uuid) TO service_role;
COMMENT ON FUNCTION public.reactivate_snapshot_release(uuid) IS
  'Switch the active Snapshot Release. SECURITY DEFINER; executable only by service_role.';

-- 5. reset_working_state_from_active()
REVOKE EXECUTE ON FUNCTION public.reset_working_state_from_active() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_working_state_from_active() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_working_state_from_active() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reset_working_state_from_active() TO service_role;
COMMENT ON FUNCTION public.reset_working_state_from_active() IS
  'Rehydrate draft state from the active Snapshot Release. SECURITY DEFINER; executable only by service_role.';
