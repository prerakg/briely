import re
from datetime import datetime, timezone
from typing import Literal
from pydantic import (
    BaseModel,
    Field,
    ConfigDict,
    StrictInt,
    model_validator,
    field_validator,
)
from .models import uid


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Question(StrictModel):
    id: str = Field(default_factory=uid, min_length=1, max_length=64)
    question: str = Field(min_length=5, max_length=2000)
    type: Literal["single", "multiple", "boolean"] = "single"
    options: list[str] = Field(min_length=2, max_length=6)
    correct: list[StrictInt] = Field(min_length=1, max_length=6)
    explanation: str = Field(min_length=1, max_length=3000)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    topic: str = Field(default="General", max_length=100)
    source_quote: str = Field(default="", max_length=1500)

    @model_validator(mode="after")
    def valid_answers(self):
        self.options = [o.strip() for o in self.options]
        if any(not o or len(o) > 1000 for o in self.options) or len(
            {o.casefold() for o in self.options}
        ) != len(self.options):
            raise ValueError("Options must be nonempty and unique")
        if len(set(self.correct)) != len(self.correct) or any(
            type(i) is not int or i < 0 or i >= len(self.options) for i in self.correct
        ):
            raise ValueError("Answer indices are invalid")
        if self.type != "multiple" and len(self.correct) != 1:
            raise ValueError(
                "Single-answer questions require exactly one correct option"
            )
        if self.type == "multiple" and len(self.correct) == len(self.options):
            raise ValueError("Multiple-answer questions need a distractor")
        if self.type == "boolean" and {o.casefold() for o in self.options} != {
            "true",
            "false",
        }:
            raise ValueError("True/false questions require True and False options")
        return self


class QuizSettings(StrictModel):
    time_limit_seconds: int = Field(default=600, ge=30, le=14400)
    max_attempts: int = Field(default=3, ge=1, le=20)
    show_explanations: bool = True
    shuffle_questions: bool = True
    shuffle_options: bool = True
    expires_at: datetime | None = None
    access: Literal["public", "private"] = "public"
    leaderboard: bool = False

    @field_validator("expires_at")
    @classmethod
    def utc_expiry(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("Expiration must include a timezone")
        return v


class QuizDraft(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    questions: list[Question] = Field(min_length=1, max_length=50)
    settings: QuizSettings = Field(default_factory=QuizSettings)

    @model_validator(mode="after")
    def unique_questions(self):
        if len({q.id for q in self.questions}) != len(self.questions):
            raise ValueError("Question IDs must be unique")
        if len(
            {re.sub(r"\W+", "", q.question.casefold()) for q in self.questions}
        ) != len(self.questions):
            raise ValueError("Duplicate questions are not allowed")
        return self


class GenerateRequest(StrictModel):
    source: str = Field(min_length=30, max_length=250000)
    title: str = Field(default="Knowledge check", min_length=1, max_length=160)
    count: int = Field(default=10, ge=1, le=30)
    difficulty: Literal["easy", "medium", "hard", "mixed"] = "mixed"
    question_type: Literal["single", "multiple", "boolean", "mixed"] = "single"
    exclude: list[str] = Field(default_factory=list, max_length=50)


class StartAttempt(StrictModel):
    name: str = Field(min_length=1, max_length=60)
    invite: str = Field(default="", max_length=100)


class Submission(StrictModel):
    answers: dict[str, list[StrictInt]] = Field(default_factory=dict, max_length=50)


class RoomCreate(StrictModel):
    share_id: str = Field(min_length=10, max_length=64)
    round_seconds: int = Field(default=30, ge=10, le=180)


class RoundAnswer(StrictModel):
    round: int = Field(ge=0, le=49)
    answer: list[StrictInt] = Field(max_length=6)


class Ready(StrictModel):
    ready: bool


class AIRequest(StrictModel):
    task: Literal[
        "summary",
        "flashcards",
        "quiz",
        "notes",
        "mindmap",
        "topics",
        "tutor",
        "planner",
    ]
    source: str = Field(min_length=1, max_length=250000)
    context: str = Field(default="", max_length=12000)


class Login(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class MaterialInput(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    source: str = Field(min_length=1, max_length=250000)
