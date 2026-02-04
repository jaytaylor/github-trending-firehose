from __future__ import annotations

from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from .utils import ValidationError, ensure_dir, parse_date


def _rollup_table_name(kind: str) -> str:
    if kind == "repository":
        return "repo_day_presence"
    if kind == "developer":
        return "dev_day_presence"
    raise ValidationError(f"Unsupported kind: {kind}")


def _parquet_glob(analytics_root: Path, kind: str) -> str:
    table = "repo_trend_entry" if kind == "repository" else "dev_trend_entry"
    return str(analytics_root / "parquet" / kind / "year=*" / f"{table}.parquet")


def _compute_rollup(con: duckdb.DuckDBPyConnection, kind: str, parquet_glob: str) -> pa.Table:
    if kind == "repository":
        sql = (
            "SELECT date, full_name, owner, "
            "MIN(rank) AS best_rank_any, "
            "MIN(CASE WHEN language IS NOT NULL THEN rank ELSE NULL END) AS best_rank_non_null, "
            "COUNT(DISTINCT CASE WHEN language IS NOT NULL THEN language END) AS non_null_languages, "
            "MAX(CASE WHEN language IS NULL THEN 1 ELSE 0 END) AS has_all_languages "
            "FROM read_parquet(?) "
            "GROUP BY date, full_name, owner"
        )
    else:
        sql = (
            "SELECT date, username, "
            "MIN(rank) AS best_rank_any, "
            "MIN(CASE WHEN language IS NOT NULL THEN rank ELSE NULL END) AS best_rank_non_null, "
            "COUNT(DISTINCT CASE WHEN language IS NOT NULL THEN language END) AS non_null_languages, "
            "MAX(CASE WHEN language IS NULL THEN 1 ELSE 0 END) AS has_all_languages "
            "FROM read_parquet(?) "
            "GROUP BY date, username"
        )
    try:
        return con.execute(sql, [parquet_glob]).fetch_arrow_table()
    except Exception as exc:  # pragma: no cover - surfaces in tests
        raise ValidationError(f"Rollup query failed: {exc}") from exc


def rollup_kind(*, analytics_root: Path, kind: str, from_date: str | None) -> None:
    analytics_root = analytics_root.resolve()
    parquet_glob = _parquet_glob(analytics_root, kind)
    rollup_table = _rollup_table_name(kind)

    threshold_year = None
    if from_date:
        parsed = parse_date(from_date)
        threshold_year = parsed.year

    con = duckdb.connect()
    table = _compute_rollup(con, kind, parquet_glob)
    if table.num_rows == 0:
        raise ValidationError("No rows available to roll up")

    year_values = pc.year(table["date"]).to_pylist()
    unique_years = sorted({int(value) for value in year_values})

    for year in unique_years:
        if threshold_year is not None and year < threshold_year:
            continue
        mask = pc.equal(pc.year(table["date"]), year)
        year_table = table.filter(mask)
        output_path = analytics_root / "rollups" / kind / f"year={year}" / f"{rollup_table}.parquet"
        ensure_dir(output_path.parent)
        pq.write_table(year_table, output_path)
