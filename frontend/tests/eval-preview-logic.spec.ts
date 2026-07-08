/**
 * Unit tests for the eval-impact hover preview pure logic (#92).
 * RED -> GREEN: tests first.
 *
 * placeCandidate must reproduce useRosterSlots.handlePlayerClick's placement
 * exactly — the preview simulates the same slot the click would fill (ADR
 * 0005: the preview must match the committed eval, placement included).
 */

import { test, expect } from "@playwright/test";
import { placeCandidate } from "../lib/candidate-placement";
import type { PlayerWithSkills } from "../lib/types";

function makePlayer(id: string, name = id): PlayerWithSkills {
  return { id, name, skills: {} } as PlayerWithSkills;
}

const A = makePlayer("a");
const B = makePlayer("b");
const CANDIDATE = makePlayer("cand", "Candidate");

test("fills the selected slot when one is targeted", () => {
  const slots = [A, null, null];

  const result = placeCandidate(slots, CANDIDATE, { selectedSlot: 3, cornerstoneId: "a" });

  expect(result).toEqual([A, null, CANDIDATE]);
  expect(slots[2]).toBeNull(); // input untouched (immutability)
});

test("falls back to the first free slot when nothing is selected", () => {
  const result = placeCandidate([A, null, B, null], CANDIDATE, {
    selectedSlot: null,
    cornerstoneId: "a",
  });

  expect(result).toEqual([A, CANDIDATE, B, null]);
});

test("ignores a selected cornerstone slot and uses the first free slot", () => {
  const result = placeCandidate([A, null], CANDIDATE, { selectedSlot: 1, cornerstoneId: "a" });

  expect(result).toEqual([A, CANDIDATE]);
});

test("returns null on a full roster", () => {
  const result = placeCandidate([A, B], CANDIDATE, { selectedSlot: null, cornerstoneId: "a" });

  expect(result).toBeNull();
});

test("returns null when the candidate is already rostered", () => {
  const result = placeCandidate([A, null], A, { selectedSlot: null, cornerstoneId: null });

  expect(result).toBeNull();
});

// ── topMovers (#92) — which subscores the candidate would move ──────────────

import { topMovers } from "../lib/eval-preview-movers";
import type { RosterEvaluation } from "../lib/types";

function makeEval(
  subscores: Record<string, number>,
  rotationMedians: Record<string, number> = {},
): RosterEvaluation {
  return {
    starting_lineup: { subscores },
    lineup_summary: { rotation_median_subscores: rotationMedians },
  } as unknown as RosterEvaluation;
}

test("names the top two starting-five movers by absolute delta", () => {
  const current = makeEval({ spacing: 5.0, finishing: 4.0, transition: 3.0 });
  const preview = makeEval({ spacing: 5.8, finishing: 3.5, transition: 3.1 });

  const movers = topMovers(current, preview);

  expect(movers.map((m) => m.key)).toEqual(["spacing", "finishing"]);
  expect(movers[0].delta).toBeCloseTo(0.8);
  expect(movers[0].source).toBe("starting_lineup");
});

test("falls back to Rotation Medians when the starting five is unchanged (bench add)", () => {
  const subs = { spacing: 5.0, finishing: 4.0 };
  const current = makeEval(subs, { spacing: 4.0, finishing: 3.0 });
  const preview = makeEval({ ...subs }, { spacing: 4.6, finishing: 3.0 });

  const movers = topMovers(current, preview);

  expect(movers).toHaveLength(1);
  expect(movers[0]).toMatchObject({ key: "spacing", source: "rotation" });
  expect(movers[0].delta).toBeCloseTo(0.6);
});

test("returns empty when nothing moves beyond the noise floor", () => {
  const current = makeEval({ spacing: 5.0 }, { spacing: 4.0 });
  const preview = makeEval({ spacing: 5.02 }, { spacing: 4.03 });

  expect(topMovers(current, preview)).toEqual([]);
});
