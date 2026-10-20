"""Pydantic models mirroring packages/shared/src/schemas.ts.

The TS side re-validates every imported pack, so these models are the first of two
independent gates. Keep field names/aliases in sync when changing either side.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

Level = Literal["A2", "B1", "B2", "C1"]
Accent = Literal["us", "uk", "mixed"]
PassageType = Literal["monologue", "dialogue"]
QuestionType = Literal["mcq", "gapfill", "subjective"]
Skill = Literal["gist", "detail", "inference", "attitude", "vocabulary", "function", "organization"]
ChoiceKey = Literal["a", "b", "c", "d"]
MimeType = Literal["audio/mpeg", "audio/wav", "audio/ogg"]
ReviewStatus = Literal["pending", "approved", "rejected"]


class StrictModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid", str_strip_whitespace=True)


class Choice(StrictModel):
    key: ChoiceKey
    text: str = Field(min_length=1, max_length=240)


class McqAnswer(StrictModel):
    key: ChoiceKey


class GapfillAnswer(StrictModel):
    accepted: list[str] = Field(min_length=1, max_length=8)


class SubjectiveAnswer(StrictModel):
    expected: str = Field(min_length=10, max_length=1200)
    rubric: list[str] = Field(min_length=1, max_length=8)


class LlmQuestionBase(StrictModel):
    prompt: str = Field(min_length=5, max_length=600)
    explanation: str = Field(min_length=3, max_length=800)
    skill: Skill


class LlmMcq(LlmQuestionBase):
    type: Literal["mcq"]
    choices: list[Choice] = Field(min_length=4, max_length=4)
    answer: McqAnswer

    @model_validator(mode="after")
    def _check_choices(self) -> LlmMcq:
        keys = {choice.key for choice in self.choices}
        texts = {choice.text.strip().lower() for choice in self.choices}
        if len(keys) != 4:
            raise ValueError("MCQ choices must use unique keys a-d")
        if len(texts) != 4:
            raise ValueError("MCQ choices must be distinct")
        if self.answer.key not in keys:
            raise ValueError("MCQ answer key is not one of the choices")
        return self


class LlmGapfill(LlmQuestionBase):
    type: Literal["gapfill"]
    answer: GapfillAnswer

    @model_validator(mode="after")
    def _check_blank(self) -> LlmGapfill:
        if "___" not in self.prompt:
            raise ValueError("Gap-fill prompt must contain a blank (___)")
        return self


class LlmSubjective(LlmQuestionBase):
    type: Literal["subjective"]
    answer: SubjectiveAnswer


LlmQuestion = Annotated[
    Union[LlmMcq, LlmGapfill, LlmSubjective],
    Field(discriminator="type"),
]


class RawPassage(StrictModel):
    """Exactly what the writer model returns for one passage."""

    title: str = Field(min_length=3, max_length=80)
    topic: str = Field(min_length=3, max_length=160)
    transcript: str = Field(min_length=80, max_length=12000)
    gender: Literal["male", "female"] | None = None
    questions: list[LlmQuestion] = Field(min_length=1, max_length=12)


class TopicCard(StrictModel):
    id: str = Field(min_length=4, max_length=64)
    kind: PassageType
    domain: str = Field(min_length=2, max_length=80)
    relationship: str = Field(min_length=2, max_length=120)
    setting: str = Field(min_length=2, max_length=160)
    goal_a: str = Field(alias="goalA", min_length=2, max_length=240)
    goal_b: str = Field(alias="goalB", min_length=2, max_length=240)
    obstacle: str = Field(min_length=2, max_length=240)
    stakes: str = Field(min_length=2, max_length=240)
    register_: str = Field(alias="register", min_length=2, max_length=80)
    level: Level
    details: list[str] = Field(min_length=1, max_length=8)


class AudioRef(StrictModel):
    key: str = Field(
        min_length=5,
        max_length=200,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9/_.-]*\.(mp3|wav|ogg)$",
    )
    mime: MimeType
    duration_sec: float = Field(alias="durationSec", gt=0, le=1800)


class PackQuestionBase(StrictModel):
    id: str = Field(min_length=3, max_length=64)
    position: int = Field(ge=1, le=20)
    prompt: str = Field(min_length=5, max_length=600)
    explanation: str = Field(min_length=3, max_length=800)
    skill: Skill
    points: float = Field(default=1, gt=0, le=5)


class PackMcq(PackQuestionBase):
    type: Literal["mcq"]
    choices: list[Choice] = Field(min_length=4, max_length=4)
    answer: McqAnswer

    @model_validator(mode="after")
    def _check_choices(self) -> PackMcq:
        keys = {choice.key for choice in self.choices}
        texts = {choice.text.strip().lower() for choice in self.choices}
        if len(keys) != 4:
            raise ValueError("MCQ choices must use unique keys a-d")
        if len(texts) != 4:
            raise ValueError("MCQ choices must be distinct")
        if self.answer.key not in keys:
            raise ValueError("MCQ answer key is not one of the choices")
        return self


class PackGapfill(PackQuestionBase):
    type: Literal["gapfill"]
    answer: GapfillAnswer

    @model_validator(mode="after")
    def _check_blank(self) -> PackGapfill:
        if "___" not in self.prompt:
            raise ValueError("Gap-fill prompt must contain a blank (___)")
        return self


class PackSubjective(PackQuestionBase):
    type: Literal["subjective"]
    answer: SubjectiveAnswer


PackQuestion = Annotated[
    Union[PackMcq, PackGapfill, PackSubjective],
    Field(discriminator="type"),
]


class PassagePack(StrictModel):
    id: str = Field(min_length=3, max_length=64)
    position: int = Field(ge=1, le=8)
    type: PassageType
    topic: str = Field(min_length=3, max_length=300)
    transcript: str = Field(min_length=80, max_length=12000)
    audio: AudioRef
    topic_card: TopicCard | None = Field(default=None, alias="topicCard")
    questions: list[PackQuestion] = Field(min_length=1, max_length=12)


class PackReview(StrictModel):
    status: ReviewStatus
    score: float | None = Field(default=None, ge=0, le=100)
    judge: str | None = Field(default=None, max_length=160)
    reviewed_at: str | None = Field(default=None, alias="reviewedAt")
    notes: str | None = Field(default=None, max_length=4000)


class ReviewIssue(StrictModel):
    location: str = Field(min_length=1, max_length=160)
    severity: Literal["blocker", "major", "minor"]
    message: str = Field(min_length=1, max_length=500)


class ReviewVerdict(StrictModel):
    status: Literal["approved", "rejected"]
    score: float = Field(ge=0, le=100)
    summary: str = Field(min_length=1, max_length=1000)
    issues: list[ReviewIssue] = Field(default_factory=list, max_length=20)


class TestPack(StrictModel):
    schema_version: Literal[1] = Field(default=1, alias="schemaVersion")
    id: str = Field(min_length=5, max_length=80)
    title: str = Field(min_length=3, max_length=160)
    level: Level
    accent: Accent
    duration_sec: int = Field(alias="durationSec", ge=120, le=3600)
    created_at: str = Field(alias="createdAt")
    season: str | None = Field(default=None, pattern=r"^(evergreen|\d{4}-Q[1-4])$")
    review: PackReview | None = None
    passages: list[PassagePack] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def _check_pack(self) -> TestPack:
        if len({p.id for p in self.passages}) != len(self.passages):
            raise ValueError("passage ids must be unique")
        if len({p.position for p in self.passages}) != len(self.passages):
            raise ValueError("passage positions must be unique")
        positions = sorted(p.position for p in self.passages)
        if positions != list(range(1, len(positions) + 1)):
            raise ValueError("passage positions must be contiguous from 1")
        ids = [q.id for p in self.passages for q in p.questions]
        if len(set(ids)) != len(ids):
            raise ValueError("question ids must be unique across the pack")
        return self

    def to_json(self) -> dict:
        return self.model_dump(by_alias=True, exclude_none=True)


class LlmGradingResult(StrictModel):
    score: float = Field(ge=0, le=1)
    feedback: str = Field(min_length=1, max_length=500)
