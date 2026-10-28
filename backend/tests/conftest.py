import os
import tempfile
from pathlib import Path

# Isolate every test process from real keys, user data and remote infrastructure.
_test_dir = tempfile.TemporaryDirectory(prefix="briefly-tests-")
os.environ.update(
    {
        "DATABASE_URL": "sqlite:///" + str(Path(_test_dir.name) / "test.db"),
        "APP_ENV": "development",
        "SUPABASE_URL": "",
        "SUPABASE_ANON_KEY": "",
        "GROQ_API_KEY": "",
        "GEMINI_API_KEY": "",
        "XAI_API_KEY": "",
        "FRONTEND_URL": "http://localhost:3000",
        "REQUEST_LIMIT_PER_MINUTE": "10000",
    }
)
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.models import Base, engine
from backend.app.security import limiter


@pytest.fixture(autouse=True)
def isolated_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    limiter.buckets.clear()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        assert c.post("/api/v1/auth/session").status_code == 200
        yield c


@pytest.fixture
def draft():
    return {
        "title": "Biology review",
        "questions": [
            {
                "id": "q1",
                "question": "What do plants absorb?",
                "type": "single",
                "options": ["Carbon dioxide", "Helium"],
                "correct": [0],
                "explanation": "Plants absorb carbon dioxide for photosynthesis.",
                "difficulty": "easy",
                "topic": "Photosynthesis",
                "source_quote": "Plants absorb carbon dioxide.",
            }
        ],
        "settings": {
            "time_limit_seconds": 60,
            "max_attempts": 2,
            "show_explanations": True,
            "shuffle_questions": False,
            "shuffle_options": False,
            "expires_at": None,
            "access": "public",
            "leaderboard": False,
        },
    }


@pytest.fixture
def published(client, draft):
    q = client.post("/api/v1/quizzes", json=draft)
    assert q.status_code == 200, q.text
    r = client.post("/api/v1/quizzes/" + q.json()["id"] + "/publish")
    assert r.status_code == 200, r.text
    return q.json(), r.json()


@pytest.fixture(scope="session", autouse=True)
def close_test_database():
    yield
    engine.dispose()
    _test_dir.cleanup()
