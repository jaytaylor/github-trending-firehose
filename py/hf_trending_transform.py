#!/usr/bin/env python3
import argparse
import csv
import io
import re
import sys
from datetime import datetime
from typing import Iterable, List, Optional, Tuple
from urllib.request import urlopen

DEFAULT_HF_TRENDING_URLS = [
    "https://huggingface.co/datasets/severo/trending-repos/resolve/main/models.csv",
    "https://huggingface.co/datasets/severo/trending-repos/resolve/main/datasets.csv",
    "https://huggingface.co/datasets/severo/trending-repos/resolve/main/spaces.csv",
]


def read_source(source: str) -> str:
    if source.startswith("http://") or source.startswith("https://"):
        with urlopen(source) as response:
            return response.read().decode("utf-8")
    with open(source, "r", encoding="utf-8") as handle:
        return handle.read()


def normalize_date(value: str) -> Optional[str]:
    if not value:
        return None
    match = re.match(r"^\d{4}-\d{2}-\d{2}", value)
    if match:
        return match.group(0)
    try:
        # Support ISO-8601 timestamps with Z suffix.
        value = value.replace("Z", "+00:00")
        return datetime.fromisoformat(value).date().isoformat()
    except ValueError:
        return None


def split_repo_id(repo_id: str) -> Tuple[str, str]:
    if "/" in repo_id:
        owner, name = repo_id.split("/", 1)
        return owner.strip(), name.strip()
    return "", repo_id.strip()


def coerce_int(value: str) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def iter_rows(sources: Iterable[str]) -> Iterable[dict]:
    for source in sources:
        content = read_source(source)
        reader = csv.DictReader(io.StringIO(content))
        for row in reader:
            if not row:
                continue
            yield row


def transform_rows(rows: Iterable[dict]) -> List[dict]:
    output: List[dict] = []
    for row in rows:
        date_value = row.get("date") or row.get("day") or ""
        date = normalize_date(date_value.strip())
        rank = coerce_int((row.get("rank") or row.get("position") or "").strip())

        raw_id = (
            row.get("id")
            or row.get("name")
            or row.get("repo")
            or row.get("repository")
            or ""
        ).strip()
        owner_hint = (
            row.get("repo_owner")
            or row.get("author")
            or row.get("owner")
            or ""
        ).strip()

        owner_from_id, name_from_id = split_repo_id(raw_id)
        repo_owner = owner_hint or owner_from_id
        name = name_from_id or raw_id

        if not (date and rank is not None and repo_owner and name):
            continue

        output.append(
            {
                "name": name,
                "repo_owner": repo_owner,
                "rank": rank,
                "date": date,
            }
        )
    return output


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Transform Hugging Face trending CSVs into import-ready format."
    )
    parser.add_argument(
        "-i",
        "--input",
        action="append",
        default=[],
        help="CSV path or URL (repeatable)",
    )
    parser.add_argument(
        "--hf-trending",
        action="store_true",
        help="Use Hugging Face trending CSVs (models, datasets, spaces).",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="-",
        help="Output CSV path (default: stdout)",
    )
    parser.add_argument(
        "--no-dedupe",
        action="store_true",
        help="Disable de-duplication of identical rows.",
    )

    args = parser.parse_args()

    sources = list(args.input)
    if args.hf_trending:
        sources.extend(DEFAULT_HF_TRENDING_URLS)

    if not sources:
        parser.error("Provide --input or --hf-trending")

    rows = transform_rows(iter_rows(sources))
    rows.sort(key=lambda r: (r["date"], r["rank"], r["repo_owner"], r["name"]))

    if not args.no_dedupe:
        seen = set()
        deduped = []
        for row in rows:
            key = (row["date"], row["rank"], row["repo_owner"], row["name"])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(row)
        rows = deduped

    output_handle = sys.stdout
    if args.output != "-":
        output_handle = open(args.output, "w", encoding="utf-8", newline="")

    try:
        writer = csv.DictWriter(
            output_handle, fieldnames=["name", "repo_owner", "rank", "date"]
        )
        writer.writeheader()
        writer.writerows(rows)
    finally:
        if output_handle is not sys.stdout:
            output_handle.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
