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


def _clamp_height(height_inches: int, values: dict[str, Any]) -> int:
    """Keep the geometric model inside the supported 6'0\"-7'4\" range."""
    return max(values["height_min_inches"], min(values["height_max_inches"], height_inches))


def defensive_value_at_height(
    target_height: int,
    amplitude: float,
    peak_center: int,
    range_down: int,
    range_up: int,
    flat_top_down: int,
    flat_top_up: int,
    player_height: int = 78,
    values: dict[str, Any] | None = None,
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
    bell = (values or {}).get("bell", {})
    steepness_midpoint = bell.get("steepness_midpoint", 80)
    up_steepness_base = bell.get("up_steepness_base", 1.0)
    up_steepness_scale = bell.get("up_steepness_scale", 0.10)
    down_steepness_base = bell.get("down_steepness_base", 0.8)
    down_steepness_scale = bell.get("down_steepness_scale", 0.05)

    if target_height > peak_center:
        distance = target_height - peak_center
        flat = flat_top_up
        total = range_up
        # Upward taper: shorter players get steeper exponent going up
        inches_from_mid = max(0, steepness_midpoint - player_height)
        exponent = up_steepness_base + inches_from_mid * up_steepness_scale
    else:
        distance = peak_center - target_height
        flat = flat_top_down
        total = range_down
        # Downward taper: taller players get steeper exponent going down
        inches_from_mid = max(0, player_height - steepness_midpoint)
        exponent = down_steepness_base + inches_from_mid * down_steepness_scale

    if distance <= flat:
        return amplitude

    taper = total - flat
    if taper <= 0 or distance > total:
        return 0.0

    t = (distance - flat) / taper
    return amplitude * max(0.0, (1.0 - t) ** exponent)


def compute_bell_params(
    skills: dict[str, str], height_inches: int, values: dict[str, Any]
) -> dict[str, float | int]:
    """Compute a player's defensive bell curve parameters from skills + height."""
    height_inches = _clamp_height(height_inches, values)

    amplitude_map: dict[str, float] = values["amplitude_map"]
    warm_body: float = values["warm_body"]
    vd_ext: dict[str, int] = values["vd_ext"]
    pd_down: dict[str, int] = values["pd_down"]
    rp_up: dict[str, int] = values["rp_up"]
    rp_pd_boost: dict[str, float] = values["rp_pd_boost"]
    peak_shift_pd_only: int = values["peak_shift_pd_only"]
    peak_shift_rp_only: int = values["peak_shift_rp_only"]
    bell = values["bell"]
    rp_cross = values["rp_cross"]
    pd_cross = values["pd_cross"]

    vd = skills.get("versatile_defender", "None")
    pd = skills.get("perimeter_disruptor", "None")
    rp = skills.get("rim_protector", "None")

    # Amplitude captures the best defensive tool plus the warm-body floor.
    best_tier = max(
        amplitude_map.get(vd, 0.0),
        amplitude_map.get(pd, 0.0),
        amplitude_map.get(rp, 0.0),
    )
    amplitude = min(4.0, best_tier + warm_body)

    has_vd = vd != "None"
    has_pd = pd != "None"
    has_rp = rp != "None"

    if has_pd and not has_vd and not has_rp:
        peak_center = height_inches + peak_shift_pd_only
    elif has_rp and not has_vd and not has_pd:
        peak_center = height_inches + peak_shift_rp_only
    else:
        peak_center = height_inches
    peak_center = _clamp_height(peak_center, values)

    # Cross-height bonuses: RP-only bigs extend downward, PD-only guards extend upward.
    rp_cross_down = 0
    if height_inches >= rp_cross["height_min"] and not has_vd and not has_pd:
        scale = min(1.0, (height_inches - rp_cross["height_min"]) / rp_cross["height_window"])
        rp_cross_down = round(rp_up.get(rp, 0) * rp_cross["scale"] * scale)

    pd_cross_up = 0
    if height_inches <= pd_cross["height_max"] and not has_vd and not has_rp:
        scale = min(1.0, (pd_cross["height_max"] - height_inches) / pd_cross["height_window"])
        pd_cross_up = round(pd_down.get(pd, 0) * pd_cross["scale"] * scale)

    range_down = bell["base_range"] + vd_ext.get(vd, 0) + pd_down.get(pd, 0) + rp_cross_down
    range_up_val = bell["base_range"] + vd_ext.get(vd, 0) + rp_up.get(rp, 0) + pd_cross_up

    return {
        "amplitude": amplitude,
        "peak_center": peak_center,
        "range_down": range_down,
        "range_up": range_up_val,
        "flat_top_down": max(0, range_down // bell["flat_top_divisor"]) if bell.get("flat_top_divisor", 0) > 0 else 0,
        "flat_top_up": max(0, range_up_val // bell["flat_top_divisor"]) if bell.get("flat_top_divisor", 0) > 0 else 0,
        "player_height": height_inches,
    }


def _closest_amplitude_tier(value: float, amplitude_map: dict[str, float]) -> str:
    """
    Map a boosted defensive amplitude value back to the nearest tier string.

    Ties round upward so a half-tier RP boost has a visible effect on teammates.
    """
    return min(
        amplitude_map,
        key=lambda tier: (abs(amplitude_map[tier] - value), -amplitude_map[tier]),
    )


def _best_rim_protector_provider(
    lineup: list[dict[str, Any]], amplitude_map: dict[str, float]
) -> tuple[int | None, str, float]:
    """Find the strongest rim protector so RP-to-PD boost excludes the provider."""
    best_index = None
    best_tier = "None"
    best_value = 0.0
    for index, player in enumerate(lineup):
        tier = player.get("skills", {}).get("rim_protector", "None")
        value = amplitude_map.get(tier, 0.0)
        if value > best_value:
            best_index = index
            best_tier = tier
            best_value = value
    return best_index, best_tier, best_value


def apply_rp_pd_boost(lineup: list[dict[str, Any]], values: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Boost teammates' perimeter disruption when an Elite+ rim protector is present.

    The function returns copied player dictionaries only when a boost applies.
    Original lineup data remains untouched so later synergy stages can compose
    their own effective skill changes safely.
    """
    amplitude_map: dict[str, float] = values["amplitude_map"]
    rp_pd_boost: dict[str, float] = values["rp_pd_boost"]

    provider_index, provider_tier, _provider_value = _best_rim_protector_provider(
        lineup, amplitude_map
    )
    boost = rp_pd_boost.get(provider_tier, 0.0)
    if provider_index is None or boost <= 0:
        return lineup

    boosted: list[dict[str, Any]] = []
    for index, player in enumerate(lineup):
        if index == provider_index:
            boosted.append(player)
            continue

        copied = deepcopy(player)
        skills = copied.setdefault("skills", {})
        current_value = amplitude_map.get(skills.get("perimeter_disruptor", "None"), 0.0)
        skills["perimeter_disruptor"] = _closest_amplitude_tier(
            current_value + boost, amplitude_map
        )
        boosted.append(copied)

    return boosted


def _player_defensive_values(player: dict[str, Any], values: dict[str, Any]) -> list[float]:
    """Evaluate one player's bell curve at every supported target height."""
    height_min = values["height_min_inches"]
    height_max = values["height_max_inches"]

    height_inches = parse_height_inches(player.get("height"))
    if height_inches is None:
        return [0.0 for _height in range(height_min, height_max + 1)]

    params = compute_bell_params(player.get("skills", {}), height_inches, values)
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
            values=values,
        )
        for height in range(height_min, height_max + 1)
    ]


def compute_lineup_coverage_by_height(
    lineup: list[dict[str, Any]], values: dict[str, Any]
) -> dict[int, float]:
    """Return stacked defensive coverage for each supported target height."""
    height_min = values["height_min_inches"]
    height_max = values["height_max_inches"]
    stacking_returns: tuple[float, ...] = tuple(values["stacking_returns"])

    if not lineup:
        return {height: 0.0 for height in range(height_min, height_max + 1)}

    per_player_values = [_player_defensive_values(player, values) for player in lineup]
    coverage_by_height: dict[int, float] = {}

    for height_index in range(height_max - height_min + 1):
        height_values = sorted(
            (pv[height_index] for pv in per_player_values), reverse=True
        )
        stacked = 0.0
        for defender_index, value in enumerate(height_values):
            return_factor = (
                stacking_returns[defender_index]
                if defender_index < len(stacking_returns)
                else stacking_returns[-1]
            )
            stacked += value * return_factor
        coverage_by_height[height_min + height_index] = stacked

    return coverage_by_height


def compute_lineup_switchability(
    lineup: list[dict[str, Any]], values: dict[str, Any]
) -> tuple[float, float]:
    """
    Compute overlap density and floor compression for defensive switchability.

    Overlap density: average number of defenders with non-trivial coverage at each
    height, normalized to 0-10. More overlap = more switching options.

    Floor compression: min_coverage / max_coverage across heights, scaled to 0-10.
    Tighter ratio = fewer exploitable mismatches when switching.

    Returns (overlap_density_score, floor_compression_score), both on 0-10 scale.
    """
    height_min = values["height_min_inches"]
    height_max = values["height_max_inches"]
    coverage_threshold: float = values.get("switchability_coverage_threshold", 0.5)

    if not lineup:
        return 0.0, 0.0

    per_player_values = [_player_defensive_values(player, values) for player in lineup]
    height_count = height_max - height_min + 1

    total_overlap = 0.0
    min_coverage = float("inf")
    max_coverage = 0.0

    for height_index in range(height_count):
        height_values = [pv[height_index] for pv in per_player_values]
        contributors = sum(1 for v in height_values if v >= coverage_threshold)
        total_overlap += contributors

        stacked = sum(height_values)
        min_coverage = min(min_coverage, stacked)
        max_coverage = max(max_coverage, stacked)

    avg_overlap = total_overlap / height_count
    overlap_density_score = round(min(10.0, avg_overlap / len(lineup) * 10.0), 1)

    if max_coverage <= 0:
        floor_compression_score = 0.0
    else:
        floor_compression_score = round(min(10.0, min_coverage / max_coverage * 10.0), 1)

    return overlap_density_score, floor_compression_score


def compute_lineup_defense(
    lineup: list[dict[str, Any]], values: dict[str, Any]
) -> tuple[float, float, list[int]]:
    """
    Compute lineup defensive coverage, gap penalty, and uncovered height inches.

    At each target height, defenders stack with diminishing returns: strongest
    defender gets full credit, then 50%, 25%, and 10% for additional bodies.
    """
    gap_threshold: float = values["defensive_gap_threshold"]
    gap_penalty_scale: float = values["defensive_gap_penalty_scale"]

    coverage_by_height = compute_lineup_coverage_by_height(lineup, values)

    gap_positions = [
        height
        for height, coverage in coverage_by_height.items()
        if coverage < gap_threshold
    ]

    if gap_positions:
        min_coverage = min(coverage_by_height.values())
        max_gap_depth = gap_threshold - min_coverage
        gap_penalty = gap_penalty_scale * len(gap_positions) * max_gap_depth
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
