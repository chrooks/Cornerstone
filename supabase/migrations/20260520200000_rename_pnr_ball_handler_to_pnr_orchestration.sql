-- =============================================================================
-- Rename PnR Ball Handler Impact Trait to PnR Orchestration
-- Distinguishes the Impact Trait key from the pnr_ball_handler Skill key
-- =============================================================================

-- 1. Rename in theoretical_max
UPDATE public.evaluation_versions
SET payload = payload
  #- '{values,theoretical_max,pnr_ball_handler}'
  || jsonb_build_object('values',
       payload->'values' || jsonb_build_object('theoretical_max',
         (payload->'values'->'theoretical_max') - 'pnr_ball_handler'
         || jsonb_build_object('pnr_orchestration', payload->'values'->'theoretical_max'->'pnr_ball_handler')
       )
     )
WHERE status = 'published'
  AND payload->'values'->'theoretical_max' ? 'pnr_ball_handler';

-- 2. Rename in formula_refs
UPDATE public.evaluation_versions
SET payload = payload || jsonb_build_object('formula_refs',
  (payload->'formula_refs') - 'pnr_ball_handler'
  || '{"pnr_orchestration": "pnr_orchestration_v1"}'::jsonb
)
WHERE status = 'published'
  AND payload->'formula_refs' ? 'pnr_ball_handler';

-- 3. Rename in composite_names array
UPDATE public.evaluation_versions
SET payload = jsonb_set(
  payload,
  '{values,composite_names}',
  (
    SELECT jsonb_agg(
      CASE WHEN elem = 'pnr_ball_handler' THEN 'pnr_orchestration' ELSE elem END
    )
    FROM jsonb_array_elements_text(payload->'values'->'composite_names') AS t(elem)
  )
)
WHERE status = 'published'
  AND payload->'values'->'composite_names' @> '"pnr_ball_handler"';

-- 4. Rename in taxonomy impact_traits array
UPDATE public.evaluation_versions
SET payload = jsonb_set(
  payload,
  '{taxonomy,impact_traits}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN elem->>'key' = 'pnr_ball_handler'
        THEN jsonb_set(jsonb_set(elem, '{key}', '"pnr_orchestration"'), '{label}', '"PnR Orchestration"')
        ELSE elem
      END
      ORDER BY (elem->>'order')::int
    )
    FROM jsonb_array_elements(payload->'taxonomy'->'impact_traits') AS t(elem)
  )
)
WHERE status = 'published'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload->'taxonomy'->'impact_traits') AS t(elem)
    WHERE elem->>'key' = 'pnr_ball_handler'
  );
