ALTER TABLE public.released_players
  ADD COLUMN skill_trace_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.released_players.skill_trace_snapshot IS
  'Frozen per-skill condition trace + resolved override history, computed at publish time. Shape: {"computed": bool, "skills": {skill_name: {...}}}. Bare {} (computed key absent) for legend rows, which never get a freeze pass at all; computed: false with an empty-but-present skills map if trace computation failed for a non-legend player.';
