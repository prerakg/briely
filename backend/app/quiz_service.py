import secrets
import time
from fastapi import HTTPException
from sqlalchemy import select, func
from .models import Quiz, Version, Attempt
from .schemas import QuizDraft
from .security import digest


def own_quiz(db, quiz_id, owner):
    quiz = db.get(Quiz, quiz_id)
    if not quiz or quiz.owner != owner:
        raise HTTPException(404, "Quiz not found")
    return quiz


def live_version(db, share_id, invite="", allow_private=False):
    v = db.scalar(select(Version).where(Version.share_id == share_id).with_for_update())
    if not v or not v.active:
        raise HTTPException(404, "Quiz is unavailable")
    expiry = v.snapshot["settings"].get("expires_at")
    if expiry:
        from datetime import datetime

        if datetime.fromisoformat(expiry).timestamp() <= time.time():
            raise HTTPException(410, "This quiz has expired")
    if (
        v.invite_hash
        and not allow_private
        and not secrets.compare_digest(v.invite_hash, digest(invite))
    ):
        raise HTTPException(403, "An invitation code is required")
    return v


def public_quiz(v, attempt=None):
    data = v.snapshot
    questions = {q["id"]: q for q in data["questions"]}
    order = attempt.question_order if attempt else list(questions)
    result = []
    for qid in order:
        q = questions[qid]
        indices = (
            attempt.option_orders[qid] if attempt else list(range(len(q["options"])))
        )
        result.append(
            {
                "id": qid,
                "question": q["question"],
                "type": q["type"],
                "options": [q["options"][i] for i in indices],
                "difficulty": q["difficulty"],
                "topic": q["topic"],
            }
        )
    return {
        "title": data["title"],
        "question_count": len(result),
        "questions": result,
        "settings": data["settings"],
        "share_id": v.share_id,
    }


def validate_answers(questions, answers):
    by_id = {q["id"]: q for q in questions}
    if set(answers) - set(by_id):
        raise HTTPException(422, "Unknown question ID")
    for qid, selected in answers.items():
        q = by_id[qid]
        if len(selected) != len(set(selected)) or any(
            type(i) is not int or i < 0 or i >= len(q["options"]) for i in selected
        ):
            raise HTTPException(422, "Invalid option index")
        if q["type"] != "multiple" and len(selected) > 1:
            raise HTTPException(422, "Only one answer is allowed")


def grade(snapshot, answers, option_orders=None):
    validate_answers(snapshot["questions"], answers)
    feedback = []
    weak = {}
    score = 0
    for q in snapshot["questions"]:
        selected = answers.get(q["id"], [])
        order = (option_orders or {}).get(q["id"], list(range(len(q["options"]))))
        canonical = {order[i] for i in selected}
        correct = canonical == set(q["correct"])
        score += int(correct)
        if not correct:
            weak[q["topic"]] = weak.get(q["topic"], 0) + 1
        item = {
            "id": q["id"],
            "question": q["question"],
            "correct": correct,
            "selected": selected,
            "topic": q["topic"],
        }
        if snapshot["settings"]["show_explanations"]:
            item.update(
                {
                    "correct_answers": [q["options"][i] for i in q["correct"]],
                    "explanation": q["explanation"],
                }
            )
        feedback.append(item)
    return {
        "score": score,
        "total": len(feedback),
        "percentage": round(100 * score / len(feedback), 1),
        "feedback": feedback,
        "weak_topics": sorted(weak, key=weak.get, reverse=True),
        "recommendations": [
            f"Review {t}, explain it from memory, then retry a practice quiz."
            for t in sorted(weak, key=weak.get, reverse=True)
        ],
    }
