from __future__ import annotations

from pathlib import Path

import pytest
from gh_trending_analytics.errors import InvalidRequestError
from gh_trending_analytics.query import DuckDBQueryService, QueryConfig
from helpers import build_fixture


def _service(tmp_path: Path) -> DuckDBQueryService:
    analytics_root = build_fixture(tmp_path)
    return DuckDBQueryService(QueryConfig(analytics_root=analytics_root))


def test_top_streaks_repository(tmp_path: Path) -> None:
    service = _service(tmp_path)
    results = service.top_streaks(
        "repository",
        "2025-01-01",
        "2025-01-02",
        language=None,
        include_all_languages=False,
        limit=5,
    )
    alpha = next(item for item in results if item["full_name"] == "alpha/one")
    assert alpha["streak_len"] == 2
    assert alpha["streak_start"] == "2025-01-01"
    assert alpha["streak_end"] == "2025-01-02"


def test_top_newcomers_repository(tmp_path: Path) -> None:
    service = _service(tmp_path)
    results = service.top_newcomers(
        "repository",
        "2025-01-02",
        "2025-01-02",
        language=None,
        include_all_languages=False,
        limit=5,
    )
    newcomers = {item["full_name"] for item in results}
    assert "delta/four" in newcomers


def test_invalid_range_rejected(tmp_path: Path) -> None:
    service = _service(tmp_path)
    with pytest.raises(InvalidRequestError):
        service.top_streaks(
            "repository",
            "2025-01-02",
            "2025-01-01",
            language=None,
            include_all_languages=False,
            limit=5,
        )
