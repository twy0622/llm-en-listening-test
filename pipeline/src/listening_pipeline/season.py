"""Quarterly publishing season helpers, mirrored in packages/shared/src/season.ts."""

from __future__ import annotations

from datetime import datetime, timezone


def season_for_date(date: datetime | None = None) -> str:
    value = date or datetime.now(timezone.utc)
    quarter = (value.month - 1) // 3 + 1
    return f"{value.year}-Q{quarter}"
