"""Session-only goals. Never alter daily goals or authoritative activity counters."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

class GuidedSession(BaseModel):
    model_config = ConfigDict(extra='forbid')
    goal: int = Field(ge=1, le=10000, strict=True)
    written_words: int = Field(default=0, ge=0, le=1000000, strict=True)
    intention: Literal['continue', 'expand', 'new', 'perspective', 'surprise'] = 'surprise'
    original_direction: str = Field(default='', max_length=1100)
    session_text: str = Field(default='', max_length=4000)
