"""
Defensive bell curve geometry for the cohesion engine.

The bell curve is a small coverage model: each defender has a peak height they
guard best, a flat-top zone near that peak, and a quadratic taper toward the
edges. Lineup defense stacks those curves with diminishing returns.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .weights import (
    AMPLITUDE_MAP,
    BELL_BASE_RANGE,
    BELL_DOWN_STEEPNESS_BASE,
    BELL_DOWN_STEEPNESS_SCALE,
    BELL_FLAT_TOP_DIVISOR,
    BELL_STEEPNESS_MIDPOINT,
    BELL_UP_STEEPNESS_BASE,
    BELL_UP_STEEPNESS_SCALE,
    DEFENSIVE_GAP_PENALTY_SCALE,
    DEFENSIVE_GAP_THRESHOLD,
    HEIGHT_MAX_INCHES,
    HEIGHT_MIN_INCHES,
    PD_CROSS_HEIGHT_MAX,
    PD_CROSS_HEIGHT_WINDOW,
    PD_CROSS_SCALE,
    PD_DOWN,
    PEAK_SHIFT_PD_ONLY,
    PEAK_SHIFT_RP_ONLY,
    RP_CROSS_HEIGHT_MIN,
    RP_CROSS_HEIGHT_WINDOW,
    RP_CROSS_SCALE,
    RP_PD_BOOST,
    RP_UP,
    STACKING_RETURNS,
    VD_EXT,
    WARM_BODY,
)


def parse_height_inches(height: str | int | None) -> int | None:
    """Parse common height formats like '6-7' or '6\\'7\"' into inches."""
    if isinstance(height, int):
        return height
    if not height:
        return None

    normalized = height.strip().replace("'", "-").replace('"', "")
    if "-" not in normalized:
        return None

    feet, inches = normalized.split("-", maxsplit=1)
    try:
        return int(feet) * 12 + int(inches)
    except ValueError:
        return None


def _clamp_height(height_inches: int) -> int:
    """Keep the geometric model inside the supported 6'0\"-7'4\" range."""
    return max(HEIGHT_MIN_INCHES, min(HEIGHT_MAX_INCHES, height_inches))


def defensive_value_at_height(
    target_height: int,
    amplitude: float,
    peak_center: int,
    range_down: int,
    range_up: int,
    flat_top_down: int,
    flat_top_up: int,
    player_height: int = 78,
) -> float:
    """
    Return one defender's value against a target height.

    This is a trapezoid with a height-dependent power taper: full value near
    the peak, then a (1-t)^exponent decline to zero at the coverage boundary.
    The (1-t)^exp shape drops fast from peak and tapers gently near zero —
    modeling how defensive effectiveness degrades quickly outside a player's
    natural matchup range. The exponent varies by direction and player height:
    tall players drop off faster going short, short players drop off faster
    going tall. At the midpoint height, taper is linear (exponent=1.0).
    """
    if target_height > peak_center:
        distance = target_height - peak_center
        flat = flat_top_up
        total = range_up
        # Upward taper: shorter players get steeper exponent going up
        inches_from_mid = max(0, BELL_STEEPNESS_MIDPOINT - player_height)
        exponent = BELL_UP_STEEPNESS_BASE + inches_from_mid * BELL_UP_STEEPNESS_SCALE
    else:
        distance = peak_center - target_height
        flat = flat_top_down
        total = range_down
        # Downward taper: taller players get steeper exponent going down
        inches_from_mid = max(0, player_height - BELL_STEEPNESS_MIDPOINT)
        exponent = BELL_DOWN_STEEPNESS_BASE + inches_from_mid * BELL_DOWN_STEEPNESS_SCALE

    if distance <= flat:
        return amplitude

    taper = total - flat
    if taper <= 0 or distance > total:
        return 0.0

    t = (distance - flat) / taper
    return amplitude * max(0.0, (1.0 - t) ** exponent)


def compute_bell_params(skills: dict[str, str], height_inches: int) -> dict[str, float | int]:
    """Compute a player's defensive bell curve parameters from skills + height."""
    height_inches = _clamp_height(height_inches)

    vd = skills.get("versatile_defender", "None")
    pd = skills.get("perimeter_disruptor", "None")
    rp = skills.get("rim_protector", "None")

    # Amplitude captures the best defensive tool plus the warm-body floor.
    best_tier = max(
        AMPLITUDE_MAP.get(vd, 0.0),
        AMPLITUDE_MAP.get(pd, 0.0),
        AMPLITUDE_MAP.get(rp, 0.0),
    )
    amplitude = min(4.0, best_tier + WARM_BODY)

    has_vd = vd != "None"
    has_pd = pd != "None"
    has_rp = rp != "None"

    if has_pd and not has_vd and not has_rp:
        peak_center = height_inches + PEAK_SHIFT_PD_ONLY
    elif has_rp and not has_vd and not has_pd:
        peak_center = height_inches + PEAK_SHIFT_RP_ONLY
    else:
        peak_center = height_inches
    peak_center = _clamp_height(peak_center)

    # Cross-height bonuses: RP-only bigs extend downward, PD-only guards extend upward.
    # Using round() instead of int() so small fractional values (e.g. 0.75) aren't
    # truncated to zero — this was causing tall rim protectors to get no downward reach.
    rp_cross_down = 0
    if height_inches >= RP_CROSS_HEIGHT_MIN and not has_vd and not has_pd:
        scale = min(1.0, (height_inches - RP_CROSS_HEIGHT_MIN) / RP_CROSS_HEIGHT_WINDOW)
        rp_cross_down = round(RP_UP.get(rp, 0) * RP_CROSS_SCALE * scale)

    pd_cross_up = 0
    if height_inches <= PD_CROSS_HEIGHT_MAX and not has_vd and not has_rp:
        scale = min(1.0, (PD_CROSS_HEIGHT_MAX - height_inches) / PD_CROSS_HEIGHT_WINDOW)
        pd_cross_up = round(PD_DOWN.get(pd, 0) * PD_CROSS_SCALE * scale)

    range_down = BELL_BASE_RANGE + VD_EXT.get(vd, 0) + PD_DOWN.get(pd, 0) + rp_cross_down
    range_up = BELL_BASE_RANGE + VD_EXT.get(vd, 0) + RP_UP.get(rp, 0) + pd_cross_up

    return {
        "amplitude": amplitude,
        "peak_center": peak_center,
        "range_down": range_down,
        "range_up": range_up,
        "flat_top_down": max(0, range_down // BELL_FLAT_TOP_DIVISOR),
        "flat_top_up": max(0, range_up // BELL_FLAT_TOP_DIVISOR),
        "player_height": height_inches,
    }


def _closest_amplitude_tier(value: float) -> str:
    """
    Map a boosted defensive amplitude value back to the nearest tier string.

    Ties round upward so a half-tier RP boost has a visible effect on teammates.
    """
    return min(
        AMPLITUDE_MAP,
        key=lambda tier: (abs(AMPLITUDE_MAP[tier] - value), -AMPLITUDE_MAP[tier]),
    )


def _best_rim_protector_provider(lineup: list[dict[str, Any]]) -> tuple[int | None, str, float]:
    """Find the strongest rim protector so RP-to-PD boost excludes the provider."""
    best_index = None
    best_tier = "None"
    best_value = 0.0
    for index, player in enumerate(lineup):
        tier = player.get("skills", {}).get("rim_protector", "None")
        value = AMPLITUDE_MAP.get(tier, 0.0)
        if value > best_value:
            best_index = index
            best_tier = tier
            best_value = value
    return best_index, best_tier, best_value


def apply_rp_pd_boost(lineup: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Boost teammates' perimeter disruption when an Elite+ rim protector is present.

    The function returns copied player dictionaries only when a boost applies.
    Original lineup data remains untouched so later synergy stages can compose
    their own effective skill changes safely.
    """
    provider_index, provider_tier, _provider_value = _best_rim_protector_provider(lineup)
    boost = RP_PD_BOOST.get(provider_tier, 0.0)
    if provider_index is None or boost <= 0:
        return lineup

    boosted: list[dict[str, Any]] = []
    for index, player in enumerate(lineup):
        if index == provider_index:
            boosted.append(player)
            continue

        copied = deepcopy(player)
        skills = copied.setdefault("skills", {})
        current_value = AMPLITUDE_MAP.get(skills.get("perimeter_disruptor", "None"), 0.0)
        skills["perimeter_disruptor"] = _closest_amplitude_tier(current_value + boost)
        boosted.append(copied)

    return boosted


def _player_defensive_values(player: dict[str, Any]) -> list[float]:
    """Evaluate one player's bell curve at every supported target height."""
    height_inches = parse_height_inches(player.get("height"))
    if height_inches is None:
        return [0.0 for _height in range(HEIGHT_MIN_INCHES, HEIGHT_MAX_INCHES + 1)]

    params = compute_bell_params(player.get("skills", {}), height_inches)
    return [
        defensive_value_at_height(
            target_height=height,
            amplitude=float(params["amplitude"]),
            peak_center=int(params["peak_center"]),
            range_down=int(params["range_down"]),
            range_up=int(params["range_up"]),
            flat_top_down=int(params["flat_top_down"]),
            flat_top_up=int(params["flat_top_up"]),
            player_height=int(params["player_height"]),
        )
        for height in range(HEIGHT_MIN_INCHES, HEIGHT_MAX_INCHES + 1)
    ]


def compute_lineup_coverage_by_height(lineup: list[dict[str, Any]]) -> dict[int, float]:
    """Return stacked defensive coverage for each supported target height."""
    if not lineup:
        return {height: 0.0 for height in range(HEIGHT_MIN_INCHES, HEIGHT_MAX_INCHES + 1)}

    per_player_values = [_player_defensive_values(player) for player in lineup]
    coverage_by_height: dict[int, float] = {}

    for height_index in range(HEIGHT_MAX_INCHES - HEIGHT_MIN_INCHES + 1):
        values = sorted((values[height_index] for values in per_player_values), reverse=True)
        stacked = 0.0
        for defender_index, value in enumerate(values):
            return_factor = (
                STACKING_RETURNS[defender_index]
                if defender_index < len(STACKING_RETURNS)
                else STACKING_RETURNS[-1]
            )
            stacked += value * return_factor
        coverage_by_height[HEIGHT_MIN_INCHES + height_index] = stacked

    return coverage_by_height


def compute_lineup_defense(lineup: list[dict[str, Any]]) -> tuple[float, float, list[int]]:
    """
    Compute lineup defensive coverage, gap penalty, and uncovered height inches.

    At each target height, defenders stack with diminishing returns: strongest
    defender gets full credit, then 50%, 25%, and 10% for additional bodies.
    """
    coverage_by_height = compute_lineup_coverage_by_height(lineup)

    gap_positions = [
        height
        for height, coverage in coverage_by_height.items()
        if coverage < DEFENSIVE_GAP_THRESHOLD
    ]

    if gap_positions:
        min_coverage = min(coverage_by_height.values())
        max_gap_depth = DEFENSIVE_GAP_THRESHOLD - min_coverage
        gap_penalty = DEFENSIVE_GAP_PENALTY_SCALE * len(gap_positions) * max_gap_depth
    else:
        gap_penalty = 0.0

    average_coverage = sum(coverage_by_height.values()) / len(coverage_by_height)
    return round(average_coverage, 2), round(gap_penalty, 2), gap_positions


@dataclass(frozen=True)
class DefenseGapCluster:
    """A contiguous band of under-covered heights in the stacked bell curve."""

    start: int          # first uncovered inch (inclusive)
    end: int            # last uncovered inch (inclusive)
    deepest_inch: int   # inch with lowest coverage within the cluster
    deepest_coverage: float  # coverage value at the deepest inch


def cluster_defense_gaps(
    coverage_by_height: dict[int, float],
    gap_threshold: float,
) -> list[DefenseGapCluster]:
    """
    Split the coverage contour into clusters of consecutive under-covered inches.

    Each cluster represents a distinct defensive need — a band where adding a
    defender of the right height would have the most impact.
    """
    # Collect inches below threshold in sorted order.
    gap_inches = sorted(h for h, cov in coverage_by_height.items() if cov < gap_threshold)
    if not gap_inches:
        return []

    # Walk the sorted inches and split into clusters whenever consecutive
    # inches are more than 1 apart (i.e., a covered band separates them).
    clusters: list[DefenseGapCluster] = []
    run_start = gap_inches[0]
    prev = gap_inches[0]

    for inch in gap_inches[1:]:
        if inch > prev + 1:
            # Gap in the gap — finish current cluster, start new one.
            clusters.append(_build_cluster(coverage_by_height, run_start, prev))
            run_start = inch
        prev = inch

    # Close final cluster.
    clusters.append(_build_cluster(coverage_by_height, run_start, prev))
    return clusters


# Height bands for archetype mapping. The deepest inch in a cluster
# determines which archetype the suggestion recommends. Bands overlap
# slightly so boundary clusters get the more specific label.
_ARCHETYPE_BANDS: list[tuple[range, str, str]] = [
    (range(72, 77),  "perimeter_disruptor", "a defensive guard"),
    (range(77, 81),  "versatile_defender",  "a defensive wing"),
    (range(81, 84),  "versatile_defender",  "a switchable forward"),
    (range(84, 89),  "rim_protector",       "a rim protector"),
]


def gap_cluster_archetype(cluster: DefenseGapCluster) -> tuple[str, str]:
    """
    Map a gap cluster to (skill_key, human_label) based on its deepest inch.

    Returns the skill most likely to cover the gap and a label for suggestion
    text. Falls back to versatile_defender for edge cases.
    """
    for height_range, skill, label in _ARCHETYPE_BANDS:
        if cluster.deepest_inch in height_range:
            return skill, label
    return "versatile_defender", "a versatile defender"


def _build_cluster(
    coverage_by_height: dict[int, float],
    start: int,
    end: int,
) -> DefenseGapCluster:
    """Build a cluster from a contiguous run of under-covered inches."""
    deepest_inch = start
    deepest_coverage = coverage_by_height[start]
    for inch in range(start + 1, end + 1):
        cov = coverage_by_height[inch]
        if cov < deepest_coverage:
            deepest_inch = inch
            deepest_coverage = cov
    return DefenseGapCluster(
        start=start,
        end=end,
        deepest_inch=deepest_inch,
        deepest_coverage=round(deepest_coverage, 2),
    )
