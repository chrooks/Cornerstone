"""
Tests for defense gap clustering — splitting continuous gap ranges into
archetype-labeled sub-gaps based on the stacked coverage contour.
"""

from __future__ import annotations

from backend.services.cohesion_engine.bell_curve import cluster_defense_gaps, gap_cluster_archetype


def _flat_coverage(value: float) -> dict[int, float]:
    """Helper: uniform coverage at every inch from 72 to 88."""
    return {h: value for h in range(72, 89)}


def test_single_continuous_gap_produces_one_cluster():
    """A gap spanning 74-78 with no coverage should yield one cluster."""
    coverage = _flat_coverage(2.0)
    # Punch a hole from 74 to 78 (6'2" to 6'6")
    for h in range(74, 79):
        coverage[h] = 0.0

    clusters = cluster_defense_gaps(coverage, gap_threshold=1.5)

    assert len(clusters) == 1
    assert clusters[0].start == 74
    assert clusters[0].end == 78
    assert clusters[0].deepest_coverage == 0.0


def test_two_gaps_separated_by_covered_band():
    """Covered inches between two gaps produce two separate clusters."""
    coverage = _flat_coverage(2.0)
    # Gap 1: 73-75 (guard range)
    for h in range(73, 76):
        coverage[h] = 0.5
    # Gap 2: 82-85 (big range)
    for h in range(82, 86):
        coverage[h] = 0.3

    clusters = cluster_defense_gaps(coverage, gap_threshold=1.5)

    assert len(clusters) == 2
    assert clusters[0].start == 73
    assert clusters[0].end == 75
    assert clusters[1].start == 82
    assert clusters[1].end == 85


def test_no_gaps_returns_empty():
    """Full coverage everywhere means no clusters."""
    coverage = _flat_coverage(3.0)
    clusters = cluster_defense_gaps(coverage, gap_threshold=1.5)
    assert clusters == []


def test_deepest_inch_is_lowest_coverage_point():
    """The cluster identifies the inch with the worst coverage."""
    coverage = _flat_coverage(2.0)
    coverage[76] = 1.0
    coverage[77] = 0.2  # deepest
    coverage[78] = 0.8

    clusters = cluster_defense_gaps(coverage, gap_threshold=1.5)

    assert len(clusters) == 1
    assert clusters[0].deepest_inch == 77
    assert clusters[0].deepest_coverage == 0.2


def test_single_inch_gap():
    """A one-inch gap still produces a valid cluster."""
    coverage = _flat_coverage(2.0)
    coverage[80] = 0.0

    clusters = cluster_defense_gaps(coverage, gap_threshold=1.5)

    assert len(clusters) == 1
    assert clusters[0].start == 80
    assert clusters[0].end == 80
    assert clusters[0].deepest_inch == 80


def test_archetype_guard_range():
    """Gap centered in guard heights maps to defensive guard archetype."""
    coverage = _flat_coverage(2.0)
    for h in range(72, 77):
        coverage[h] = 0.0

    clusters = cluster_defense_gaps(coverage, gap_threshold=1.5)
    archetype, label = gap_cluster_archetype(clusters[0])

    assert archetype == "perimeter_disruptor"
    assert "guard" in label.lower()


def test_archetype_wing_range():
    """Gap centered in wing heights maps to versatile defender archetype."""
    coverage = _flat_coverage(2.0)
    for h in range(77, 81):
        coverage[h] = 0.0

    clusters = cluster_defense_gaps(coverage, gap_threshold=1.5)
    archetype, label = gap_cluster_archetype(clusters[0])

    assert archetype == "versatile_defender"
    assert "wing" in label.lower()


def test_archetype_forward_range():
    """Gap centered in forward heights maps to versatile defender."""
    coverage = _flat_coverage(2.0)
    for h in range(81, 84):
        coverage[h] = 0.0

    clusters = cluster_defense_gaps(coverage, gap_threshold=1.5)
    archetype, label = gap_cluster_archetype(clusters[0])

    assert archetype == "versatile_defender"
    assert "forward" in label.lower()


def test_archetype_big_range():
    """Gap centered in big heights maps to rim protector archetype."""
    coverage = _flat_coverage(2.0)
    for h in range(84, 89):
        coverage[h] = 0.0

    clusters = cluster_defense_gaps(coverage, gap_threshold=1.5)
    archetype, label = gap_cluster_archetype(clusters[0])

    assert archetype == "rim_protector"
    assert "rim protector" in label.lower() or "big" in label.lower()


def test_two_clusters_get_different_archetypes():
    """Guard gap + big gap should produce two clusters with distinct archetypes."""
    coverage = _flat_coverage(2.0)
    # Guard gap: 73-76
    for h in range(73, 77):
        coverage[h] = 0.0
    # Big gap: 85-88
    for h in range(85, 89):
        coverage[h] = 0.0

    clusters = cluster_defense_gaps(coverage, gap_threshold=1.5)

    assert len(clusters) == 2
    arch1, _ = gap_cluster_archetype(clusters[0])
    arch2, _ = gap_cluster_archetype(clusters[1])
    assert arch1 == "perimeter_disruptor"
    assert arch2 == "rim_protector"
