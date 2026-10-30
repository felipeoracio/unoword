"""Shared validation for exact active spans on the existing activity ledger."""
from typing import Literal
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict, model_validator

class SessionTimer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["active", "paused", "ended"]
    active_ms: int = Field(ge=0, le=315360000000)
    paused_ms: int = Field(ge=0, le=315360000000)
    changed_at: int = Field(ge=0, le=9999999999999)


class ActivityTime(BaseModel):
    model_config = ConfigDict(extra="forbid")
    timer: SessionTimer | None = None
    device_id: str | None = Field(default=None, min_length=1, max_length=100)
    active_intervals: list[tuple[int, int]] | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def valid_intervals(self):
        if self.active_intervals is None:
            return self
        previous = 0
        total = 0
        start = int(self.started_at.timestamp() * 1000)
        ceiling = int(datetime.now(timezone.utc).timestamp() * 1000) + 300000
        for a, b in self.active_intervals:
            if a < start or a < previous or b <= a or b > ceiling:
                raise ValueError("invalid_active_intervals")
            previous = b
            total += b - a
        if total > 86400000 or abs(total / 1000 - self.duration_seconds) >= 2:
            raise ValueError("inconsistent_active_duration")
        return self
