"""Advisory snapshots of the existing tracker, never subscription authority."""
from datetime import datetime, date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import BaseModel, Field, field_validator, ConfigDict


class WritingProgress(BaseModel):
    model_config = ConfigDict(extra="forbid")
    daily_goal: int | None = Field(default=None, ge=0, le=1000000)
    words_written_today: int = Field(ge=0, le=1000000000)
    timezone: str = Field(min_length=1, max_length=80)
    date: date
    captured_at: datetime

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value):
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError):
            raise ValueError("Invalid timezone") from None
        return value

    @field_validator("captured_at")
    @classmethod
    def aware_time(cls, value):
        if value.tzinfo is None:
            raise ValueError("A timezone-aware timestamp is required")
        return value


class WritingMilestone(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    words: int = Field(ge=1)


class WritingTask(BaseModel):
    daily_goal: int | None = None
    words_written_today: int = 0
    remaining_words: int | None = None
    target_words: int = Field(ge=0)
    goal_reached: bool = False
    timezone: str = "UTC"
    date: str
    outline: list[WritingMilestone] = Field(default_factory=list, max_length=5)
