"""Validation at the AI boundary; domain/public API schemas remain strict."""

import html
import re
from pydantic import ValidationError
from .models import uid
from .schemas import Question, QuizDraft


QUESTION_FIELDS = set(Question.model_fields)
TYPE_NAMES = {
    "single": "single",
    "single_answer": "single",
    "multiple_choice": "single",
    "mcq": "single",
    "multiple": "multiple",
    "multiple_answer": "multiple",
    "multi_select": "multiple",
    "boolean": "boolean",
    "true_false": "boolean",
}


def validation_feedback(error):
    if isinstance(error, ValidationError):
        return "; ".join(
            ".".join(map(str, item["loc"]))
            + ": "
            + item["type"]
            + " ("
            + item["msg"]
            + ")"
            for item in error.errors(include_input=False, include_url=False)[:8]
        )
    return str(error)


def source_quote(quote, source):
    if not isinstance(quote, str) or not quote.strip():
        raise ValueError("Every question needs a supporting source_quote")
    # Decode entities and ignore line wrapping, while preserving actual words.
    decoded = html.unescape(source)
    pattern = r"\s+".join(re.escape(part) for part in html.unescape(quote).split())
    match = re.search(pattern, decoded)
    if not match:
        raise ValueError("source_quote must reproduce words from the supplied source")
    return match.group(0)


def quiz_schema(options, source_ids):
    types = (
        [options["question_type"]]
        if options["question_type"] != "mixed"
        else ["single", "multiple", "boolean"]
    )
    difficulties = (
        [options["difficulty"]]
        if options["difficulty"] != "mixed"
        else ["easy", "medium", "hard"]
    )
    properties = {
        "question": {"type": "string"},
        "type": {"type": "string", "enum": types},
        "options": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 2,
            "maxItems": 6,
        },
        "correct": {
            "type": "array",
            "items": {"type": "integer", "minimum": 0, "maximum": 5},
            "minItems": 1,
            "maxItems": 5,
        },
        "explanation": {"type": "string"},
        "difficulty": {"type": "string", "enum": difficulties},
        "topic": {"type": "string"},
        "source_section": {"type": "string", "enum": list(source_ids)},
    }
    if types == ["boolean"]:
        properties["options"].update(
            {
                "minItems": 2,
                "maxItems": 2,
                "items": {"type": "string", "enum": ["True", "False"]},
            }
        )
        properties["correct"].update(
            {
                "minItems": 1,
                "maxItems": 1,
                "items": {"type": "integer", "minimum": 0, "maximum": 1},
            }
        )
    elif types == ["single"]:
        properties["correct"]["maxItems"] = 1
    question = {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "items": question,
                "minItems": options["count"],
                "maxItems": options["count"],
            }
        },
        "required": ["questions"],
        "additionalProperties": False,
    }


def quiz_candidate(draft, passages):
    questions = []
    for question in draft["questions"]:
        ref = next(
            (key for key, text in passages.items() if text == question["source_quote"]),
            None,
        )
        if ref is not None:
            questions.append(
                {
                    **{
                        key: value
                        for key, value in question.items()
                        if key != "source_quote"
                    },
                    "source_section": ref,
                }
            )
        else:
            questions.append(question)
    return {**draft, "questions": questions}


def generated_quiz(value, options, source, passages=None):
    if not isinstance(value, dict) or not isinstance(value.get("questions"), list):
        raise ValueError("Return an object containing a questions array")
    questions = []
    for raw in value["questions"]:
        if not isinstance(raw, dict):
            raise ValueError("Each question must be an object")
        data = dict(raw)
        if isinstance(data.get("type"), str):
            name = re.sub(r"[ -]+", "_", data["type"].strip().lower())
            data["type"] = TYPE_NAMES.get(name, name)
        if isinstance(data.get("difficulty"), str):
            data["difficulty"] = data["difficulty"].strip().lower()
        choices = data.get("options")
        answer = data.get("correct")
        # A canonical integer index expressed as a scalar is unambiguous.
        if type(answer) is int:
            answer = [answer]
        if "correct" in data and "correctAnswer" in data:
            alias = data["correctAnswer"]
            if (
                not isinstance(alias, str)
                or not isinstance(choices, list)
                or choices.count(alias) != 1
                or answer != [choices.index(alias)]
            ):
                raise ValueError(
                    "Conflicting answer keys must be corrected, not guessed"
                )
        if "correct" not in data and "correctAnswer" in data:
            text = data["correctAnswer"]
            if (
                isinstance(text, str)
                and isinstance(choices, list)
                and choices.count(text) == 1
            ):
                answer = [choices.index(text)]
            else:
                raise ValueError(
                    "correctAnswer must exactly match one option; use correct zero-based indices"
                )
        if isinstance(answer, list):
            answer = [
                int(i) if isinstance(i, str) and re.fullmatch(r"[0-9]+", i) else i
                for i in answer
            ]
        data["correct"] = answer
        data["id"] = uid()  # IDs belong to the server, not the language model.
        data = {key: value for key, value in data.items() if key in QUESTION_FIELDS}
        ref = raw.get("source_section")
        if ref is not None:
            if not passages or ref not in passages:
                raise ValueError("Select a supplied source_section ID")
            # Bind to actual source text instead of asking the model to copy it.
            data["source_quote"] = source_quote(passages[ref], source)
        question = Question.model_validate(data)
        question.source_quote = source_quote(question.source_quote, source)
        questions.append(question)
    # The creator title/settings are not controlled by generated JSON.
    draft = QuizDraft(title=options["title"], questions=questions)
    if len(draft.questions) != options["count"]:
        raise ValueError(f"Return exactly {options['count']} questions")
    excluded = {
        re.sub(r"\W+", "", text.casefold()) for text in options.get("exclude", [])
    }
    for q in draft.questions:
        if re.sub(r"\W+", "", q.question.casefold()) in excluded:
            raise ValueError("Do not repeat a previous question")
        if options["question_type"] != "mixed" and q.type != options["question_type"]:
            raise ValueError("Use the requested question type")
        if options["difficulty"] != "mixed" and q.difficulty != options["difficulty"]:
            raise ValueError("Use the requested difficulty")
    return draft


def notes_requirements(source):
    words = len(source.split())
    if words >= 1800:
        return 450, "900–1300 words"
    if words >= 600:
        return 250, "550–850 words"
    if words >= 200:
        return 120, "250–450 words"
    return 0, "a proportionate explanation covering every supplied concept"


def notes_quality(text, minimum):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Return nonempty Markdown in the text field")
    if minimum and (
        len(text.split()) < minimum or len(re.findall(r"^##\s", text, re.M)) < 3
    ):
        raise ValueError(
            f"Expand to at least {minimum} words and three substantive topic sections"
        )
