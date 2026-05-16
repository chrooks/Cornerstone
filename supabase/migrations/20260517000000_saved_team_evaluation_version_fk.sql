-- =============================================================================
-- Saved Team Evaluation → Evaluation Version FK binding
-- Issue: #9 Evaluation Version publishing (M6)
-- =============================================================================

-- Step 1: Add nullable FK column
ALTER TABLE public.saved_team_evaluations
  ADD COLUMN IF NOT EXISTS evaluation_version_id uuid
  REFERENCES public.evaluation_versions(id) ON DELETE RESTRICT;

-- Step 2: Backfill from the text slug
UPDATE public.saved_team_evaluations ste
SET evaluation_version_id = (
  SELECT id FROM public.evaluation_versions WHERE slug = ste.evaluation_version
)
WHERE ste.evaluation_version_id IS NULL;

-- Step 3: Make NOT NULL (only if all rows backfilled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.saved_team_evaluations WHERE evaluation_version_id IS NULL
  ) THEN
    ALTER TABLE public.saved_team_evaluations ALTER COLUMN evaluation_version_id SET NOT NULL;
  END IF;
END $$;

-- Step 4: Drop the denormalized text column
ALTER TABLE public.saved_team_evaluations DROP COLUMN IF EXISTS evaluation_version;

-- Step 5: Drop the denormalized text column on saved_teams
-- (latest evaluation is read from saved_team_evaluations JOIN instead)
ALTER TABLE public.saved_teams DROP COLUMN IF EXISTS evaluation_version;
