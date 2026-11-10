"""Project identity and AI access scope are deliberately separate contracts."""
from datetime import date
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator

ResourceKind = Literal["document", "source", "memory", "writing_session"]
ContextMode = Literal["current_project", "selected_resources", "all_projects", "profile_only", "none"]

class ContextResource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: ResourceKind
    id: UUID

class ProjectContextFields(BaseModel):
    project_id: UUID | None = None
    context_scope: ContextMode = "current_project"
    selected_resources: list[ContextResource] = Field(default_factory=list, max_length=200)

class OwnedChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_user_id: UUID
    revision: int = Field(ge=0)
    mutation_id: UUID

class ProjectGoals(BaseModel):
    model_config = ConfigDict(extra="forbid")
    daily_words: int | None = Field(default=None, ge=1, le=1_000_000_000)
    weekly_words: int | None = Field(default=None, ge=1, le=1_000_000_000)
    total_words: int | None = Field(default=None, ge=1, le=1_000_000_000)

class ProjectPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audience: str = Field(default="", max_length=2000)
    tone: str = Field(default="", max_length=2000)
    objectives: str = Field(default="", max_length=2000)
    research_focus: str = Field(default="", max_length=2000)
    challenges: str = Field(default="", max_length=2000)

class ProjectSave(OwnedChange):
    name: str = Field(min_length=1, max_length=150)
    description: str = Field(default="", max_length=4000)
    project_type: str = Field(default="other", min_length=1, max_length=100)
    status: Literal["planning", "in_progress", "paused", "completed", "archived"] = "planning"
    goals: ProjectGoals = Field(default_factory=ProjectGoals)
    preferences: ProjectPreferences = Field(default_factory=ProjectPreferences)
    target_date: date | None = None

    @field_validator("name", "project_type")
    @classmethod
    def nonempty(cls, value):
        if not value.strip(): raise ValueError("A name is required")
        return value.strip()

class ResourceAssignment(OwnedChange):
    project_ids: list[UUID] = Field(default_factory=list)

    @field_validator("project_ids")
    @classmethod
    def unique(cls, value): return sorted(set(value), key=str)

class ProjectSelection(OwnedChange):
    project_id: UUID | None = None
    last_documents: dict[str, UUID | None] = Field(default_factory=dict)

    @field_validator("last_documents")
    @classmethod
    def valid_keys(cls, value):
        for key in value:
            if key != "general": UUID(key)
        return value

class ProjectDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_user_id: UUID
    revision: int = Field(ge=1)
    confirm_name: str = Field(min_length=1, max_length=150)

class ProfileAnswerSave(OwnedChange):
    selected_option_ids: list[str] = Field(default_factory=list, max_length=20)
    custom_answer: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=2000)
