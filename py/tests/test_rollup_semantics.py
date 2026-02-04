from __future__ import annotations

from pathlib import Path

from gh_trending_analytics.query import DuckDBQueryService, QueryConfig
from gh_trending_analytics.rollup import rollup_kind
from helpers import build_fixture


def test_rollup_matches_raw(tmp_path: Path) -> None:
    analytics_root = build_fixture(tmp_path)
    rollup_kind(analytics_root=analytics_root, kind="repository", from_date=None)
    rollup_kind(analytics_root=analytics_root, kind="developer", from_date=None)

    with_rollups = DuckDBQueryService(QueryConfig(analytics_root=analytics_root, use_rollups=True))
    raw = DuckDBQueryService(QueryConfig(analytics_root=analytics_root, use_rollups=False))

    rollup_results = with_rollups.top_reappearing(
        "repository",
        "2025-01-01",
        "2025-01-02",
        language=None,
        presence="day",
        include_all_languages=False,
        limit=5,
    )
    raw_results = raw.top_reappearing(
        "repository",
        "2025-01-01",
        "2025-01-02",
        language=None,
        presence="day",
        include_all_languages=False,
        limit=5,
    )
    assert rollup_results == raw_results

    rollup_dev = with_rollups.top_reappearing(
        "developer",
        "2025-01-01",
        "2025-01-02",
        language=None,
        presence="day",
        include_all_languages=True,
        limit=5,
    )
    raw_dev = raw.top_reappearing(
        "developer",
        "2025-01-01",
        "2025-01-02",
        language=None,
        presence="day",
        include_all_languages=True,
        limit=5,
    )
    assert rollup_dev == raw_dev
