"""
test_get_diff_chunked_fetch.py

get_diff fetches current profiles (and player names) with a single .in_(player_id, [...])
query. PostgREST caps a response at 1000 rows by default, so a run touching many
players silently truncated the "current" side — players whose rows fell past row
1000 had no current profile, so every rated skill was misclassified as "new".

The fix chunks the IN-list so no single request can be truncated. These tests
pin the chunking helper's boundaries and aggregation.
"""

from __future__ import annotations

from services.pipeline_run_results.repo import (
    _fetch_in_chunks,
    _fetch_all_paged,
    _DIFF_FETCH_CHUNK,
    _DIFF_PAGE,
)


def test_chunk_size_stays_under_postgrest_default_page():
    """Each chunk × the few profile sources per player must stay under 1000 rows."""
    # Worst realistic case: stats + claude + composite (+ manual) = ~4 sources/player.
    assert _DIFF_FETCH_CHUNK * 4 < 1000


def test_fetch_in_chunks_aggregates_across_chunks():
    """Results from every chunk are concatenated into one list."""
    values = list(range(450))  # > 2 chunks at chunk size 200
    seen_chunks: list[list[int]] = []

    def fetch_chunk(chunk):
        seen_chunks.append(chunk)
        return [{"v": v} for v in chunk]

    out = _fetch_in_chunks(values, fetch_chunk)

    assert [r["v"] for r in out] == values            # nothing dropped
    assert len(seen_chunks) == 3                       # 200 + 200 + 50
    assert [len(c) for c in seen_chunks] == [200, 200, 50]
    assert all(len(c) <= _DIFF_FETCH_CHUNK for c in seen_chunks)


def test_fetch_in_chunks_handles_none_and_empty():
    """A chunk returning None contributes nothing; empty input yields []."""
    assert _fetch_in_chunks([], lambda c: []) == []
    assert _fetch_in_chunks([1, 2], lambda c: None) == []


def test_fetch_in_chunks_single_chunk_when_small():
    """A small input issues exactly one fetch."""
    calls = 0

    def fetch_chunk(chunk):
        nonlocal calls
        calls += 1
        return [{"v": v} for v in chunk]

    out = _fetch_in_chunks([1, 2, 3], fetch_chunk)
    assert calls == 1
    assert len(out) == 3


# ---------------------------------------------------------------------------
# _fetch_all_paged — keyset/offset pagination for run_id-filtered fetches
# ---------------------------------------------------------------------------


def _make_pager(total: int):
    """A fetch_page(offset, limit) over a synthetic table of `total` rows."""
    data = [{"i": i} for i in range(total)]
    calls: list[tuple[int, int]] = []

    def fetch_page(offset, limit):
        calls.append((offset, limit))
        return data[offset : offset + limit]

    return fetch_page, calls, data


def test_fetch_all_paged_reads_every_row_past_one_page():
    """A result larger than one page is fully read (the staged_rows truncation bug)."""
    total = _DIFF_PAGE + 123
    fetch_page, calls, data = _make_pager(total)

    out = _fetch_all_paged(fetch_page)

    assert out == data                       # nothing truncated
    assert len(calls) == 2                   # full page + short page
    assert calls[0][0] == 0 and calls[1][0] == _DIFF_PAGE


def test_fetch_all_paged_stops_on_short_page():
    """A single short page ends the loop without an extra fetch."""
    fetch_page, calls, data = _make_pager(10)
    out = _fetch_all_paged(fetch_page)
    assert out == data
    assert len(calls) == 1


def test_fetch_all_paged_exact_multiple_terminates():
    """An exact page-multiple total fetches one trailing empty page, then stops."""
    fetch_page, calls, data = _make_pager(_DIFF_PAGE)
    out = _fetch_all_paged(fetch_page)
    assert out == data
    assert len(calls) == 2                   # full page, then empty page signals end


def test_fetch_all_paged_handles_none_page():
    """A page returning None is treated as empty and ends the loop."""
    assert _fetch_all_paged(lambda o, l: None) == []
