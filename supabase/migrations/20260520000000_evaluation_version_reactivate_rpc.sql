-- =============================================================================
-- Atomic reactivation RPC for Evaluation Versions
-- Switches the active published Version to a different published Version
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reactivate_evaluation_version(
  p_version_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_status text;
  v_target_active boolean;
BEGIN
  -- Read target version
  SELECT status, is_active
  INTO v_target_status, v_target_active
  FROM public.evaluation_versions
  WHERE id = p_version_id;

  IF v_target_status IS NULL THEN
    RAISE EXCEPTION 'Evaluation Version % not found', p_version_id;
  END IF;

  IF v_target_status <> 'published' THEN
    RAISE EXCEPTION 'Evaluation Version % is not published (status: %)', p_version_id, v_target_status;
  END IF;

  IF v_target_active THEN
    RAISE EXCEPTION 'Evaluation Version % is already active', p_version_id;
  END IF;

  -- Deactivate current active version
  UPDATE public.evaluation_versions
  SET is_active = false
  WHERE is_active = true;

  -- Activate target version
  UPDATE public.evaluation_versions
  SET is_active = true
  WHERE id = p_version_id;

  RETURN p_version_id;
END;
$$;
