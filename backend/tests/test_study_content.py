import json
import pytest
from pydantic import ValidationError
from backend.app.study_content import normalize_content, MindMap
from backend.app.providers import Completion
from backend.app.agents import workflows


def test_summary_normalizes_known_field_names_without_losing_contract():
    assert normalize_content(
        "summary",
        {
            "overview": "A lesson.",
            "main_points": ["A point."],
            "key_terms": [{"term": "A", "definition": "The first concept."}],
        },
    ) == {
        "overview": "A lesson.",
        "mainPoints": ["A point."],
        "keyTerms": [{"term": "A", "definition": "The first concept."}],
    }
    with pytest.raises(ValidationError):
        normalize_content(
            "summary", {"overview": "A lesson.", "mainPoints": [], "keyTerms": []}
        )
    with pytest.raises(ValidationError):
        normalize_content(
            "summary",
            {
                "overview": "A lesson.",
                "mainPoints": ["A point."],
                "keyTerms": [{"unexpected": "bad"}],
            },
        )


def test_mindmap_compiles_safe_quoted_graph_and_rejects_broken_references():
    value = {
        "nodes": [
            {"id": "n0", "label": 'Weights [w] "quoted" <input>'},
            {"id": "n1", "label": "Output"},
        ],
        "edges": [{"source": "n0", "target": "n1"}],
    }
    graph = normalize_content("mindmap", value)
    assert graph.startswith("graph TD\n") and "n0 --> n1" in graph
    assert "&quot;" in graph and "&lt;input&gt;" in graph
    value["edges"][0]["target"] = "missing"
    with pytest.raises(ValidationError):
        MindMap.model_validate(value)
    value["nodes"][0]["id"] = "x;click"
    with pytest.raises(ValidationError):
        MindMap.model_validate(value)


def test_invalid_summary_gets_one_format_correction_and_source_review(
    client, monkeypatch
):
    class RepairAI:
        prompts = []

        async def complete(self, owner, prompt, **kwargs):
            self.prompts.append((prompt, kwargs))
            if kwargs.get("task") == "verification":
                value = {"accepted": True, "issues": []}
            elif "FORMAT CORRECTION" in prompt:
                value = {
                    "overview": "Plants use sunlight.",
                    "mainPoints": ["Plants absorb carbon dioxide."],
                    "keyTerms": [],
                }
            else:
                value = {"summary": "Wrong response shape"}
            return Completion(json.dumps(value), "controlled-test", "fixture", 10)

    ai = RepairAI()
    monkeypatch.setattr(workflows, "ai", ai)
    r = client.post(
        "/api/v1/ai/generate",
        json={
            "task": "summary",
            "source": "Plants absorb carbon dioxide and use sunlight.",
        },
    )
    assert r.status_code == 200
    assert r.json()["result"]["mainPoints"] == ["Plants absorb carbon dioxide."]
    assert len(ai.prompts) == 3
    assert ai.prompts[0][1]["response_schema"]["additionalProperties"] is False


def test_broken_map_gets_repaired_before_being_saved(client, monkeypatch):
    class RepairMap:
        async def complete(self, owner, prompt, **kwargs):
            if kwargs.get("task") == "verification":
                value = {"accepted": True, "issues": []}
            else:
                value = {
                    "nodes": [
                        {"id": "n0", "label": "Plants"},
                        {"id": "n1", "label": "Light"},
                    ],
                    "edges": [
                        {
                            "source": "n0",
                            "target": "n1"
                            if "FORMAT CORRECTION" in prompt
                            else "missing",
                        }
                    ],
                }
            return Completion(json.dumps(value), "controlled-test", "fixture", 10)

    monkeypatch.setattr(workflows, "ai", RepairMap())
    r = client.post(
        "/api/v1/ai/generate",
        json={
            "task": "mindmap",
            "source": "Plants absorb carbon dioxide and use sunlight.",
        },
    )
    assert r.status_code == 200 and "n0 --> n1" in r.json()["result"]


def test_invalid_study_content_has_bounded_failure_with_safe_diagnostics(
    client, monkeypatch
):
    class Invalid:
        calls = 0

        async def complete(self, *args, **kwargs):
            self.calls += 1
            return Completion(
                '{"private":"source must never appear in diagnostics"}',
                "controlled-test",
                "fixture",
                10,
            )

    ai = Invalid()
    monkeypatch.setattr(workflows, "ai", ai)
    r = client.post(
        "/api/v1/ai/generate",
        json={
            "task": "summary",
            "source": "Plants absorb carbon dioxide and use sunlight.",
        },
    )
    assert r.status_code == 502 and ai.calls == 2
    run = client.get("/api/v1/agents/runs").json()[0]
    assert "source must never appear" not in json.dumps(run)


def test_revision_prompt_includes_previous_candidate_for_targeted_correction(
    client, monkeypatch
):
    class ReviewCorrection:
        reviews = 0

        def __init__(self):
            self.corrected = False

        async def complete(self, owner, prompt, **kwargs):
            if kwargs.get("task") == "verification":
                self.reviews += 1
                value = {
                    "accepted": self.reviews > 1,
                    "issues": ["Remove the unsupported second point"]
                    if self.reviews == 1
                    else [],
                }
            else:
                if "REVISION REQUIRED" in prompt:
                    assert "PREVIOUS CANDIDATE TO CORRECT" in prompt
                    assert "Original point" in prompt
                    self.corrected = True
                value = {
                    "overview": "Plants use light.",
                    "mainPoints": ["Original point"],
                    "keyTerms": [],
                }
            return Completion(json.dumps(value), "controlled-test", "fixture", 10)

    ai = ReviewCorrection()
    monkeypatch.setattr(workflows, "ai", ai)
    response = client.post(
        "/api/v1/ai/generate",
        json={"task": "summary", "source": "Plants use light for photosynthesis."},
    )
    assert response.status_code == 200 and ai.corrected and ai.reviews == 2
