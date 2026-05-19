-- =============================================================================
-- Add PnR Ball Handler Impact Trait to all published Evaluation Versions
-- Adds composite coefficients, theoretical_max, formula_refs, taxonomy entries
-- =============================================================================

-- Add composite coefficients to all published versions
UPDATE public.evaluation_versions
SET payload = jsonb_set(
  jsonb_set(
    jsonb_set(
      payload,
      '{values,composite_coefficients,pnr_ball_handler_passer}', '0.3'::jsonb
    ),
    '{values,composite_coefficients,pnr_ball_handler_driver}', '0.3'::jsonb
  ),
  '{values,composite_coefficients,pnr_ball_handler_off_dribble}', '0.2'::jsonb
)
WHERE status = 'published';

-- Add theoretical_max entry
UPDATE public.evaluation_versions
SET payload = jsonb_set(
  payload,
  '{values,theoretical_max,pnr_ball_handler}', '28.8'::jsonb
)
WHERE status = 'published';

-- Add formula_refs entry
UPDATE public.evaluation_versions
SET payload = jsonb_set(
  payload,
  '{formula_refs,pnr_ball_handler}', '"pnr_ball_handler_v1"'::jsonb
)
WHERE status = 'published';

-- Add to composite_names array (insert after shot_creation at index 7)
-- First, rebuild the array with the new entry inserted
UPDATE public.evaluation_versions
SET payload = jsonb_set(
  payload,
  '{values,composite_names}',
  (
    SELECT jsonb_agg(elem)
    FROM (
      SELECT elem, ordinality
      FROM jsonb_array_elements_text(payload->'values'->'composite_names') WITH ORDINALITY AS t(elem, ordinality)
      UNION ALL
      SELECT 'pnr_ball_handler', 7.5  -- sorts between index 7 (shot_creation) and 8 (ball_security)
      ORDER BY ordinality
    ) sub
  )
)
WHERE status = 'published'
  AND NOT (payload->'values'->'composite_names' @> '"pnr_ball_handler"');

-- Add to taxonomy impact_traits array
UPDATE public.evaluation_versions
SET payload = jsonb_set(
  payload,
  '{taxonomy,impact_traits}',
  (
    SELECT jsonb_agg(elem ORDER BY (elem->>'order')::int)
    FROM (
      SELECT elem
      FROM jsonb_array_elements(payload->'taxonomy'->'impact_traits') AS t(elem)
      UNION ALL
      SELECT '{"key": "pnr_ball_handler", "label": "PnR Ball Handler", "order": 7}'::jsonb
    ) sub
  )
)
WHERE status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload->'taxonomy'->'impact_traits') AS t(elem)
    WHERE elem->>'key' = 'pnr_ball_handler'
  );
