"""Controlled browser-test server ONLY. Never used by normal development/production startup."""

import os
import tempfile
import json
import re
from pathlib import Path

TEST_DIR = tempfile.TemporaryDirectory(prefix="briefly-browser-")
os.environ.update(
    {
        "DATABASE_URL": "sqlite:///" + str(Path(TEST_DIR.name) / "browser.db"),
        "APP_ENV": "development",
        "GROQ_API_KEY": "",
        "GEMINI_API_KEY": "",
        "XAI_API_KEY": "",
        "SUPABASE_URL": "",
        "SUPABASE_ANON_KEY": "",
        "FRONTEND_URL": "http://localhost:3100",
        "REQUEST_LIMIT_PER_MINUTE": "10000",
    }
)
from backend.app.main import app
from backend.app.agents import workflows
from backend.app.providers import Completion
from backend.app.models import engine
from backend.app.schemas import Question


class ControlledAI:
    async def complete(
        self, owner, prompt, structured=True, task="default", response_schema=None
    ):
        if "Independently audit" in prompt:
            value = {"accepted": True, "issues": []}
        elif "Generate exactly" in prompt:
            count = int(re.search(r"Generate exactly (\d+)", prompt).group(1))
            requested = re.search(
                r"Type: (single|multiple|boolean|mixed)", prompt
            ).group(1)
            difficulty = re.search(
                r"Difficulty: (easy|medium|hard|mixed)", prompt
            ).group(1)
            questions = []
            for i in range(count):
                kind = (
                    ("single", "multiple", "boolean")[i % 3]
                    if requested == "mixed"
                    else requested
                )
                options = (
                    ["True", "False"]
                    if kind == "boolean"
                    else ["Carbon dioxide", "Light", "Helium"]
                    if kind == "multiple"
                    else ["Carbon dioxide", "Helium"]
                )
                q = Question(
                    id=f"q{i}",
                    question=f"Question {i + 1}: Plants absorb carbon dioxide."
                    if kind == "boolean"
                    else f"Question {i + 1}: What do plants use?",
                    type=kind,
                    options=options,
                    correct=[0, 1] if kind == "multiple" else [0],
                    explanation="Plants absorb carbon dioxide and use light.",
                    difficulty="easy" if difficulty == "mixed" else difficulty,
                    topic="Photosynthesis",
                    source_quote="Plants absorb carbon dioxide.",
                ).model_dump()
                if response_schema:
                    q.pop("source_quote")
                    q.pop("id")
                    q["source_section"] = response_schema["properties"]["questions"][
                        "items"
                    ]["properties"]["source_section"]["enum"][0]
                questions.append(q)
            value = {"questions": questions}
        elif "Produce summary" in prompt:
            value = {
                "overview": "Plants use sunlight for photosynthesis.",
                "mainPoints": ["Plants absorb carbon dioxide."],
                "keyTerms": [
                    {
                        "term": "Photosynthesis",
                        "definition": "Plants convert sunlight to chemical energy.",
                    }
                ],
            }
        elif "Produce flashcards" in prompt:
            value = {
                "items": [
                    {
                        "front": "What do plants absorb?",
                        "back": "Carbon dioxide",
                        "difficulty": "Easy",
                        "topic": "Photosynthesis",
                    }
                ]
            }
        elif "study planner" in prompt:
            value = {
                "text": "# Seven-day revision plan\nDay 1: Review photosynthesis.\nDay 2: Practice active recall."
            }
        elif "Produce mindmap" in prompt:
            value = {"text": 'graph TD\nA["Photosynthesis"] --> B["Carbon dioxide"]'}
        elif "Produce notes" in prompt:
            value = {"text": "# Photosynthesis\nPlants absorb carbon dioxide."}
        elif "learner" in prompt:
            value = {"text": "Plants absorb carbon dioxide. [Source section 1]"}
        else:
            value = {"items": [{"timestamp": 0, "topic": "Photosynthesis"}]}
        return Completion(json.dumps(value), "controlled-test", "fixture", 25)


workflows.ai = ControlledAI()
if __name__ == "__main__":
    import uvicorn

    try:
        uvicorn.run(
            app, host="127.0.0.1", port=8100, log_level="warning", access_log=False
        )
    finally:
        engine.dispose()
        TEST_DIR.cleanup()
