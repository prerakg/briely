import time
import uuid
from sqlalchemy import (
    String,
    Float,
    Integer,
    Boolean,
    ForeignKey,
    JSON,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from .config import get_settings


def uid():
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class Identity(Base):
    __tablename__ = "browser_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created: Mapped[float] = mapped_column(Float, default=time.time)


class Quiz(Base):
    __tablename__ = "quizzes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String(128), index=True)
    title: Mapped[str] = mapped_column(String(160))
    draft: Mapped[dict] = mapped_column(JSON)
    created: Mapped[float] = mapped_column(Float, default=time.time)


class Version(Base):
    __tablename__ = "quiz_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    quiz_id: Mapped[str] = mapped_column(ForeignKey("quizzes.id"), index=True)
    share_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    invite_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created: Mapped[float] = mapped_column(Float, default=time.time)


class Attempt(Base):
    __tablename__ = "quiz_attempts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    version_id: Mapped[str] = mapped_column(ForeignKey("quiz_versions.id"), index=True)
    guest: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(60))
    started: Mapped[float] = mapped_column(Float, default=time.time)
    deadline: Mapped[float] = mapped_column(Float)
    submitted: Mapped[float | None] = mapped_column(Float, nullable=True)
    answers: Mapped[dict] = mapped_column(JSON, default=dict)
    question_order: Mapped[list] = mapped_column(JSON)
    option_orders: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class StudyMaterial(Base):
    __tablename__ = "study_materials"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String(128), index=True)
    title: Mapped[str] = mapped_column(String(160))
    source: Mapped[str] = mapped_column(String)
    created: Mapped[float] = mapped_column(Float, default=time.time)


class MaterialChunk(Base):
    __tablename__ = "study_material_chunks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    material_id: Mapped[str] = mapped_column(
        ForeignKey("study_materials.id"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(String)


class StudyPlan(Base):
    __tablename__ = "study_plans"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String(128), index=True)
    content: Mapped[str] = mapped_column(String)
    created: Mapped[float] = mapped_column(Float, default=time.time)


class AgentRun(Base):
    __tablename__ = "agent_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String(128), index=True)
    workflow: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="running")
    steps: Mapped[list] = mapped_column(JSON, default=list)
    created: Mapped[float] = mapped_column(Float, default=time.time)
    elapsed: Mapped[float] = mapped_column(Float, default=0)
    error: Mapped[str | None] = mapped_column(String(200), nullable=True)


class Room(Base):
    __tablename__ = "quiz_rooms"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    version_id: Mapped[str] = mapped_column(ForeignKey("quiz_versions.id"))
    owner: Mapped[str] = mapped_column(String(128))
    state: Mapped[str] = mapped_column(String(20), default="lobby")
    round: Mapped[int] = mapped_column(Integer, default=0)
    round_seconds: Mapped[int] = mapped_column(Integer, default=30)
    deadline: Mapped[float | None] = mapped_column(Float, nullable=True)
    expires: Mapped[float] = mapped_column(Float, default=lambda: time.time() + 14400)


class Participant(Base):
    __tablename__ = "quiz_room_participants"
    __table_args__ = (UniqueConstraint("room_id", "guest"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("quiz_rooms.id"), index=True)
    guest: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(60))
    ready: Mapped[bool] = mapped_column(Boolean, default=False)
    seen: Mapped[float] = mapped_column(Float, default=time.time)


class RoomAnswer(Base):
    __tablename__ = "quiz_room_answers"
    __table_args__ = (UniqueConstraint("participant_id", "round"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    participant_id: Mapped[str] = mapped_column(
        ForeignKey("quiz_room_participants.id"), index=True
    )
    round: Mapped[int] = mapped_column(Integer)
    correct: Mapped[bool] = mapped_column(Boolean)
    points: Mapped[int] = mapped_column(Integer)


settings = get_settings()
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {},
    pool_pre_ping=True,
)
if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def sqlite_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")


Session = sessionmaker(engine, expire_on_commit=False)
