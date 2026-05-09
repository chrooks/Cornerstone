"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPOSITE_COLUMNS } from "@/lib/cohesion-constants";
import { formatSkillName } from "@/lib/skills";
import { AssistantGmNotes } from "./AssistantGmNotes";
import { CohesionDebugPanel } from "./CohesionDebugPanel";
import { FeedbackTooltip } from "./FeedbackTooltip";
import { SkillGrid } from "./SkillGrid";
import type { SuggestionFilter } from "@/lib/noteFilters";
import type {
  CohesionCompositeScores,
  CohesionPlayerComposites,
  LegendDetail,
  Note,
  PlayerSkillMap,
  PlayerWithSkills,
  RosterEvaluation,
} from "@/lib/types";

type FeedbackTab = "feedback" | "skills" | "debug";

const BREAKDOWN_LABELS: Record<string, string> = {
  starting_5: "Starting Lineup",
  depth: "Depth",
  archetype_diversity: "Versatility",
  floor: "Floor",
};

type CompositeKey = keyof CohesionCompositeScores;

const TIER_VALUES: Record<string, number> = {
  None: 0,
  Capable: 1.5,
  Proficient: 3,
  Elite: 6,
  "All-Time Great": 10,
};

const COMPOSITE_COEFFICIENTS = {
  spacing_off_dribble: 0.5,
  paint_touch_finishing_scale: 0.08,
  paint_touch_vertical_spacer: 0.6,
  paint_touch_mid_post: 0.7,
  anchor_screen_setter: 0.3,
  post_game_mid_post: 0.7,
  pnr_screener_secondary_scale: 0.15,
  off_ball_finishing_scale: 0.08,
  off_ball_passer: 0.3,
  shot_creation_spacing: 0.3,
  shot_creation_paint_touch: 0.5,
  transition_passer_scale: 0.2,
  transition_high_flyer: 0.7,
  transition_driver: 0.3,
  transition_spot_up: 0.2,
  perimeter_defense_versatile_defender: 0.7,
  interior_defense_versatile_defender: 0.25,
  interior_defense_rebounder: 0.3,
} as const;

const THEORETICAL_MAX: Record<CompositeKey, number> = {
  spacing: 25,
  finishing: 20,
  paint_touch: 85.8,
  anchor: 41,
  post_game: 17,
  pnr_screener: 50,
  off_ball_impact: 61,
  shot_creation: 50,
  rebounding: 20,
  transition: 42,
  perimeter_defense: 17,
  interior_defense: 18,
};

interface FormulaTerm {
  label: string;
  value: number;
  detail: string;
}

interface RawCompositeBreakdown {
  raw: number;
  terms: FormulaTerm[];
  note?: string;
}

interface BuilderFeedbackPanelProps {
  allSlots: (PlayerWithSkills | null)[];
  cornerstoneId: string | null;
  legendDetail: LegendDetail | null;
  isAdmin: boolean;
  latestEval: RosterEvaluation | null;
  inspectedPlayer: PlayerWithSkills | null;
  focusedPlayerName: string | null;
  onClearPlayerFocus: () => void;
  onCollapse: () => void;
  onEvaluation: (evaluation: RosterEvaluation) => void;
  onSuggestionFilter: (filter: SuggestionFilter, note: Note) => void;
}

function formatScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0.0";
  return value.toFixed(1);
}

function compositeValue(player: CohesionPlayerComposites, key: string): number {
  return (player.base as unknown as Record<string, number>)[key] ?? 0;
}

function compositeLabel(key: string): string {
  return COMPOSITE_COLUMNS.find((column) => column.key === key)?.label ?? key.replaceAll("_", " ");
}

function skillTier(skills: PlayerSkillMap | null | undefined, skill: string): string {
  return skills?.[skill] ?? "None";
}

function skillNumericValue(skills: PlayerSkillMap | null | undefined, skill: string): number {
  return TIER_VALUES[skillTier(skills, skill)] ?? 0;
}

function skillFormulaTerm(skills: PlayerSkillMap | null | undefined, skill: string, multiplier = 1): FormulaTerm {
  const tier = skillTier(skills, skill);
  const base = TIER_VALUES[tier] ?? 0;
  return {
    label: formatSkillName(skill),
    value: base * multiplier,
    detail: multiplier === 1 ? tier : `${tier} x ${multiplier}`,
  };
}

function compositeFormulaTerm(
  rawBreakdowns: Partial<Record<CompositeKey, RawCompositeBreakdown>>,
  key: CompositeKey,
  multiplier = 1,
): FormulaTerm {
  const raw = rawBreakdowns[key]?.raw ?? 0;
  return {
    label: `${compositeLabel(key)} raw`,
    value: raw * multiplier,
    detail: multiplier === 1 ? "composite input" : `composite input x ${multiplier}`,
  };
}

function sumTerms(terms: FormulaTerm[]): number {
  return terms.reduce((sum, term) => sum + term.value, 0);
}

function computeRawCompositeBreakdowns(skills: PlayerSkillMap | null | undefined): Record<CompositeKey, RawCompositeBreakdown> {
  const c = COMPOSITE_COEFFICIENTS;
  const raw = {} as Record<CompositeKey, RawCompositeBreakdown>;

  raw.spacing = {
    terms: [
      skillFormulaTerm(skills, "movement_shooter"),
      skillFormulaTerm(skills, "spot_up_shooter"),
      skillFormulaTerm(skills, "off_dribble_shooter", c.spacing_off_dribble),
    ],
    raw: 0,
  };
  raw.spacing.raw = sumTerms(raw.spacing.terms);

  raw.finishing = {
    terms: [
      skillFormulaTerm(skills, "high_flyer"),
      skillFormulaTerm(skills, "crafty_finisher"),
    ],
    raw: 0,
  };
  raw.finishing.raw = sumTerms(raw.finishing.terms);

  raw.rebounding = {
    terms: [
      skillFormulaTerm(skills, "rebounder"),
      skillFormulaTerm(skills, "offensive_rebounder"),
    ],
    raw: 0,
  };
  raw.rebounding.raw = sumTerms(raw.rebounding.terms);

  raw.perimeter_defense = {
    terms: [
      skillFormulaTerm(skills, "perimeter_disruptor"),
      skillFormulaTerm(skills, "versatile_defender", c.perimeter_defense_versatile_defender),
    ],
    raw: 0,
  };
  raw.perimeter_defense.raw = sumTerms(raw.perimeter_defense.terms);

  raw.interior_defense = {
    terms: [
      skillFormulaTerm(skills, "rim_protector"),
      skillFormulaTerm(skills, "versatile_defender", c.interior_defense_versatile_defender),
      skillFormulaTerm(skills, "rebounder", c.interior_defense_rebounder),
    ],
    raw: 0,
  };
  raw.interior_defense.raw = sumTerms(raw.interior_defense.terms);

  const finishingMultiplier = Math.max(1, 1 + c.paint_touch_finishing_scale * raw.finishing.raw);
  const paintTouchTerms = [
    skillFormulaTerm(skills, "driver"),
    skillFormulaTerm(skills, "vertical_spacer", c.paint_touch_vertical_spacer),
    skillFormulaTerm(skills, "low_post_player"),
    skillFormulaTerm(skills, "mid_post_player", c.paint_touch_mid_post),
  ];
  raw.paint_touch = {
    terms: [
      ...paintTouchTerms,
      {
        label: "Finishing multiplier",
        value: finishingMultiplier,
        detail: `1 + ${c.paint_touch_finishing_scale} x ${formatScore(raw.finishing.raw)} raw finishing`,
      },
    ],
    raw: sumTerms(paintTouchTerms) * finishingMultiplier,
    note: "Skill subtotal is multiplied by finishing, so finishers turn touches into stronger rim pressure.",
  };

  raw.anchor = {
    terms: [
      skillFormulaTerm(skills, "rebounder"),
      compositeFormulaTerm(raw, "interior_defense"),
      skillFormulaTerm(skills, "vertical_spacer"),
      skillFormulaTerm(skills, "screen_setter", c.anchor_screen_setter),
    ],
    raw: 0,
  };
  raw.anchor.raw = sumTerms(raw.anchor.terms);

  raw.post_game = {
    terms: [
      skillFormulaTerm(skills, "low_post_player"),
      skillFormulaTerm(skills, "mid_post_player", c.post_game_mid_post),
    ],
    raw: 0,
  };
  raw.post_game.raw = sumTerms(raw.post_game.terms);

  const pnrSecondaryMultiplier = Math.max(
    1,
    1 + c.pnr_screener_secondary_scale * (
      skillNumericValue(skills, "vertical_spacer") + skillNumericValue(skills, "spot_up_shooter")
    ),
  );
  raw.pnr_screener = {
    terms: [
      {
        label: formatSkillName("pnr_finisher"),
        value: skillNumericValue(skills, "pnr_finisher") * pnrSecondaryMultiplier,
        detail: `${skillTier(skills, "pnr_finisher")} x ${formatScore(pnrSecondaryMultiplier)}`,
      },
      skillFormulaTerm(skills, "screen_setter"),
    ],
    raw: 0,
    note: "Vertical spacing and spot-up shooting amplify the PnR finisher input.",
  };
  raw.pnr_screener.raw = sumTerms(raw.pnr_screener.terms);

  const passerTransitionMultiplier = Math.max(1, 1 + c.transition_passer_scale * skillNumericValue(skills, "passer"));
  raw.transition = {
    terms: [
      {
        label: formatSkillName("transition_threat"),
        value: skillNumericValue(skills, "transition_threat") * passerTransitionMultiplier,
        detail: `${skillTier(skills, "transition_threat")} x ${formatScore(passerTransitionMultiplier)}`,
      },
      skillFormulaTerm(skills, "high_flyer", c.transition_high_flyer),
      skillFormulaTerm(skills, "driver", c.transition_driver),
      skillFormulaTerm(skills, "spot_up_shooter", c.transition_spot_up),
    ],
    raw: 0,
    note: "Passing amplifies open-court threat before the athletic and shooting inputs are added.",
  };
  raw.transition.raw = sumTerms(raw.transition.terms);

  const cuttingFinishingMultiplier = Math.max(1, 1 + c.off_ball_finishing_scale * raw.finishing.raw);
  raw.off_ball_impact = {
    terms: [
      compositeFormulaTerm(raw, "spacing"),
      {
        label: formatSkillName("cutter"),
        value: skillNumericValue(skills, "cutter") * cuttingFinishingMultiplier,
        detail: `${skillTier(skills, "cutter")} x ${formatScore(cuttingFinishingMultiplier)}`,
      },
      skillFormulaTerm(skills, "passer", c.off_ball_passer),
    ],
    raw: 0,
    note: "Spacing plus cutting gravity drive this, with passing as a secondary input.",
  };
  raw.off_ball_impact.raw = sumTerms(raw.off_ball_impact.terms);

  raw.shot_creation = {
    terms: [
      skillFormulaTerm(skills, "pnr_ball_handler"),
      skillFormulaTerm(skills, "passer"),
      skillFormulaTerm(skills, "off_dribble_shooter"),
      skillFormulaTerm(skills, "isolation_scorer"),
      compositeFormulaTerm(raw, "spacing", c.shot_creation_spacing),
      compositeFormulaTerm(raw, "paint_touch", c.shot_creation_paint_touch),
    ],
    raw: 0,
    note: "This raw rating combines creation skills with spacing and rim-pressure composites.",
  };
  raw.shot_creation.raw = sumTerms(raw.shot_creation.terms);

  return raw;
}

function CompositeScoreTooltip({
  id,
  label,
  normalized,
  breakdown,
}: {
  id: string;
  label: string;
  normalized: number | null;
  breakdown: RawCompositeBreakdown | null;
}) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-[#0e0907]">{label}</p>
      {normalized == null ? (
        <p>Raw PlayerPool read. The normalized score appears after this Player is in the live evaluation.</p>
      ) : (
        <p>
          Normalized player composite:{" "}
          <span className="font-mono text-[#0e0907]">{formatScore(normalized)}</span> / 10.
          The raw score is bell-curve normalized against the player pool.
        </p>
      )}
      {breakdown && (
        <>
          <p>
            Raw score: <span className="font-mono text-[#0e0907]">{formatScore(breakdown.raw)}</span>
          </p>
          <div className="space-y-1">
            {breakdown.terms.map((term) => (
              <div key={`${id}-${term.label}`} className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="text-[#0e0907]/80">{term.label}</span>
                  <span className="ml-1 text-[#0e0907]/40">({term.detail})</span>
                </span>
                <span className="shrink-0 font-mono text-[#0e0907]">{formatScore(term.value)}</span>
              </div>
            ))}
          </div>
          {breakdown.note && <p className="border-t border-[#d9d0c9]/70 pt-2 text-[#0e0907]/55">{breakdown.note}</p>}
        </>
      )}
    </div>
  );
}

function ScoreExplainerTooltip({ score }: { score: number | null | undefined }) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-[#0e0907]">Score</p>
      <p>
        Current live evaluation: <span className="font-mono text-[#0e0907]">{formatScore(score)}</span> / 5.
      </p>
      <p>
        Built from lineup cohesion, depth, versatility, and floor checks. Higher means the current roster is scoring better as a complete build, not just stacking individual talent.
      </p>
    </div>
  );
}

function LineupMetricTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-[#0e0907]">{label}</p>
      <p>{children}</p>
    </div>
  );
}

function scoreTone(value: number): string {
  if (value >= 7) return "bg-[#059669]/10 text-[#047857] border-[#059669]/25";
  if (value >= 4) return "bg-[#d97706]/10 text-[#a34400] border-[#d97706]/25";
  return "bg-[#e53e3e]/10 text-[#b91c1c] border-[#e53e3e]/25";
}

function rawToTenPointScale(key: CompositeKey, raw: number): number {
  const max = THEORETICAL_MAX[key] ?? 10;
  if (max <= 0) return 0;
  return Math.min(10, Math.max(0, (raw / max) * 10));
}

function SectionLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-[#0e0907]/40">
      {children}
    </p>
  );
}

function RotationIdentityStrip({ evaluation }: { evaluation: RosterEvaluation | null }) {
  const compositeAverages = useMemo(() => {
    const players = evaluation?.player_composites ?? [];
    if (players.length === 0) return [];
    return COMPOSITE_COLUMNS.map((column) => {
      const total = players.reduce((sum, player) => sum + compositeValue(player, column.key), 0);
      return {
        ...column,
        value: total / players.length,
      };
    }).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [evaluation]);

  const archetypes = evaluation?.lineup_summary.archetype_labels ?? [];

  return (
    <section id="builder-skill-rotation-identity" className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionLabel id="builder-skill-rotation-identity-label">Build Trait Snapshot</SectionLabel>
          <h3 id="builder-skill-rotation-identity-title" className="mt-1 text-[1rem] font-semibold text-[#0e0907]">
            Roster Composite Averages
          </h3>
          <p id="builder-skill-rotation-identity-archetypes" className="mt-0.5 text-[0.75rem] text-[#0e0907]/55">
            Identity tags: <span className="font-medium text-[#0e0907]/70">{archetypes.length > 0 ? archetypes.join(" / ") : "Still forming"}</span>
          </p>
        </div>
        {evaluation && (
          <FeedbackTooltip
            id="builder-skill-rotation-score-tooltip"
            as="div"
            align="right"
            content={<ScoreExplainerTooltip score={evaluation.star_rating} />}
            className="shrink-0"
          >
            <div id="builder-skill-rotation-score" className="border border-[#d9d0c9] bg-[#f0f0f0]/60 px-3 py-2 text-right">
              <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[#0e0907]/40">Score</p>
              <p className="font-mono text-[1rem] font-semibold tabular-nums text-[#0e0907]">
                {evaluation.star_rating.toFixed(2)}
              </p>
            </div>
          </FeedbackTooltip>
        )}
      </div>

      {compositeAverages.length > 0 ? (
        <div id="builder-skill-rotation-composites" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {compositeAverages.map((item) => (
            <FeedbackTooltip
              key={item.key}
              id={`builder-skill-rotation-composite-${item.key}-tooltip`}
              as="div"
              content={(
                <LineupMetricTooltip label={item.label}>
                  Average normalized {item.label.toLowerCase()} score across the evaluated Players. This is a roster trait snapshot, not the weighted lineup subscore used by the engine.
                </LineupMetricTooltip>
              )}
              className="w-full"
            >
              <div id={`builder-skill-rotation-composite-${item.key}`} className="w-full border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[0.75rem] font-medium text-[#0e0907]/70">{item.label}</span>
                  <span className="font-mono text-[0.75rem] tabular-nums text-[#0e0907]">{formatScore(item.value)}</span>
                </div>
                <div className="mt-2 h-1.5 bg-[#d9d0c9]/45">
                  <div className="h-full bg-[#ffa05c]" style={{ width: `${Math.min(100, Math.max(0, item.value * 10))}%` }} />
                </div>
              </div>
            </FeedbackTooltip>
          ))}
        </div>
      ) : (
        <p id="builder-skill-rotation-empty" className="border border-dashed border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-3 text-[0.8125rem] text-[#0e0907]/55">
          Add Players to form a readable Rotation identity.
        </p>
      )}
    </section>
  );
}

function PlayerContributionInspector({
  evaluation,
  player,
}: {
  evaluation: RosterEvaluation | null;
  player: PlayerWithSkills | null;
}) {
  const composite = useMemo(() => {
    if (!evaluation || !player) return null;
    const playerName = player.name.toLowerCase();
    return evaluation.player_composites.find((item) => item.name.toLowerCase() === playerName) ?? null;
  }, [evaluation, player]);

  const rawBreakdowns = useMemo(() => computeRawCompositeBreakdowns(player?.skills), [player?.skills]);
  const ranked = useMemo(() => {
    return COMPOSITE_COLUMNS.map((column) => {
      const key = column.key as CompositeKey;
      const rawValue = rawBreakdowns[key]?.raw ?? 0;
      const normalizedValue = composite ? compositeValue(composite, column.key) : null;
      return {
        ...column,
        rawValue,
        normalizedValue,
        value: normalizedValue ?? rawToTenPointScale(key, rawValue),
      };
    }).sort((a, b) => b.value - a.value);
  }, [composite, rawBreakdowns]);

  const top = ranked.slice(0, 4);
  const gaps = ranked.slice(-4).reverse();

  return (
    <section id="builder-skill-player-contribution" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel id="builder-skill-player-contribution-label">Player Contribution</SectionLabel>
          <h3 id="builder-skill-player-contribution-title" className="mt-1 truncate text-[1rem] font-semibold text-[#0e0907]">
            {player ? player.name : "Hover Player or click slot"}
          </h3>
        </div>
        {player?.position && (
          <span id="builder-skill-player-position" className="border border-[#d9d0c9]/70 bg-[#f0f0f0]/60 px-2 py-1 text-[0.6875rem] font-medium text-[#0e0907]/55">
            {player.position}
          </span>
        )}
      </div>

      {!player && (
        <p id="builder-skill-player-empty" className="border border-dashed border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-3 text-[0.8125rem] text-[#0e0907]/55">
          Hover a Player in the PlayerPool or click a Rotation slot to inspect identity impact.
        </p>
      )}

      {player && !composite && (
        <p id="builder-skill-player-raw-mode" className="border border-[#d9d0c9]/60 bg-[#f0f0f0]/55 px-3 py-2 text-[0.75rem] text-[#0e0907]/55">
          Showing raw PlayerPool formulas. Normalized impact appears after this Player enters the live eval.
        </p>
      )}

      {player && ranked.length > 0 && (
        <div id="builder-skill-player-impact-grid" className="grid gap-3 xl:grid-cols-2">
          <div id="builder-skill-player-adds" className="space-y-2">
            <p className="text-[0.75rem] font-semibold text-[#0e0907]">Changes identity through</p>
            <div className="grid gap-2">
              {top.map((item) => (
                <FeedbackTooltip
                  key={item.key}
                  id={`builder-skill-player-adds-${item.key}-tooltip`}
                  as="div"
                  content={(
                    <CompositeScoreTooltip
                      id={`builder-skill-player-adds-${item.key}`}
                      label={item.label}
                      normalized={item.normalizedValue}
                      breakdown={rawBreakdowns[item.key as CompositeKey] ?? null}
                    />
                  )}
                  className="w-full"
                >
                  <div id={`builder-skill-player-adds-${item.key}`} className={cn("flex w-full items-center justify-between border px-3 py-2 transition-colors hover:border-[#ffa05c]/60", scoreTone(item.value))}>
                    <span className="truncate text-[0.75rem] font-medium">{item.label}</span>
                    <span className="font-mono text-[0.75rem] tabular-nums">
                      {item.normalizedValue == null ? `raw ${formatScore(item.rawValue)}` : formatScore(item.normalizedValue)}
                    </span>
                  </div>
                </FeedbackTooltip>
              ))}
            </div>
          </div>
          <div id="builder-skill-player-gaps" className="space-y-2">
            <p className="text-[0.75rem] font-semibold text-[#0e0907]">Does not cover</p>
            <div className="grid gap-2">
              {gaps.map((item) => (
                <FeedbackTooltip
                  key={item.key}
                  id={`builder-skill-player-gap-${item.key}-tooltip`}
                  as="div"
                  content={(
                    <CompositeScoreTooltip
                      id={`builder-skill-player-gap-${item.key}`}
                      label={item.label}
                      normalized={item.normalizedValue}
                      breakdown={rawBreakdowns[item.key as CompositeKey] ?? null}
                    />
                  )}
                  className="w-full"
                >
                  <div id={`builder-skill-player-gap-${item.key}`} className={cn("flex w-full items-center justify-between border px-3 py-2 transition-colors hover:border-[#ffa05c]/60", scoreTone(item.value))}>
                    <span className="truncate text-[0.75rem] font-medium">{item.label}</span>
                    <span className="font-mono text-[0.75rem] tabular-nums">
                      {item.normalizedValue == null ? `raw ${formatScore(item.rawValue)}` : formatScore(item.normalizedValue)}
                    </span>
                  </div>
                </FeedbackTooltip>
              ))}
            </div>
          </div>
          <div id="builder-skill-player-formula-index" className="space-y-2 xl:col-span-2">
            <p className="text-[0.75rem] font-semibold text-[#0e0907]">Formula index</p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {COMPOSITE_COLUMNS.map((column) => {
                const key = column.key as CompositeKey;
                const normalizedValue = composite ? compositeValue(composite, column.key) : null;
                const rawValue = rawBreakdowns[key]?.raw ?? 0;
                const toneValue = normalizedValue ?? rawToTenPointScale(key, rawValue);

                return (
                  <FeedbackTooltip
                    key={column.key}
                    id={`builder-skill-player-formula-${column.key}-tooltip`}
                    as="div"
                    content={(
                      <CompositeScoreTooltip
                        id={`builder-skill-player-formula-${column.key}`}
                        label={column.label}
                        normalized={normalizedValue}
                        breakdown={rawBreakdowns[key] ?? null}
                      />
                    )}
                    className="w-full"
                  >
                    <div id={`builder-skill-player-formula-${column.key}`} className={cn("flex w-full items-center justify-between border px-2.5 py-1.5 transition-colors hover:border-[#ffa05c]/60", scoreTone(toneValue))}>
                      <span className="truncate text-[0.6875rem] font-medium">{column.label}</span>
                      <span className="font-mono text-[0.6875rem] tabular-nums">
                        {normalizedValue == null ? `raw ${formatScore(rawValue)}` : formatScore(normalizedValue)}
                      </span>
                    </div>
                  </FeedbackTooltip>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function LineupImpactSummary({ evaluation }: { evaluation: RosterEvaluation | null }) {
  const breakdown = evaluation
    ? Object.entries(evaluation.star_rating_breakdown).map(([key, value]) => ({
      key,
      label: BREAKDOWN_LABELS[key] ?? key.replaceAll("_", " "),
      value,
    }))
    : [];

  return (
    <section id="builder-skill-lineup-impact" className="space-y-3">
      <SectionLabel id="builder-skill-lineup-impact-label">Lineup Impact</SectionLabel>
      {evaluation ? (
        <>
          <div id="builder-skill-lineup-summary" className="grid gap-2 sm:grid-cols-3">
            <FeedbackTooltip
              id="builder-skill-lineup-starting-tooltip"
              as="div"
              content={(
                <LineupMetricTooltip label="Starting Lineup">
                  Cohesion score for slots 1 through 5. It reflects how the starting group fits across spacing, creation, defense, rebounding, and synergy checks.
                </LineupMetricTooltip>
              )}
              className="w-full"
            >
              <div className="w-full border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
                <p className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-[#0e0907]/35">Starting Lineup</p>
                <p className="mt-1 font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">{evaluation.starting_lineup.cohesion_score.toFixed(2)}</p>
              </div>
            </FeedbackTooltip>
            <FeedbackTooltip
              id="builder-skill-lineup-viable-tooltip"
              as="div"
              content={(
                <LineupMetricTooltip label="Viable Combos">
                  Number of evaluated lineup combinations above the engine&apos;s viability floor. A high count means the build can survive substitutions.
                </LineupMetricTooltip>
              )}
              className="w-full"
            >
              <div className="w-full border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
                <p className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-[#0e0907]/35">Viable Combos</p>
                <p className="mt-1 font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">
                  {evaluation.lineup_summary.viable_lineups}/{evaluation.lineup_summary.total_lineups}
                </p>
              </div>
            </FeedbackTooltip>
            <FeedbackTooltip
              id="builder-skill-lineup-median-tooltip"
              as="div"
              align="right"
              content={(
                <LineupMetricTooltip label="Median">
                  Middle evaluated lineup score. It shows the typical substitution quality, not the best or worst group.
                </LineupMetricTooltip>
              )}
              className="w-full"
            >
              <div className="w-full border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
                <p className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-[#0e0907]/35">Median</p>
                <p className="mt-1 font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">{evaluation.lineup_summary.median_score.toFixed(2)}</p>
              </div>
            </FeedbackTooltip>
          </div>
          <div id="builder-skill-lineup-breakdown" className="grid gap-2 sm:grid-cols-2">
            {breakdown.map((item) => (
              <FeedbackTooltip
                key={item.key}
                id={`builder-skill-lineup-breakdown-${item.key}-tooltip`}
                as="div"
                content={(
                  <LineupMetricTooltip label={item.label}>
                    Contribution factor inside the final score. The engine combines these factors so a weakness can drag down an otherwise strong build.
                  </LineupMetricTooltip>
                )}
                className="w-full"
              >
                <div id={`builder-skill-lineup-breakdown-${item.key}`} className="w-full border border-[#d9d0c9]/60 bg-[#f0f0f0]/40 px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[0.75rem] text-[#0e0907]/65">{item.label}</span>
                    <span className="font-mono text-[0.75rem] tabular-nums text-[#0e0907]">{Math.round(item.value * 100)}%</span>
                  </div>
                </div>
              </FeedbackTooltip>
            ))}
          </div>
        </>
      ) : (
        <p id="builder-skill-lineup-empty" className="border border-dashed border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-3 text-[0.8125rem] text-[#0e0907]/55">
          Lineup impact appears after live eval.
        </p>
      )}
    </section>
  );
}

function SkillProfileDiagnostic({
  allSlots,
  cornerstoneId,
  legendDetail,
  latestEval,
  inspectedPlayer,
}: Pick<BuilderFeedbackPanelProps, "allSlots" | "cornerstoneId" | "legendDetail" | "latestEval" | "inspectedPlayer">) {
  return (
    <div id="builder-skill-profile-diagnostic" className="space-y-5">
      <RotationIdentityStrip evaluation={latestEval} />
      <PlayerContributionInspector evaluation={latestEval} player={inspectedPlayer} />
      <LineupImpactSummary evaluation={latestEval} />
      <section id="builder-skill-profile-matrix" className="space-y-3">
        <SectionLabel id="builder-skill-profile-matrix-label">Full Skill Profile</SectionLabel>
        <div className="h-[360px] overflow-hidden border border-[#d9d0c9]/70 bg-[#f7f7f7]">
          <SkillGrid
            allSlots={allSlots}
            cornerstoneId={cornerstoneId}
            legendProfile={legendDetail?.profile ?? null}
            hideEmptyColumns
          />
        </div>
      </section>
    </div>
  );
}

export function BuilderFeedbackPanel({
  allSlots,
  cornerstoneId,
  legendDetail,
  isAdmin,
  latestEval,
  inspectedPlayer,
  focusedPlayerName,
  onClearPlayerFocus,
  onCollapse,
  onEvaluation,
  onSuggestionFilter,
}: BuilderFeedbackPanelProps) {
  const [activeTab, setActiveTab] = useState<FeedbackTab>("feedback");
  const tabs: { id: FeedbackTab; label: string; adminOnly?: boolean }[] = [
    { id: "feedback", label: "Feedback" },
    { id: "skills", label: "Skill Profile" },
    { id: "debug", label: "Debug", adminOnly: true },
  ];

  const visibleTabs = tabs.filter((tab) => !tab.adminOnly || isAdmin);

  return (
    <div id="builder-feedback-panel" className="flex h-full min-w-0 flex-col overflow-hidden border border-[#d9d0c9] bg-[#f7f7f7]">
      <div id="builder-feedback-header" className="flex shrink-0 items-center justify-between gap-3 border-b border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-2">
        <div className="min-w-0">
          <div id="builder-feedback-tabs" className="flex items-center gap-1">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                id={`builder-feedback-tab-${tab.id}`}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-[#0e0907] text-[#f8f3f1]"
                    : "text-[#0e0907]/50 hover:bg-[#0e0907]/[0.04] hover:text-[#0e0907]/75",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {focusedPlayerName && (
            <p id="builder-feedback-focus-label" className="mt-1 truncate text-[0.6875rem] text-[#0e0907]/45">
              Showing {focusedPlayerName}
              <button
                id="builder-feedback-clear-focus"
                type="button"
                onClick={onClearPlayerFocus}
                className="ml-2 font-medium text-[#a34400] hover:text-[#fe6d34]"
              >
                Show all
              </button>
            </p>
          )}
        </div>
        <button
          id="builder-feedback-collapse-btn"
          type="button"
          onClick={onCollapse}
          title="Collapse feedback"
          className="flex size-7 shrink-0 items-center justify-center text-[#0e0907]/35 transition-colors hover:bg-[#0e0907]/[0.04] hover:text-[#0e0907]/65"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div id="builder-feedback-content" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
        {activeTab === "feedback" && (
          <AssistantGmNotes
            allSlots={allSlots}
            legendDetail={legendDetail}
            isAdmin={isAdmin}
            onEvaluation={onEvaluation}
            onSuggestionFilter={onSuggestionFilter}
            focusedPlayerName={focusedPlayerName}
          />
        )}

        {activeTab === "skills" && (
          <SkillProfileDiagnostic
            allSlots={allSlots}
            cornerstoneId={cornerstoneId}
            legendDetail={legendDetail}
            latestEval={latestEval}
            inspectedPlayer={inspectedPlayer}
          />
        )}

        {activeTab === "debug" && isAdmin && (
          <div id="builder-feedback-debug-panel" className="space-y-4">
            {latestEval ? (
              <>
                <CohesionDebugPanel evaluation={latestEval} />
                <details id="builder-feedback-debug-notes-json">
                  <summary className="cursor-pointer text-[0.625rem] font-semibold uppercase tracking-wider text-[#0e0907]/35 hover:text-[#0e0907]/60">
                    Raw Notes JSON
                  </summary>
                  <pre id="builder-feedback-debug-notes-json-content" className="mt-2 max-h-[400px] overflow-auto border border-[#d9d0c9]/60 bg-[#f0f0f0]/50 p-2 text-[0.5625rem] font-mono text-[#0e0907]/45 whitespace-pre-wrap">
                    {JSON.stringify(latestEval.notes, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <p id="builder-feedback-debug-empty" className="border border-dashed border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-3 text-[0.8125rem] text-[#0e0907]/55">
                Debug data appears after live eval.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
