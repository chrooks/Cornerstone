-- Allow saved_teams.cornerstone_legend_id to be NULL for RuleSets
-- where the cornerstone is an active player (e.g. Free For All).

ALTER TABLE public.saved_teams
  ALTER COLUMN cornerstone_legend_id DROP NOT NULL;
