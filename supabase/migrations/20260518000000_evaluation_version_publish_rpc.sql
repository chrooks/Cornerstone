-- =============================================================================
-- Atomic publish RPC for Evaluation Versions
-- Fixes: non-atomic two-step publish that could leave zero active Versions
-- =============================================================================

-- secdef-lint: allow-public reason=hardened-in-20260527000010_secdef_rpc_lockdown
CREATE OR REPLACE FUNCTION public.publish_evaluation_version(
  p_draft_id uuid,
  p_slug text,
  p_changelog_note text,
  p_published_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result_id uuid;
BEGIN
  -- Deactivate current active version
  UPDATE public.evaluation_versions
  SET is_active = false
  WHERE is_active = true;

  -- Promote draft to published + active
  UPDATE public.evaluation_versions
  SET slug = p_slug,
      status = 'published',
      changelog_note = p_changelog_note,
      is_active = true,
      published_at = now(),
      published_by = p_published_by
  WHERE id = p_draft_id
    AND status = 'draft'
  RETURNING id INTO v_result_id;

  IF v_result_id IS NULL THEN
    RAISE EXCEPTION 'Draft % not found or not in draft status', p_draft_id;
  END IF;

  RETURN v_result_id;
END;
$$;
