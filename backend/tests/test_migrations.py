import os
import subprocess
import sys
from pathlib import Path
import tempfile
from sqlalchemy import create_engine, inspect

ROOT = Path(__file__).resolve().parents[2]


def test_initial_migration_sqlite_roundtrip():
    with tempfile.TemporaryDirectory(prefix="briefly-migration-") as folder:
        database = Path(folder) / "migration.db"
        env = dict(os.environ, DATABASE_URL="sqlite:///" + str(database))
        run = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        assert run.returncode == 0, run.stderr
        engine = create_engine(env["DATABASE_URL"])
        tables = inspect(engine).get_table_names()
        assert {
            "quizzes",
            "quiz_versions",
            "quiz_attempts",
            "quiz_room_answers",
            "study_materials",
            "study_plans",
        } <= set(tables)
        engine.dispose()
        # Only the disposable, explicitly isolated database is downgraded.
        down = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "base"],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        assert down.returncode == 0, down.stderr


def test_postgres_migration_compiles_with_private_access():
    env = dict(
        os.environ, DATABASE_URL="postgresql+psycopg://unused:unused@localhost/unused"
    )
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head", "--sql"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.count("ENABLE ROW LEVEL SECURITY") == 11
    assert 'REVOKE ALL ON TABLE "quiz_versions" FROM PUBLIC' in result.stdout
    assert "CREATE TABLE quiz_room_answers" in result.stdout
