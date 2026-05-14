-- Phase 3: RLS policies for public/unlisted Saved Team visibility
-- Defense-in-depth — backend uses service-role key which bypasses RLS,
-- but these policies protect against direct Supabase client access.

-- saved_teams: anyone can SELECT public or unlisted teams
CREATE POLICY "Anyone can read public or unlisted saved teams"
  ON public.saved_teams
  FOR SELECT
  USING (visibility IN ('public', 'unlisted'));

-- saved_team_players: anyone can SELECT players belonging to a public/unlisted team
CREATE POLICY "Anyone can read players of public or unlisted saved teams"
  ON public.saved_team_players
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.saved_teams st
      WHERE st.id = saved_team_id
        AND st.visibility IN ('public', 'unlisted')
    )
  );

-- saved_team_evaluations: anyone can SELECT evaluations belonging to a public/unlisted team
CREATE POLICY "Anyone can read evaluations of public or unlisted saved teams"
  ON public.saved_team_evaluations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.saved_teams st
      WHERE st.id = saved_team_id
        AND st.visibility IN ('public', 'unlisted')
    )
  );
