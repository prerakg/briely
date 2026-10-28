import time
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.models import Session, Attempt, Version
from backend.app.schemas import QuizDraft
from pydantic import ValidationError
import pytest

P = "/api/v1"


def start(c, share, **kw):
    r = c.post(f"{P}/shared-quizzes/{share}/attempts", json={"name": "Learner", **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_publish_guest_grade_analytics(client, published):
    q, p = published
    with TestClient(app) as recipient:
        public = recipient.get(f"{P}/shared-quizzes/{p['share_id']}")
        assert public.status_code == 200
        question = public.json()["questions"][0]
        assert not {"correct", "explanation", "source_quote"} & question.keys()
        a = start(recipient, p["share_id"])
        assert (
            recipient.get(f"{P}/attempts/{a['attempt_id']}/results").status_code == 409
        )
        result = recipient.post(
            f"{P}/attempts/{a['attempt_id']}/submit", json={"answers": {"q1": [0]}}
        )
        assert result.json()["percentage"] == 100
        assert result.json()["feedback"][0]["explanation"]
        assert (
            recipient.get(f"{P}/attempts/{a['attempt_id']}/results").json()
            == result.json()
        )
        assert (
            recipient.post(
                f"{P}/attempts/{a['attempt_id']}/submit", json={"answers": {"q1": [0]}}
            ).json()
            == result.json()
        )
        assert (
            recipient.post(
                f"{P}/attempts/{a['attempt_id']}/submit", json={"answers": {"q1": [1]}}
            ).status_code
            == 409
        )
    stats = client.get(f"{P}/quizzes/{q['id']}/analytics").json()
    assert (
        stats["total_attempts"] == 1
        and stats["average"] == 100
        and stats["distribution"] == [0, 0, 0, 0, 1]
    )
    assert stats["topics"][0]["correct"] == 1


def test_ownership_and_scoped_guest(client, published):
    q, p = published
    a = start(client, p["share_id"])
    with TestClient(app) as other:
        assert other.get(f"{P}/quizzes/{q['id']}").status_code == 401
        other.post(f"{P}/auth/session")
        for url in (f"/quizzes/{q['id']}", f"/quizzes/{q['id']}/analytics"):
            assert other.get(P + url).status_code == 404
        assert other.post(f"{P}/quizzes/{q['id']}/publish").status_code == 404
        assert other.get(f"{P}/attempts/{a['attempt_id']}").status_code == 404
        assert (
            other.post(
                f"{P}/attempts/{a['attempt_id']}/submit", json={"answers": {}}
            ).status_code
            == 404
        )


def test_immutable_snapshot_unpublish(client, published, draft):
    q, p = published
    draft["questions"][0]["correct"] = [1]
    assert client.patch(f"{P}/quizzes/{q['id']}", json=draft).status_code == 200
    a = start(client, p["share_id"])
    assert (
        client.post(
            f"{P}/attempts/{a['attempt_id']}/submit", json={"answers": {"q1": [0]}}
        ).json()["score"]
        == 1
    )
    client.post(f"{P}/quizzes/{q['id']}/unpublish")
    assert client.get(f"{P}/shared-quizzes/{p['share_id']}").status_code == 404
    assert client.get(f"{P}/attempts/{a['attempt_id']}/results").status_code == 200


def test_limits_resume_timing_and_invalid_answers(client, published):
    q, p = published
    a = start(client, p["share_id"])
    assert start(client, p["share_id"])["attempt_id"] == a["attempt_id"]
    url = f"{P}/attempts/{a['attempt_id']}/submit"
    assert client.post(url, json={"answers": {"foreign": [0]}}).status_code == 422
    assert client.post(url, json={"answers": {"q1": [99]}}).status_code == 422
    assert client.post(url, json={"answers": {"q1": [0, 1]}}).status_code == 422
    with Session() as db:
        attempt = db.get(Attempt, a["attempt_id"])
        attempt.deadline = time.time() - 10
        db.commit()
    result = client.post(url, json={"answers": {"q1": [0]}}).json()
    assert result["score"] == 0 and result["timed_out"]
    b = start(client, p["share_id"])
    client.post(f"{P}/attempts/{b['attempt_id']}/submit", json={"answers": {}})
    assert (
        client.post(
            f"{P}/shared-quizzes/{p['share_id']}/attempts",
            json={"name": "Changed name"},
        ).status_code
        == 403
    )


def test_private_expiry_no_explanation(client, draft):
    draft["settings"].update({"access": "private", "show_explanations": False})
    q = client.post(P + "/quizzes", json=draft).json()
    p = client.post(f"{P}/quizzes/{q['id']}/publish").json()
    assert client.get(f"{P}/shared-quizzes/{p['share_id']}").status_code == 403
    assert (
        client.get(
            f"{P}/shared-quizzes/{p['share_id']}",
            headers={"X-Invite-Code": p["invite"]},
        ).status_code
        == 200
    )
    a = start(client, p["share_id"], invite=p["invite"])
    result = client.post(
        f"{P}/attempts/{a['attempt_id']}/submit", json={"answers": {"q1": [0]}}
    ).json()
    assert (
        "explanation" not in result["feedback"][0]
        and "correct_answers" not in result["feedback"][0]
    )
    with Session() as db:
        v = db.get(Version, db.get(Attempt, a["attempt_id"]).version_id)
        v.snapshot = {
            **v.snapshot,
            "settings": {
                **v.snapshot["settings"],
                "expires_at": (
                    datetime.now(timezone.utc) - timedelta(seconds=1)
                ).isoformat(),
            },
        }
        db.commit()
    assert (
        client.get(
            f"{P}/shared-quizzes/{p['share_id']}",
            headers={"X-Invite-Code": p["invite"]},
        ).status_code
        == 410
    )


def test_shuffle_is_graded_by_canonical_indices(client, draft):
    draft["settings"]["shuffle_options"] = True
    q = client.post(P + "/quizzes", json=draft).json()
    p = client.post(f"{P}/quizzes/{q['id']}/publish").json()
    a = start(client, p["share_id"])
    displayed = a["questions"][0]["options"].index("Carbon dioxide")
    assert (
        client.post(
            f"{P}/attempts/{a['attempt_id']}/submit",
            json={"answers": {"q1": [displayed]}},
        ).json()["score"]
        == 1
    )


def test_multiple_answer_grading(client, draft):
    draft["questions"][0].update(
        {"type": "multiple", "options": ["A", "B", "C"], "correct": [0, 2]}
    )
    q = client.post(P + "/quizzes", json=draft).json()
    p = client.post(f"{P}/quizzes/{q['id']}/publish").json()
    a = start(client, p["share_id"])
    assert (
        client.post(
            f"{P}/attempts/{a['attempt_id']}/submit", json={"answers": {"q1": [2, 0]}}
        ).json()["score"]
        == 1
    )


def test_schema_rejects_ambiguous_structures(client, draft):
    draft["questions"][0]["options"] = ["A", "a"]
    assert client.post(P + "/quizzes", json=draft).status_code == 422
    draft["questions"][0]["options"] = ["A", "B"]
    draft["questions"].append(dict(draft["questions"][0]))
    assert client.post(P + "/quizzes", json=draft).status_code == 422


def test_csrf_and_public_leaderboard(client, published):
    q, p = published
    assert (
        client.post(
            P + "/auth/session", headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    assert (
        client.get(f"{P}/shared-quizzes/{p['share_id']}/leaderboard").status_code == 403
    )


def test_production_configuration_fails_closed():
    from backend.app.config import Settings

    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            app_env="production",
            database_url="sqlite://",
            supabase_url="",
            supabase_anon_key="",
        )


def test_opt_in_materials_and_retrieval_are_owner_scoped(client):
    material = client.post(
        P + "/materials",
        json={
            "title": "Private lecture",
            "source": "Private biology lesson: plants absorb carbon dioxide.",
        },
    ).json()
    assert client.get(P + "/materials").json()[0]["id"] == material["id"]
    assert (
        client.get(P + "/materials/" + material["id"] + "/retrieve?q=plants").json()[0][
            "section"
        ]
        == 1
    )
    with TestClient(app) as other:
        other.post(P + "/auth/session")
        assert other.get(P + "/materials").json() == []
        assert other.get(P + "/materials/" + material["id"]).status_code == 404
        assert (
            other.get(P + "/materials/" + material["id"] + "/retrieve").status_code
            == 404
        )
