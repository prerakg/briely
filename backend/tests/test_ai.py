import json
import httpx
import pytest
from backend.app.config import Settings
from backend.app.providers import Gateway, AIError, Completion
from backend.app.agents import workflows


@pytest.mark.asyncio
async def test_rate_limit_falls_back_and_owner_cache():
    calls = []

    def handle(req):
        calls.append(str(req.url))
        if "groq" in str(req.url):
            return httpx.Response(429, headers={"Retry-After": "30"})
        return httpx.Response(
            200,
            json={
                "candidates": [{"content": {"parts": [{"text": '{"text":"ok"}'}]}}],
                "usageMetadata": {"totalTokenCount": 12},
            },
        )

    settings = Settings(
        _env_file=None,
        groq_api_key="test",
        gemini_api_key="test",
        ai_rate_limit_wait_seconds=0,
    )
    ai = Gateway(settings, httpx.MockTransport(handle))
    assert (await ai.complete("owner-a", "prompt")).provider == "gemini"
    assert (await ai.complete("owner-a", "prompt")).cached
    await ai.complete("owner-b", "prompt")
    assert len(calls) == 4 and ai.status("owner-a")["usage"]["tokens"] == 12
    assert "api_key" not in json.dumps(ai.status("owner-a"))


@pytest.mark.asyncio
async def test_auth_failure_does_not_retry_or_fallback():
    calls = []

    def handle(req):
        calls.append(req)
        return httpx.Response(401)

    ai = Gateway(
        Settings(_env_file=None, groq_api_key="bad", gemini_api_key="configured"),
        httpx.MockTransport(handle),
    )
    with pytest.raises(AIError, match="authentication"):
        await ai.complete("owner", "prompt")
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_prompt_budget_and_no_provider():
    ai = Gateway(Settings(_env_file=None, ai_max_prompt_chars=10))
    with pytest.raises(AIError) as e:
        await ai.complete("owner", "a" * 11)
    assert e.value.status == 413
    with pytest.raises(AIError, match="Configure"):
        await ai.complete("owner", "short")


@pytest.mark.asyncio
async def test_timeout_does_not_duplicate_request():
    calls = []

    def handle(req):
        calls.append(req)
        raise httpx.ReadTimeout("timeout")

    ai = Gateway(
        Settings(
            _env_file=None,
            groq_api_key="test",
            gemini_api_key="test",
            ai_rate_limit_wait_seconds=0,
        ),
        httpx.MockTransport(handle),
    )
    with pytest.raises(AIError) as e:
        await ai.complete("owner", "prompt")
    assert e.value.status == 504 and len(calls) == 1


def test_actual_graph_generates_and_verifies(client, draft, monkeypatch):
    class FakeAI:
        async def complete(
            self, owner, prompt, structured=True, task="default", response_schema=None
        ):
            value = (
                {"accepted": True, "issues": []}
                if "Independently audit" in prompt
                else draft
            )
            return Completion(json.dumps(value), "controlled-test", "fixture", 20)

    monkeypatch.setattr(workflows, "ai", FakeAI())
    r = client.post(
        "/api/v1/quizzes/generate",
        json={
            "source": "Plants absorb carbon dioxide. Photosynthesis uses light energy.",
            "count": 1,
        },
    )
    assert r.status_code == 200, r.text
    run = client.get("/api/v1/agents/runs/" + r.json()["run_id"]).json()
    assert run["status"] == "complete"
    assert [s["agent"] for s in run["steps"]] == [
        "orchestrator",
        "retrieval",
        "quiz",
        "verification",
    ]
    assert run["steps"][-1]["provider"] == "controlled-test"


def test_verification_failure_saves_no_quiz(client, draft, monkeypatch):
    class RejectingAI:
        async def complete(
            self, owner, prompt, structured=True, task="default", response_schema=None
        ):
            value = (
                {"accepted": False, "issues": ["Unsupported answer"]}
                if "Independently audit" in prompt
                else draft
            )
            return Completion(json.dumps(value), "controlled-test", "fixture", 20)

    monkeypatch.setattr(workflows, "ai", RejectingAI())
    r = client.post(
        "/api/v1/quizzes/generate",
        json={
            "source": "Plants absorb carbon dioxide. Photosynthesis uses light energy.",
            "count": 1,
        },
    )
    assert r.status_code == 502
    assert client.get("/api/v1/quizzes").json() == []
    assert client.get("/api/v1/agents/runs").json()[0]["status"] == "failed"


@pytest.mark.asyncio
async def test_provider_streaming_and_task_model():
    seen = []

    def handle(req):
        seen.append(json.loads(req.content))
        data = (
            "data: "
            + json.dumps({"choices": [{"delta": {"content": "Hello"}}]})
            + "\n\ndata: [DONE]\n\n"
        )
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, text=data
        )

    ai = Gateway(
        Settings(
            _env_file=None,
            groq_api_key="test",
            ai_task_models={"tutor": {"groq": "configured-task-model"}},
        ),
        httpx.MockTransport(handle),
    )
    chunks = [c async for c in ai.stream("owner", "Source question", "tutor")]
    assert [c["event"] for c in chunks] == ["start", "token", "done"]
    assert chunks[1]["text"] == "Hello" and chunks[-1]["verified"] is False
    assert seen[0]["model"] == "configured-task-model"


@pytest.mark.asyncio
async def test_concurrent_identical_requests_are_deduplicated():
    import asyncio

    calls = []

    async def handle(req):
        calls.append(req)
        await asyncio.sleep(0.02)
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    ai = Gateway(
        Settings(_env_file=None, groq_api_key="test"), httpx.MockTransport(handle)
    )
    results = await asyncio.gather(
        *(ai.complete("owner", "same prompt") for _ in range(8))
    )
    assert len(calls) == 1 and sum(c.cached for c in results) == 7


def test_content_tutor_and_planner_graph_paths(client, monkeypatch):
    class TaskAI:
        async def complete(
            self, owner, prompt, structured=True, task="default", response_schema=None
        ):
            if task == "verification":
                value = {"accepted": True, "issues": []}
            elif task == "summary":
                value = {
                    "overview": "Plants absorb carbon dioxide.",
                    "mainPoints": ["Photosynthesis uses light."],
                    "keyTerms": [],
                }
            else:
                value = {"text": "Review photosynthesis. [Source section 1]"}
            return Completion(json.dumps(value), "controlled-test", "fixture", 10)

    monkeypatch.setattr(workflows, "ai", TaskAI())
    for task, node in (
        ("summary", "content"),
        ("tutor", "tutor"),
        ("planner", "planner"),
    ):
        response = client.post(
            "/api/v1/agents/run",
            json={
                "task": task,
                "source": "Plants absorb carbon dioxide. Photosynthesis uses light.",
                "context": "What should I review?",
            },
        )
        assert response.status_code == 200, response.text
        assert [s["agent"] for s in response.json()["steps"]] == [
            "orchestrator",
            "retrieval",
            node,
            "verification",
        ]
    assert len(client.get("/api/v1/study-plans").json()) == 1


@pytest.mark.asyncio
async def test_rate_limit_message_wait_is_bounded_and_retried(monkeypatch):
    waits = []
    calls = []

    async def sleep(seconds):
        waits.append(seconds)

    monkeypatch.setattr("backend.app.providers.asyncio.sleep", sleep)

    def handle(req):
        calls.append(req)
        if len(calls) == 1:
            return httpx.Response(
                429,
                json={
                    "error": {
                        "message": "Rate limit reached. Please try again in 12.5s."
                    }
                },
            )
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]},
        )

    ai = Gateway(
        Settings(_env_file=None, groq_api_key="test", ai_rate_limit_wait_seconds=60),
        httpx.MockTransport(handle),
    )
    assert (await ai.complete("owner", "JSON prompt")).provider == "groq"
    assert len(calls) == 2 and waits == [12.75]


@pytest.mark.asyncio
async def test_long_material_has_bounded_distributed_evidence():
    source = "START_OF_SOURCE " + ("contextual material " * 10000) + " END_OF_SOURCE"
    result = await workflows.retrieval(
        {"source": source, "task": "summary", "context": ""}
    )
    assert len(result["evidence"]) <= 7000
    assert (
        "START_OF_SOURCE" in result["evidence"]
        and "END_OF_SOURCE" in result["evidence"]
    )


@pytest.mark.asyncio
async def test_summary_uses_small_budget_and_low_reasoning():
    calls = []

    def handle(req):
        calls.append(json.loads(req.content))
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]},
        )

    ai = Gateway(
        Settings(_env_file=None, groq_api_key="test"), httpx.MockTransport(handle)
    )
    await ai.complete("owner", "JSON prompt", task="summary")
    assert calls[0]["max_tokens"] == 1600 and calls[0]["reasoning_effort"] == "low"


def test_rejected_content_is_revised_once_and_reviewed_again(client, monkeypatch):
    class RevisingAI:
        reviews = 0
        revisions = 0

        async def complete(
            self, owner, prompt, structured=True, task="default", response_schema=None
        ):
            if task == "verification":
                self.reviews += 1
                value = {
                    "accepted": self.reviews > 1,
                    "issues": ["Remove unsupported detail"]
                    if self.reviews == 1
                    else [],
                }
            else:
                if "REVISION REQUIRED" in prompt:
                    self.revisions += 1
                value = {
                    "overview": "Plants absorb carbon dioxide.",
                    "mainPoints": ["Plants use light."],
                    "keyTerms": [],
                }
            return Completion(json.dumps(value), "controlled-test", "fixture", 10)

    ai = RevisingAI()
    monkeypatch.setattr(workflows, "ai", ai)
    response = client.post(
        "/api/v1/agents/run",
        json={
            "task": "summary",
            "source": "Plants absorb carbon dioxide and use light.",
            "context": "",
        },
    )
    assert response.status_code == 200, response.text
    assert ai.reviews == 2 and ai.revisions == 1
    steps = response.json()["steps"]
    assert [s["agent"] for s in steps] == [
        "orchestrator",
        "retrieval",
        "content",
        "verification",
        "content",
        "verification",
    ]
    assert steps[3]["status"] == "needs_revision"


@pytest.mark.asyncio
async def test_quiz_requests_use_strict_schema_without_reusing_invalid_candidates():
    calls = []

    def handle(req):
        calls.append(json.loads(req.content))
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]},
        )

    ai = Gateway(
        Settings(_env_file=None, groq_api_key="test"), httpx.MockTransport(handle)
    )
    schema = {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": False,
    }
    first = await ai.complete("owner", "quiz JSON", task="quiz", response_schema=schema)
    second = await ai.complete(
        "owner", "quiz JSON", task="quiz", response_schema=schema
    )
    assert len(calls) == 2 and not first.cached and not second.cached
    assert calls[0]["response_format"]["type"] == "json_schema"
    assert calls[0]["response_format"]["json_schema"]["strict"] is True


@pytest.mark.asyncio
async def test_provider_json_generation_rejection_enters_format_repair_path():
    def handle(req):
        return httpx.Response(
            400,
            json={
                "error": {
                    "code": "json_validate_failed",
                    "message": "Invalid generated JSON",
                    "failed_generation": "{unfinished",
                }
            },
        )

    ai = Gateway(
        Settings(_env_file=None, groq_api_key="test"), httpx.MockTransport(handle)
    )
    with pytest.raises(AIError, match="AI generated malformed JSON"):
        await ai.complete("owner", "quiz JSON", task="quiz")
    failure = ai.status("owner")["recent_failures"][-1]
    assert (
        failure["code"] == "json_validate_failed" and failure["json_complete"] is False
    )
    assert "failed_generation" not in failure and "unfinished" not in json.dumps(
        failure
    )


def test_compound_retry_durations_are_not_truncated():
    response = httpx.Response(
        429, json={"error": {"message": "Please try again in 1m12.5s."}}
    )
    assert Gateway.response_retry_delay(response) == 72.75
    assert Gateway.duration_seconds("2m3.25s") == 123.25


@pytest.mark.asyncio
async def test_success_headers_pace_following_requests_without_calling_fallback(
    monkeypatch,
):
    waits = []

    async def sleep(seconds):
        waits.append(seconds)

    monkeypatch.setattr("backend.app.providers.asyncio.sleep", sleep)
    calls = []

    def handle(req):
        calls.append(req)
        return httpx.Response(
            200,
            headers={
                "x-ratelimit-remaining-tokens": "10",
                "x-ratelimit-reset-tokens": "5s",
            },
            json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]},
        )

    ai = Gateway(
        Settings(_env_file=None, groq_api_key="test"), httpx.MockTransport(handle)
    )
    await ai.complete("owner", "first JSON", task="summary")
    await ai.complete("owner", "second JSON", task="summary")
    assert len(calls) == 2 and len(waits) == 1 and 4 < waits[0] < 6


@pytest.mark.asyncio
async def test_small_quiz_and_gemini_fallback_have_bounded_generation_settings():
    seen = []

    def handle(req):
        seen.append(json.loads(req.content))
        return httpx.Response(
            200, json={"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}
        )

    ai = Gateway(
        Settings(_env_file=None, gemini_api_key="test", ai_primary_provider="gemini"),
        httpx.MockTransport(handle),
    )
    schema = {
        "type": "object",
        "properties": {"questions": {"type": "array", "maxItems": 3}},
    }
    await ai.complete(
        "owner", "Generate three questions.", task="quiz", response_schema=schema
    )
    config = seen[0]["generationConfig"]
    assert config["maxOutputTokens"] == 1260
    assert config["thinkingConfig"] == {"thinkingLevel": "low"}
    assert config["responseJsonSchema"] == schema


@pytest.mark.asyncio
async def test_exhausted_model_uses_only_existing_configured_model_fallback():
    models = []

    def handle(req):
        model = json.loads(req.content)["model"]
        models.append(model)
        if model == "openai/gpt-oss-20b":
            return httpx.Response(
                429,
                headers={"Retry-After": "900"},
                json={"error": {"message": "Rate limit on tokens per day (TPD)."}},
            )
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": '{"text":"ok"}'}, "finish_reason": "stop"}
                ]
            },
        )

    ai = Gateway(
        Settings(
            _env_file=None,
            groq_api_key="test",
            gemini_api_key="test",
            ai_task_models={"verification": {"groq": "openai/gpt-oss-120b"}},
        ),
        httpx.MockTransport(handle),
    )
    result = await ai.complete("owner", "JSON study content", task="notes")
    assert models == ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]
    assert result.model == "openai/gpt-oss-120b" and result.provider == "groq"
    assert ai.status("owner")["recent_failures"][0]["quota"] == "tokens per day"
