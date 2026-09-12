"""Select WildChat row indices with Parquet predicate pushdown.

Only non-content metadata columns are read. Conversation text is fetched later,
for selected rows only, through Hugging Face's official Dataset Viewer API.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path

try:
    import duckdb
except ImportError as error:  # pragma: no cover - exercised by setup failures
    raise SystemExit(
        "duckdb is required: python -m pip install duckdb==1.4.1"
    ) from error


SHARDS = 86
BASE = (
    "https://huggingface.co/datasets/allenai/WildChat-4.8M/resolve/"
    "{revision}/data/train-{index:05d}-of-00086.parquet"
)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--seed", default="worket-wildchat-2026-09-12")
    parser.add_argument("--per-language", type=int, default=240)
    return parser.parse_args()


def main() -> None:
    args = arguments()
    urls = [BASE.format(revision=args.revision, index=index) for index in range(SHARDS)]
    connection = duckdb.connect(":memory:")
    connection.execute("SET enable_progress_bar=false")
    relation = "read_parquet(?, filename=true, file_row_number=true)"

    counts = connection.execute(
        f"SELECT filename, count(*)::BIGINT FROM {relation} GROUP BY filename",
        [urls],
    ).fetchall()
    count_by_file = {filename: count for filename, count in counts}
    ordered_files = sorted(count_by_file)
    offsets: dict[str, int] = {}
    cursor = 0
    for filename in ordered_files:
        offsets[filename] = cursor
        cursor += count_by_file[filename]

    rows = connection.execute(
        f"""
        SELECT filename, file_row_number, conversation_hash, model, turn, language
        FROM {relation}
        WHERE lower(model) LIKE 'gpt-4o%'
          AND turn BETWEEN 9 AND 20
          AND NOT toxic
          AND NOT redacted
          AND lower(language) IN ('english', 'chinese')
        """,
        [urls],
    ).fetchall()

    by_language: dict[str, list[dict[str, object]]] = {"en": [], "zh": []}
    for filename, file_row, conversation_hash, model, turns, language in rows:
        code = "zh" if str(language).lower() == "chinese" else "en"
        by_language[code].append(
            {
                "sourceRow": offsets[filename] + file_row,
                "conversationHash": conversation_hash,
                "model": model,
                "turnCount": turns,
                "language": code,
                "shard": os.path.basename(filename),
                "shardRow": file_row,
            }
        )

    randomizer = random.Random(args.seed)
    selected: list[dict[str, object]] = []
    for language in ("zh", "en"):
        randomizer.shuffle(by_language[language])
        selected.extend(by_language[language][: args.per_language])
    randomizer.shuffle(selected)

    output = {
        "schemaVersion": 1,
        "datasetRevision": args.revision,
        "datasetRows": cursor,
        "eligibleMetadataRows": {key: len(value) for key, value in by_language.items()},
        "selectedMetadataRows": {
            key: sum(1 for row in selected if row["language"] == key)
            for key in by_language
        },
        "rows": selected,
    }
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(target)
    print(
        json.dumps(
            {
                "type": "parquet-index-complete",
                "datasetRows": cursor,
                "eligible": output["eligibleMetadataRows"],
                "selected": len(selected),
            }
        )
    )


if __name__ == "__main__":
    main()
