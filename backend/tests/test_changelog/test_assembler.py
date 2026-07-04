"""
Unit tests for the public changelog assembler (issue #18).

The assembler is a pure transform: it takes published RuleSet Version rows and
published Evaluation Version rows and normalizes them into a single
newest-first list of changelog entries. No DB, no network — just shaping.
"""

from __future__ import annotations

from services.changelog.assembler import assemble_changelog


# ---------------------------------------------------------------------------
# Sample rows mirroring the shapes the API layer fetches from Supabase.
# ---------------------------------------------------------------------------


def _ruleset_row(**overrides):
    row = {
        "version_label": "v2",
        "published_at": "2026-05-10T12:00:00+00:00",
        "ruleset_name": "All-Time",
        "ruleset_slug": "all-time",
    }
    row.update(overrides)
    return row


def _eval_row(**overrides):
    row = {
        "slug": "cohesion-v2",
        "changelog_note": "Rebalanced spacing weights.",
        "published_at": "2026-05-11T12:00:00+00:00",
    }
    row.update(overrides)
    return row


def _snapshot_row(**overrides):
    row = {
        "id": "rel-abc",
        "label": "Opening Night",
        "season": "2025-26",
        "published_at": "2026-05-12T12:00:00+00:00",
    }
    row.update(overrides)
    return row


# ---------------------------------------------------------------------------
# RuleSet Version entries
# ---------------------------------------------------------------------------


class TestRuleSetEntries:
    def test_produces_one_entry_per_ruleset_version(self):
        entries = assemble_changelog([_ruleset_row()], [])
        assert len(entries) == 1
        entry = entries[0]
        assert entry["type"] == "ruleset_version"
        assert entry["date"] == "2026-05-10T12:00:00+00:00"
        # The version label and Rule Set name are both surfaced.
        assert entry["version_label"] == "v2"
        assert "All-Time" in entry["title"]
        assert entry["summary"]  # non-empty human summary
        # Links into the Lab for that Rule Set when a slug is present.
        assert entry["link"] == "/lab/all-time"

    def test_ruleset_entry_without_slug_has_null_link(self):
        entries = assemble_changelog([_ruleset_row(ruleset_slug=None)], [])
        assert entries[0]["link"] is None


# ---------------------------------------------------------------------------
# Evaluation Version entries
# ---------------------------------------------------------------------------


class TestEvaluationEntries:
    def test_produces_one_entry_per_evaluation_version(self):
        entries = assemble_changelog([], [_eval_row()])
        assert len(entries) == 1
        entry = entries[0]
        assert entry["type"] == "evaluation_version"
        assert entry["date"] == "2026-05-11T12:00:00+00:00"
        assert entry["version_label"] == "cohesion-v2"
        # The admin-authored changelog note becomes the summary.
        assert entry["summary"] == "Rebalanced spacing weights."

    def test_evaluation_entry_falls_back_to_default_summary(self):
        entries = assemble_changelog([], [_eval_row(changelog_note=None)])
        # A published version with no note still gets a non-empty summary.
        assert entries[0]["summary"]

    def test_evaluation_entry_has_no_link(self):
        # Evaluation Versions are not user-navigable surfaces.
        entries = assemble_changelog([], [_eval_row()])
        assert entries[0]["link"] is None


# ---------------------------------------------------------------------------
# Snapshot Release entries (issue #78)
# ---------------------------------------------------------------------------


class TestSnapshotEntries:
    def test_produces_one_entry_per_snapshot_release(self):
        entries = assemble_changelog([], [], [_snapshot_row()])
        assert len(entries) == 1
        entry = entries[0]
        assert entry["type"] == "snapshot_release"
        assert entry["date"] == "2026-05-12T12:00:00+00:00"
        # The release label is the entry's identity in the changelog.
        assert entry["title"] == "Opening Night"
        assert entry["summary"]  # non-empty human summary
        # Snapshot Releases link to their public release diff page.
        assert entry["link"] == "/snapshots/rel-abc"

    def test_snapshot_title_falls_back_to_generic_without_label(self):
        entries = assemble_changelog([], [], [_snapshot_row(label="")])
        assert entries[0]["title"] == "2025-26 player snapshot"

    def test_snapshot_link_falls_back_to_players_without_id(self):
        entries = assemble_changelog([], [], [_snapshot_row(id=None)])
        assert entries[0]["link"] == "/players"

    def test_snapshot_entry_drops_when_unpublished(self):
        entries = assemble_changelog([], [], [_snapshot_row(published_at=None)])
        assert entries == []


# ---------------------------------------------------------------------------
# Merge + ordering
# ---------------------------------------------------------------------------


class TestMergeAndOrdering:
    def test_merges_both_sources_newest_first(self):
        entries = assemble_changelog([_ruleset_row()], [_eval_row()])
        assert len(entries) == 2
        # Eval row (2026-05-11) is newer than ruleset row (2026-05-10).
        assert entries[0]["type"] == "evaluation_version"
        assert entries[1]["type"] == "ruleset_version"

    def test_merges_all_three_sources_newest_first(self):
        entries = assemble_changelog(
            [_ruleset_row()], [_eval_row()], [_snapshot_row()]
        )
        assert len(entries) == 3
        # Snapshot (05-12) > eval (05-11) > ruleset (05-10).
        assert [e["type"] for e in entries] == [
            "snapshot_release",
            "evaluation_version",
            "ruleset_version",
        ]

    def test_drops_rows_without_published_at(self):
        entries = assemble_changelog(
            [_ruleset_row(published_at=None)],
            [_eval_row(published_at=None)],
            [_snapshot_row(published_at=None)],
        )
        assert entries == []

    def test_empty_inputs_produce_empty_list(self):
        assert assemble_changelog([], []) == []

    def test_respects_limit(self):
        rows = [
            _eval_row(slug=f"cohesion-v{i}", published_at=f"2026-05-{i:02d}T00:00:00+00:00")
            for i in range(1, 6)
        ]
        entries = assemble_changelog([], rows, limit=2)
        assert len(entries) == 2
        # Newest two retained.
        assert entries[0]["version_label"] == "cohesion-v5"
        assert entries[1]["version_label"] == "cohesion-v4"
