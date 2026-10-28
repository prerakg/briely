import time
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.models import Session, Room
from sqlalchemy import select

P = "/api/v1"


def test_authoritative_battle_two_players(client, published):
    q, p = published
    room = client.post(
        P + "/quiz-rooms", json={"share_id": p["share_id"], "round_seconds": 10}
    ).json()
    code = room["code"]
    url = P + "/quiz-rooms/" + code
    with TestClient(app) as other:
        for c, name in ((client, "Host"), (other, "Friend")):
            assert c.post(url + "/join", json={"name": name}).status_code == 200
            assert c.post(url + "/ready", json={"ready": True}).status_code == 200
        other.post(P + "/auth/session")
        assert other.post(url + "/start").status_code == 403
        assert client.post(url + "/start").status_code == 200
        state = other.get(url).json()
        assert state["state"] == "playing" and "correct" not in state["question"]
        assert (
            other.post(url + "/answers", json={"round": 1, "answer": [0]}).status_code
            == 409
        )
        assert (
            other.post(url + "/answers", json={"round": 0, "answer": [0]}).status_code
            == 200
        )
        assert (
            other.post(url + "/answers", json={"round": 0, "answer": [0]}).status_code
            == 409
        )
        assert all(p["score"] == 0 for p in other.get(url).json()["participants"])
        with other.websocket_connect(
            url + "/events", headers={"Origin": "http://localhost:3000"}
        ) as ws:
            event = ws.receive_json()
            assert event["answered"] is True and "correct" not in event["question"]
        with Session() as db:
            r = db.scalar(select(Room).where(Room.code == code))
            r.deadline = time.time() - 1
            db.commit()
        final = other.get(url).json()
        assert (
            final["state"] == "finished"
            and final["participants"][0]["name"] == "Friend"
            and final["participants"][0]["score"] == 1000
        )
        assert (
            other.post(url + "/answers", json={"round": 0, "answer": [0]}).status_code
            == 409
        )


def test_room_start_ready_and_expiry(client, published):
    q, p = published
    room = client.post(P + "/quiz-rooms", json={"share_id": p["share_id"]}).json()
    url = P + "/quiz-rooms/" + room["code"]
    assert client.post(url + "/start").status_code == 409
    with Session() as db:
        r = db.scalar(select(Room).where(Room.code == room["code"]))
        r.expires = time.time() - 1
        db.commit()
    assert client.get(url).status_code == 410
