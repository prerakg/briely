import json
import pytest
from pydantic import ValidationError
from backend.app.generation import generated_quiz, notes_requirements, quiz_schema
from backend.app.schemas import Question
from backend.app.agents import workflows
from backend.app.providers import Completion

SOURCE = "Plants absorb carbon dioxide. Photosynthesis uses light energy."
OPTIONS = {
    "title": "Creator title",
    "count": 1,
    "question_type": "single",
    "difficulty": "mixed",
    "exclude": [],
}


def test_ai_aliases_normalize_without_changing_strict_domain_schema(draft):
    raw = draft["questions"][0]
    raw.pop("correct")
    raw.update(
        {
            "type": "MCQ",
            "difficulty": "Easy",
            "correctAnswer": "Carbon dioxide",
            "extra_model_metadata": "ignored",
        }
    )
    value = generated_quiz(
        {"questions": [raw], "settings": {"question_count": 10}}, OPTIONS, SOURCE
    )
    assert value.title == "Creator title" and value.settings.max_attempts == 3
    assert value.questions[0].correct == [0] and value.questions[0].difficulty == "easy"
    assert value.questions[0].id != raw["id"]
    with pytest.raises(ValidationError):
        Question.model_validate({**draft["questions"][0], "correct": [True]})


def test_answer_indices_and_conflicting_keys_are_not_guessed(draft):
    q = draft["questions"][0]
    with pytest.raises(ValidationError):
        generated_quiz({"questions": [{**q, "correct": [99]}]}, OPTIONS, SOURCE)
    with pytest.raises(ValueError, match="Conflicting"):
        generated_quiz(
            {"questions": [{**q, "correctAnswer": "Helium"}]}, OPTIONS, SOURCE
        )


def test_quote_accepts_html_entities_and_line_wrapping_but_not_invented_words(draft):
    q = {**draft["questions"][0], "source_quote": "Plants absorb carbon dioxide."}
    result = generated_quiz(
        {"questions": [q]},
        OPTIONS,
        "Plants absorb\ncarbon dioxide. It&#39;s photosynthesis.",
    )
    assert result.questions[0].source_quote == "Plants absorb\ncarbon dioxide."
    with pytest.raises(ValueError, match="source_quote"):
        generated_quiz(
            {"questions": [{**q, "source_quote": "Plants absorb helium."}]},
            OPTIONS,
            SOURCE,
        )


def test_malformed_quiz_is_regenerated_once_before_independent_review(
    client, draft, monkeypatch
):
    class RepairAI:
        generations = 0

        async def complete(
            self, owner, prompt, structured=True, task="default", response_schema=None
        ):
            if task == "verification":
                value = {"accepted": True, "issues": []}
            else:
                self.generations += 1
                value = json.loads(json.dumps(draft))
                if self.generations == 1:
                    value["questions"][0]["correct"] = [99]
                else:
                    assert "FORMAT CORRECTION" in prompt
            return Completion(json.dumps(value), "controlled-test", "fixture", 10)

    ai = RepairAI()
    monkeypatch.setattr(workflows, "ai", ai)
    response = client.post(
        "/api/v1/quizzes/generate", json={"source": SOURCE, "count": 1}
    )
    assert response.status_code == 200, response.text
    assert ai.generations == 2
    assert len(client.get("/api/v1/quizzes").json()) == 1


def test_unrepairable_quiz_is_not_saved(client, draft, monkeypatch):
    class InvalidAI:
        calls = 0

        async def complete(
            self, owner, prompt, structured=True, task="default", response_schema=None
        ):
            self.calls += 1
            value = json.loads(json.dumps(draft))
            value["questions"][0]["correct"] = [99]
            return Completion(json.dumps(value), "controlled-test", "fixture", 10)

    ai = InvalidAI()
    monkeypatch.setattr(workflows, "ai", ai)
    response = client.post(
        "/api/v1/quizzes/generate", json={"source": SOURCE, "count": 1}
    )
    assert response.status_code == 502 and ai.calls == 2
    assert client.get("/api/v1/quizzes").json() == []


def test_long_notes_have_dedicated_depth_prompt_and_bounded_expansion(
    client, monkeypatch
):
    rich = "# Photosynthesis\n\n" + "\n\n".join(
        "## Topic "
        + str(i)
        + "\n"
        + ("Plants absorb carbon dioxide and use light energy. " * 30)
        for i in range(3)
    )

    class NotesAI:
        generations = 0

        async def complete(
            self, owner, prompt, structured=True, task="default", response_schema=None
        ):
            if task == "verification":
                value = {"accepted": True, "issues": []}
            else:
                self.generations += 1
                assert "NOT a short summary" in prompt and "Be concise" not in prompt
                value = {"text": "A short summary." if self.generations == 1 else rich}
            return Completion(json.dumps(value), "controlled-test", "fixture", 10)

    ai = NotesAI()
    monkeypatch.setattr(workflows, "ai", ai)
    source = "Plants absorb carbon dioxide and use light energy. " * 250
    response = client.post(
        "/api/v1/agents/run", json={"task": "notes", "source": source, "context": ""}
    )
    assert response.status_code == 200, response.text
    assert ai.generations == 2 and len(response.json()["result"].split()) >= 450
    assert response.json()["steps"][2]["generation_attempts"] == 2


def test_short_source_is_not_padded_to_a_lecture_length():
    assert notes_requirements("One short definition.")[0] == 0


@pytest.mark.parametrize("kind", ["single", "multiple", "boolean"])
def test_generation_schema_constrains_requested_type_and_source_ids(kind):
    schema = quiz_schema({**OPTIONS, "question_type": kind}, ["2", "7"])
    item = schema["properties"]["questions"]["items"]
    assert item["properties"]["type"]["enum"] == [kind]
    assert item["properties"]["source_section"]["enum"] == ["2", "7"]
    assert "source_quote" not in item["properties"]
    assert item["additionalProperties"] is False


def test_source_section_attaches_real_text_and_rejects_unknown_ids(draft):
    raw = {**draft["questions"][0], "source_section": "1"}
    raw.pop("source_quote")
    result = generated_quiz({"questions": [raw]}, OPTIONS, SOURCE, {"1": SOURCE})
    assert result.questions[0].source_quote == SOURCE
    with pytest.raises(ValueError, match="source_section"):
        generated_quiz(
            {"questions": [{**raw, "source_section": "invented"}]},
            OPTIONS,
            SOURCE,
            {"1": SOURCE},
        )


def test_review_repairs_identified_question_and_preserves_other_questions(
    client, draft, monkeypatch
):
    class TargetedRepairAI:
        generations = 0
        reviews = 0
        original = None

        async def complete(
            self, owner, prompt, structured=True, task="default", response_schema=None
        ):
            if task == "verification":
                self.reviews += 1
                candidate = json.loads(prompt.split("CANDIDATE DATA:\n", 1)[1])
                if self.reviews == 1:
                    self.original = candidate["questions"]
                    value = {
                        "accepted": False,
                        "issues": ["Correct the second question"],
                        "question_ids": [self.original[1]["id"]],
                    }
                else:
                    assert candidate["questions"][0] == self.original[0]
                    assert candidate["questions"][2] == self.original[2]
                    assert (
                        candidate["questions"][1]["question"]
                        == "Which gas is absorbed by plants?"
                    )
                    assert candidate["questions"][1]["id"] != self.original[1]["id"]
                    value = {"accepted": True, "issues": [], "question_ids": []}
            else:
                self.generations += 1
                if self.generations == 1:
                    value = {
                        "questions": [
                            {
                                **draft["questions"][0],
                                "question": f"Plant gas question {i}?",
                            }
                            for i in range(3)
                        ]
                    }
                else:
                    assert response_schema["properties"]["questions"]["minItems"] == 1
                    assert "CORRECT THESE IDENTIFIED QUESTIONS ONLY" in prompt
                    assert self.original[1]["id"] in prompt
                    assert "Correct the second question" in prompt
                    value = {
                        "questions": [
                            {
                                **draft["questions"][0],
                                "question": "Which gas is absorbed by plants?",
                            }
                        ]
                    }
            return Completion(json.dumps(value), "controlled-test", "fixture", 10)

    ai = TargetedRepairAI()
    monkeypatch.setattr(workflows, "ai", ai)
    response = client.post(
        "/api/v1/quizzes/generate", json={"source": SOURCE, "count": 3}
    )
    assert response.status_code == 200, response.text
    assert ai.generations == 2 and ai.reviews == 2
    assert len(response.json()["questions"]) == 3
