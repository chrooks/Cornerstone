-- Canonicalize rules_hash (H3) and tighten rules RLS (L1).
--
-- H3: md5(rules_json::text) is not order-stable across Postgres versions
-- because jsonb::text key ordering is implementation-dependent. From this
-- point forward, rules_hash is computed application-side in Python using
-- json.dumps(rules_json, sort_keys=True, separators=(',',':')) → md5.
-- This migration updates the existing Standard v1 hash and all Saved Team
-- references to match the canonical Python-computed value.
--
-- L1: Replace open rules read policy with one scoped to active RuleSets.

-- -----------------------------------------------------------------------------
-- H3: Update existing rules_hash to canonical Python-computed value
-- -----------------------------------------------------------------------------

-- Standard v1 canonical hash computed by:
--   json.dumps(rules_json, sort_keys=True, separators=(',',':'))
--   → md5 hexdigest
-- Input: {"cornerstone_rule":"1 Legend required ($54M)","cornerstone_salary":54000000,"player_pool":"2025-26 Snapshot + Legends","rookie_deal_limit":2,"salary_cap":195000000,"salary_cap_display":"$195M","team_label":"Rotation","team_size":9}
-- Hash:  375b5966733c5d3dd5350098e70c55a0

UPDATE public.ruleset_versions
SET rules_hash = '375b5966733c5d3dd5350098e70c55a0'
WHERE version_label = 'v1'
  AND rules_hash != '375b5966733c5d3dd5350098e70c55a0';

-- Cascade to saved_teams referencing the old hash.
UPDATE public.saved_teams st
SET ruleset_version_hash = rv.rules_hash
FROM public.ruleset_versions rv
WHERE st.ruleset_version_id = rv.id
  AND st.ruleset_version_hash IS DISTINCT FROM rv.rules_hash;

-- -----------------------------------------------------------------------------
-- L1: Tighten rules table RLS to active RuleSets only
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can read rules" ON public.rules;

CREATE POLICY "Anyone can read active ruleset rules"
  ON public.rules
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.rulesets
      WHERE rulesets.id = rules.ruleset_id
        AND rulesets.status = 'active'
    )
  );
