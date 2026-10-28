"""Database-backed authoritative rounds. WebSockets stream sanitized snapshots."""

import time
from fastapi import HTTPException
from sqlalchemy import select, func
from .models import Room, Participant, RoomAnswer, Version
from .quiz_service import live_version


def load_room(db, code):
    room = db.scalar(select(Room).where(Room.code == code.upper()).with_for_update())
    if not room:
        raise HTTPException(404, "Battle room not found")
    if room.expires <= time.time():
        raise HTTPException(410, "Battle room expired")
    version = db.get(Version, room.version_id)
    if not version.active:
        raise HTTPException(410, "This quiz has been unpublished")
    live_version(db, version.share_id, allow_private=True)
    if room.state == "playing":
        total = len(version.snapshot["questions"])
        now = time.time()
        while now >= room.deadline and room.state == "playing":
            room.round += 1
            room.deadline += room.round_seconds
            if room.round >= total:
                room.state = "finished"
        db.flush()
    return room, version


def snapshot(db, code, guest, owner=None):
    room, v = load_room(db, code)
    players = db.scalars(
        select(Participant).where(Participant.room_id == room.id)
    ).all()
    me = next((p for p in players if p.guest == guest), None)
    data = {
        "code": room.code,
        "title": v.snapshot["title"],
        "state": room.state,
        "round": room.round,
        "total": len(v.snapshot["questions"]),
        "deadline": room.deadline,
        "server_time": time.time(),
        "is_host": room.owner == owner,
        "joined": me is not None,
        "round_seconds": room.round_seconds,
    }
    if not me and room.owner != owner:
        return data
    board = []
    for p in players:
        # Only completed rounds contribute to visible scores.
        points = db.scalar(
            select(func.coalesce(func.sum(RoomAnswer.points), 0)).where(
                RoomAnswer.participant_id == p.id, RoomAnswer.round < room.round
            )
        )
        board.append(
            {
                "id": p.id,
                "name": p.name,
                "ready": p.ready,
                "connected": p.seen > time.time() - 15,
                "score": points,
            }
        )
    data["participants"] = sorted(board, key=lambda p: (-p["score"], p["name"]))
    data["me"] = me.id if me else None
    if room.state == "playing" and me:
        q = v.snapshot["questions"][room.round]
        data["question"] = {
            k: q[k]
            for k in ("id", "question", "type", "options", "topic", "difficulty")
        }
        data["answered"] = (
            db.scalar(
                select(RoomAnswer.id).where(
                    RoomAnswer.participant_id == me.id, RoomAnswer.round == room.round
                )
            )
            is not None
        )
    return data
