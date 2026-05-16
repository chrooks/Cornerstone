-- =============================================================================
-- Evaluation Versions table + cohesion-v1 bootstrap row
-- Issue: #9 Evaluation Version publishing
-- ADRs: 0001-engine-v2-hybrid-evaluator, 0002-saved-team-evaluation-version-binding
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.evaluation_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL,
  status          text NOT NULL DEFAULT 'draft',
  parent_id       uuid REFERENCES public.evaluation_versions(id) ON DELETE SET NULL,
  payload         jsonb NOT NULL,
  payload_hash    text NOT NULL,
  changelog_note  text,
  is_active       boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES auth.users(id),
  published_by    uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  archived_at     timestamptz,

  CONSTRAINT chk_evaluation_versions_status
    CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT chk_evaluation_versions_slug_format
    CHECK (slug ~ '^cohesion-[a-z0-9-]+$'),
  CONSTRAINT chk_evaluation_versions_changelog_on_publish
    CHECK (status = 'draft' OR changelog_note IS NOT NULL),
  CONSTRAINT chk_evaluation_versions_published_at
    CHECK (status = 'draft' OR published_at IS NOT NULL),
  CONSTRAINT chk_evaluation_versions_active_only_published
    CHECK (NOT is_active OR status = 'published'),
  CONSTRAINT uq_evaluation_versions_slug UNIQUE (slug)
);

-- ---------------------------------------------------------------------------
-- Partial unique indexes
-- ---------------------------------------------------------------------------

-- Exactly one draft at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_evaluation_versions_single_draft
  ON public.evaluation_versions (status)
  WHERE status = 'draft';

-- Exactly one active Version at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_evaluation_versions_single_active
  ON public.evaluation_versions (is_active)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Slug immutability trigger (after publish)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION evaluation_versions_lock_slug_after_publish()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'published' AND NEW.slug <> OLD.slug THEN
    RAISE EXCEPTION 'slug is immutable after publish (was %, attempted %)', OLD.slug, NEW.slug;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_evaluation_versions_lock_slug ON public.evaluation_versions;
CREATE TRIGGER trg_evaluation_versions_lock_slug
  BEFORE UPDATE ON public.evaluation_versions
  FOR EACH ROW EXECUTE FUNCTION evaluation_versions_lock_slug_after_publish();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.evaluation_versions ENABLE ROW LEVEL SECURITY;

-- Anyone can read (slugs surface on Saved Team detail)
CREATE POLICY "Anyone can read evaluation versions"
  ON public.evaluation_versions FOR SELECT USING (true);

-- Only service role manages writes (admin check happens in Flask)
CREATE POLICY "Service role manages evaluation versions"
  ON public.evaluation_versions FOR ALL USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Bootstrap row: cohesion-v1
-- ---------------------------------------------------------------------------

INSERT INTO public.evaluation_versions (
  slug,
  status,
  payload,
  payload_hash,
  is_active,
  published_at,
  changelog_note
)
VALUES (
  'cohesion-v1',
  'published',
  '{"formula_refs":{"anchor":"anchor_v1","finishing":"finishing_v1","interior_defense":"interior_defense_v1","off_ball_impact":"off_ball_impact_v1","paint_touch":"paint_touch_v1","perimeter_defense":"perimeter_defense_v1","pnr_screener":"pnr_screener_v1","post_game":"post_game_v1","rebounding":"rebounding_v1","shot_creation":"shot_creation_v1","spacing":"spacing_v1","transition":"transition_v1"},"meta":{"bootstrap_source":"weights.py + skills.py","version_schema":1},"taxonomy":{"impact_traits":[{"key":"spacing","label":"Spacing","order":0},{"key":"finishing","label":"Finishing","order":1},{"key":"paint_touch","label":"Paint Touch","order":2},{"key":"anchor","label":"Anchor","order":3},{"key":"post_game","label":"Post Game","order":4},{"key":"pnr_screener","label":"Pnr Screener","order":5},{"key":"off_ball_impact","label":"Off Ball Impact","order":6},{"key":"shot_creation","label":"Shot Creation","order":7},{"key":"rebounding","label":"Rebounding","order":8},{"key":"transition","label":"Transition","order":9},{"key":"perimeter_defense","label":"Perimeter Defense","order":10},{"key":"interior_defense","label":"Interior Defense","order":11}],"skills":[{"key":"crafty_finisher","label":"Scores at the rim using touch, body control, and foul-drawing ability rather than pure athleticism.","order":0},{"key":"cutter","label":"Scores effectively by cutting to the basket off-ball.","order":1},{"key":"driver","label":"Consistently attacks the paint from the perimeter off the dribble, generating driving lane pressure and paint touches.","order":2},{"key":"high_flyer","label":"Possesses elite explosive athleticism for above-the-rim plays, highlight dunks, and transition finishes.","order":3},{"key":"isolation_scorer","label":"Beats defenders one-on-one in isolation situations through dribble moves and athleticism.","order":4},{"key":"low_post_player","label":"Scores effectively with back-to-basket moves in the low post.","order":5},{"key":"mid_post_player","label":"Scores effectively from the mid-post/elbow area using face-up moves and mid-range shooting.","order":6},{"key":"movement_shooter","label":"Hits shots while relocating off screens and handoffs (not just standing still).","order":7},{"key":"off_dribble_shooter","label":"Creates and converts shots off the dribble, including pull-ups and step-backs.","order":8},{"key":"offensive_rebounder","label":"Consistently crashes offensive boards and converts second-chance opportunities.","order":9},{"key":"passer","label":"Creates quality shot opportunities for teammates through vision and passing skill.","order":10},{"key":"perimeter_disruptor","label":"Disrupts ball handlers through active hands, pressure, and contest at the point of attack.","order":11},{"key":"pnr_ball_handler","label":"Initiates and scores/creates effectively as the ball handler in pick-and-roll actions.","order":12},{"key":"pnr_finisher","label":"Scores effectively as the screener in pick-and-roll actions, whether rolling, popping, or slipping.","order":13},{"key":"rebounder","label":"Consistently secures defensive boards through positioning, boxing out, and effort.","order":14},{"key":"rim_protector","label":"Deters and blocks shots at the rim, altering opponent finishing attempts.","order":15},{"key":"screen_setter","label":"Sets quality screens that free teammates for open shots.","order":16},{"key":"spot_up_shooter","label":"Hits catch-and-shoot three-pointers and mid-range shots from set positions.","order":17},{"key":"transition_threat","label":"Scores effectively in the open court on fast breaks.","order":18},{"key":"versatile_defender","label":"Can guard multiple positional groups effectively when switched.","order":19},{"key":"vertical_spacer","label":"Threatens vertically as a lob target and above-the-rim finisher, creating driving lanes for teammates.","order":20}],"subscore_tree":[{"category_key":"offense","category_label":"Offense","subscores":[{"key":"spacing_creation_ratio","label":"Spacing / Creation Balance","order":0},{"key":"creation_offball_ratio","label":"Creation / Off-Ball Balance","order":1},{"key":"spacing_paint_touch_ratio","label":"Spacing / Paint Touch Balance","order":2},{"key":"paint_touch_total","label":"Paint Touch","order":3},{"key":"post_game_total","label":"Post Game","order":4},{"key":"pnr_pairing","label":"PnR Pairing","order":5},{"key":"collective_passing","label":"Collective Passing","order":6}]},{"category_key":"defense","category_label":"Defense","subscores":[{"key":"anchor_total","label":"Anchor","order":0},{"key":"defensive_coverage","label":"Defensive Coverage","order":1},{"key":"defensive_gaps","label":"Defensive Gaps","order":2},{"key":"perimeter_defense_total","label":"Perimeter Defense","order":3},{"key":"interior_defense_total","label":"Interior Defense","order":4}]},{"category_key":"versatility","category_label":"Versatility","subscores":[{"key":"rebounding","label":"Rebounding","order":0},{"key":"transition","label":"Transition","order":1},{"key":"rebound_transition_ratio","label":"Rebound / Transition Connection","order":2},{"key":"rebounding_spacing_deficit","label":"Rebounding Spacing Deficit","order":3},{"key":"accentuation_strength","label":"Accentuation Strength","order":4},{"key":"accentuation_weakness","label":"Accentuation Weakness","order":5}]}]},"values":{"accentuation_complementary_pairs":[["spacing","paint_touch"],["spacing","post_game"],["shot_creation","off_ball_impact"],["shot_creation","pnr_screener"],["perimeter_defense","interior_defense"],["perimeter_defense","transition"]],"accentuation_fallback_strength_threshold":6.0,"accentuation_fallback_weakness_threshold":2.0,"accentuation_min_strengths":1,"accentuation_strength_threshold":7.5,"accentuation_top_n":3,"accentuation_weakness_threshold":2.5,"amplitude_map":{"All-Time Great":4.0,"Capable":1.0,"Elite":3.0,"None":0.0,"Proficient":2.0},"anchor_depth_weight":0.1,"anchor_primary_weight":0.6,"anchor_secondary_weight":0.3,"archetype_labels":["offensive","defensive","transition","balanced","paint","shooting"],"bell":{"base_range":1,"down_steepness_base":0.8,"down_steepness_scale":0.05,"flat_top_divisor":3,"steepness_midpoint":80,"up_steepness_base":1.0,"up_steepness_scale":0.1},"cohesion_rollup_weights":{"accentuation_strength":0.04,"accentuation_weakness":0.04,"anchor_total":0.07,"collective_passing":0.05,"creation_offball_ratio":0.05,"defensive_coverage":0.12,"defensive_gaps":0.12,"interior_defense_total":0.03,"paint_touch_total":0.07,"perimeter_defense_total":0.03,"pnr_pairing":0.03,"post_game_total":0.03,"rebound_transition_ratio":0.04,"rebounding":0.05,"rebounding_spacing_deficit":0.03,"spacing_creation_ratio":0.1,"spacing_paint_touch_ratio":0.05,"transition":0.05},"composite_coefficients":{"anchor_screen_setter":0.3,"interior_defense_rebounder":0.3,"interior_defense_versatile_defender":0.25,"off_ball_finishing_scale":0.08,"off_ball_passer":0.3,"paint_touch_finishing_scale":0.08,"paint_touch_mid_post":0.7,"paint_touch_vertical_spacer":0.6,"perimeter_defense_versatile_defender":0.7,"pnr_screener_secondary_scale":0.15,"post_game_mid_post":0.7,"shot_creation_paint_touch":0.5,"shot_creation_spacing":0.3,"spacing_off_dribble":0.5,"transition_driver":0.3,"transition_high_flyer":0.7,"transition_passer_scale":0.2,"transition_spot_up":0.2},"composite_names":["spacing","finishing","paint_touch","anchor","post_game","pnr_screener","off_ball_impact","shot_creation","rebounding","transition","perimeter_defense","interior_defense"],"defensive_coverage_saturation_raw":2.7,"defensive_gap_penalty_scale":-1.5,"defensive_gap_threshold":1.5,"defensive_guard_density_height_range":[72,79],"defensive_rebounding_minimum":3.0,"defensive_rebounding_penalty_scale":2.0,"defensive_transition_boost_cap":2.0,"defensive_transition_boost_divisor":15.0,"depth_quality_weight":0.4,"depth_viable_ratio_weight":0.6,"height_max_inches":88,"height_min_inches":72,"lineup_archetype_max":3,"lineup_only_rollup_weights":{"archetype_diversity":0.1,"depth":0.0,"floor":0.0,"starting_5":0.9},"min_distribution_size":20,"normalization_breakpoint_percentile":0.6,"normalization_breakpoint_score":6.0,"note_capable_passer_threshold":3.0,"note_covered_composite_threshold":6.0,"note_elite_bell_amplitude_threshold":3.5,"note_elite_composite_threshold":8.0,"note_limit_per_type":3,"note_min_roster_size":5,"note_missing_composite_threshold":2.0,"note_severity_max":1.0,"note_severity_min":0.0,"note_stacked_composite_threshold":6.0,"note_stacked_player_count":2,"note_weak_composite_avg_threshold":4.0,"off_13_raw_spacing_threshold":15.0,"passing_depth_weight":0.4,"passing_primary_creator_weight":0.6,"pd_cross":{"height_max":75,"height_window":4,"scale":0.5},"pd_down":{"All-Time Great":8,"Capable":2,"Elite":6,"None":0,"Proficient":4},"peak_shift_pd_only":-1,"peak_shift_rp_only":1,"pnr_handler_depth_weight":0.1,"pnr_handler_primary_weight":0.65,"pnr_handler_secondary_weight":0.25,"pnr_handler_support_scale":0.35,"pnr_pairing_quality_gate_floor":0.7,"pnr_pairing_quality_gate_scale":0.3,"pnr_screener_depth_weight":0.15,"pnr_screener_primary_weight":0.55,"pnr_screener_secondary_weight":0.3,"post_game_depth_weight":0.15,"post_game_primary_weight":0.5,"post_game_secondary_weight":0.35,"ratio_asymmetric_full_penalty":1.0,"ratio_dead_zone":0.2,"ratio_default_penalty":0.5,"ratio_min_denominator":0.1,"rebounding_depth_weight":0.2,"rebounding_primary_weight":0.45,"rebounding_secondary_weight":0.35,"rebounding_spacing_deficit_threshold":5.0,"roster_rollup_weights":{"archetype_diversity":0.2,"depth":0.25,"floor":0.1,"starting_5":0.45},"rp_cross":{"height_min":80,"height_window":6,"scale":0.7},"rp_pd_boost":{"All-Time Great":1.0,"Capable":0.0,"Elite":0.5,"None":0.0,"Proficient":0.0},"rp_up":{"All-Time Great":6,"Capable":2,"Elite":5,"None":0,"Proficient":3},"stacking_returns":[1.0,0.5,0.25,0.1],"star_rating_max":5.0,"synergy_boosted_skills":{"OFF-02":["movement_shooter"],"OFF-03":["movement_shooter"],"OFF-04":["cutter"],"OFF-12":["cutter"],"OFF-13":["cutter"],"OFF-14":["cutter"],"OFF-15":["vertical_spacer"],"OFF-16":["vertical_spacer"],"OFF-31":["transition_threat"],"OFF-32":["high_flyer"]},"synergy_creator_threshold":6.0,"synergy_penalty_severity":5.0,"synergy_scale_factors":{"OFF-02":0.05,"OFF-03":0.03,"OFF-04":0.04,"OFF-12":0.05,"OFF-13":0.03,"OFF-14":0.04,"OFF-15":0.05,"OFF-16":0.05,"OFF-31":0.04,"OFF-32":0.03},"theoretical_max":{"anchor":41.0,"finishing":20.0,"interior_defense":18.0,"off_ball_impact":61.0,"paint_touch":85.8,"perimeter_defense":17.0,"pnr_screener":50.0,"post_game":17.0,"rebounding":20.0,"shot_creation":50.0,"spacing":25.0,"transition":42.0},"tier_values":{"All-Time Great":10.0,"Capable":1.5,"Elite":6.0,"None":0.0,"Proficient":3.0},"total_lineups_full_roster":126,"vd_ext":{"All-Time Great":9,"Capable":2,"Elite":5,"None":0,"Proficient":3},"viable_lineup_threshold":2.75,"warm_body":0.5}}'::jsonb,
  'aa52bc87131c72fd11a1308a492d3c39ed68da5711780b8d9da644389ec93cf3',
  true,
  now(),
  'Bootstrap from pre-versioning constants in services/cohesion_engine/weights.py and services/skills.py.'
)
ON CONFLICT (slug) DO NOTHING;
