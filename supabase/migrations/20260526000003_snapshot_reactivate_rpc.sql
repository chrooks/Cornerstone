-- =============================================================================
-- Atomic reactivation RPC for Snapshot Releases (#53).
--
-- Switches the active Snapshot Release to a different previously-published
-- Release. Mirrors public.reactivate_evaluation_version.
--
-- Invariants:
--   * Target Release must already be status='published'  → 'not_published'
--   * No open draft/review may exist                     → 'draft_in_flight'
--   * data_cutoff_at is preserved (it records when those stats were frozen)
--   * published_at is bumped to now() (the re-publish moment)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reactivate_snapshot_release(
  p_release_id UUID
)
RETURNS public.snapshot_releases
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_release public.snapshot_releases;
  v_open_count INTEGER;
BEGIN
  -- Serialize the whole reactivation against any concurrent reactivation or
  -- publish. The partial unique index `idx_snapshot_releases_one_active`
  -- enforces the at-most-one-active invariant, but two concurrent sessions
  -- could both pass their per-row FOR UPDATE on different targets and then
  -- race on the deactivate→activate swap. A transaction-scoped advisory
  -- lock collapses that window.
  PERFORM pg_advisory_xact_lock(hashtext('snapshot_releases.active_swap'));

  -- Lock the target row so its status/is_active cannot drift after we read
  SELECT *
    INTO v_release
    FROM public.snapshot_releases
    WHERE id = p_release_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_not_found';
  END IF;

  IF v_release.status <> 'published' THEN
    RAISE EXCEPTION 'not_published';
  END IF;

  IF v_release.is_active THEN
    -- Already active — nothing to do, return current row
    RETURN v_release;
  END IF;

  -- Reject if any draft or review row is open (mirrors publish guard rails)
  SELECT COUNT(*)
    INTO v_open_count
    FROM public.snapshot_releases
    WHERE status IN ('draft', 'review');

  IF v_open_count > 0 THEN
    RAISE EXCEPTION 'draft_in_flight';
  END IF;

  -- Lock the current active row before deactivating (defense-in-depth on top
  -- of the advisory lock above).
  PERFORM 1
    FROM public.snapshot_releases
    WHERE is_active = true
    FOR UPDATE;

  -- Deactivate current active row (preserves its published_at/data_cutoff_at)
  UPDATE public.snapshot_releases
    SET is_active = false
    WHERE is_active = true;

  -- Activate target: bump published_at, leave data_cutoff_at as-is
  UPDATE public.snapshot_releases
    SET is_active = true,
        published_at = now()
    WHERE id = p_release_id
    RETURNING * INTO v_release;

  RETURN v_release;
END;
$$;
