"""Bounded, typed LangGraph workflows with source retrieval and an independent reviewer."""

import json
import html
import re
import time
from typing import TypedDict, Any, Literal
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, START, END
from .providers import gateway, AIError
from .config import get_settings
from .generation import (
    generated_quiz,
    quiz_schema,
    quiz_candidate,
    validation_feedback,
    notes_requirements,
    notes_quality,
)
from .schemas import QuizDraft, GenerateRequest, AIRequest
from .models import Session, AgentRun, StudyPlan


class State(TypedDict, total=False):
    owner: str
    task: str
    source: str
    context: str
    options: dict
    evidence: str
    source_passages: dict[str, str]
    result: Any
    run_id: str
    steps: list[dict]
    verified: bool
    revision_count: int
    review_issues: list[str]
    review_question_ids: list[str]


class Summary(BaseModel):
    overview: str
    mainPoints: list[str]
    keyTerms: list[dict[str, str]]


class Flashcard(BaseModel):
    front: str
    back: str
    difficulty: Literal["Easy", "Medium", "Hard"]
    topic: str


class Review(BaseModel):
    accepted: bool
    issues: list[str] = Field(default_factory=list)
    question_ids: list[str] = Field(default_factory=list)


class Workflows:
    def __init__(self, ai=None):
        self.ai = ai or gateway
        graph = StateGraph(State)
        for name, fn in [
            ("orchestrator", self.orchestrator),
            ("retrieval", self.retrieval),
            ("content", self.content),
            ("quiz", self.quiz),
            ("verification", self.verification),
            ("tutor", self.tutor),
            ("planner", self.planner),
        ]:
            graph.add_node(name, self.track(name, fn))
        graph.add_edge(START, "orchestrator")
        graph.add_edge("orchestrator", "retrieval")
        graph.add_conditional_edges(
            "retrieval",
            lambda s: (
                "quiz"
                if s["task"] == "quiz"
                else s["task"]
                if s["task"] in ("tutor", "planner")
                else "content"
            ),
        )
        for name in ("content", "quiz", "tutor", "planner"):
            graph.add_edge(name, "verification")
        graph.add_conditional_edges(
            "verification",
            lambda s: (
                END
                if s.get("verified")
                else "quiz"
                if s["task"] == "quiz"
                else s["task"]
                if s["task"] in ("tutor", "planner")
                else "content"
            ),
        )
        self.graph = graph.compile()

    def track(self, name, fn):
        async def node(state):
            began = time.monotonic()
            try:
                update = await fn(state)
            except Exception as error:
                safe_error = (
                    str(error)
                    if isinstance(error, AIError)
                    else "This workflow step failed validation."
                )
                with Session() as db:
                    run = db.get(AgentRun, state["run_id"])
                    run.steps = state.get("steps", []) + [
                        {
                            "agent": name,
                            "status": "failed",
                            "elapsed": round(time.monotonic() - began, 3),
                            "error": safe_error,
                            "validation_issues": getattr(
                                error, "validation_issues", None
                            ),
                        }
                    ]
                    db.commit()
                raise
            steps = state.get("steps", []) + [
                {
                    "agent": name,
                    "status": update.pop("_status", "complete"),
                    "elapsed": round(time.monotonic() - began, 3),
                    **update.pop("_usage", {}),
                }
            ]
            with Session() as db:
                run = db.get(AgentRun, state["run_id"])
                run.steps = steps
                db.commit()
            return {**update, "steps": steps}

        return node

    async def orchestrator(self, s):
        return {"steps": [], "source": html.unescape(s["source"]).strip()}

    async def retrieval(self, s):
        # Ephemeral per-request index; no cross-user global document index.
        budget = get_settings().ai_evidence_chars
        # Spread bounded passages over the full material instead of sending
        # twelve large overlapping chunks to generation and then again to review.
        width = min(1200, max(500, budget // 8 - 50))
        stride = max(1, width - 100)
        chunks = [
            s["source"][i : i + width] for i in range(0, len(s["source"]), stride)
        ]
        count = min(8, len(chunks))
        query = set(re.findall(r"\w+", s.get("context", "").lower()))
        if query and s["task"] == "tutor":
            indices = sorted(
                range(len(chunks)),
                key=lambda i: len(query & set(re.findall(r"\w+", chunks[i].lower()))),
                reverse=True,
            )[:count]
        else:
            indices = sorted(
                {round(i * (len(chunks) - 1) / max(1, count - 1)) for i in range(count)}
            )
        if s["task"] == "quiz" and len(chunks) > count:
            prefix = list(range(min(3, count)))
            rest = count - len(prefix)
            later = [
                round(
                    len(prefix) + i * (len(chunks) - 1 - len(prefix)) / max(1, rest - 1)
                )
                for i in range(rest)
            ]
            indices = sorted(set(prefix + later))
        evidence_parts = []
        passages = {}
        remaining = budget
        for i in indices:
            ref = str(i + 1)
            label = f"[Source section {ref}]\n"
            passage = chunks[i][: max(0, remaining - len(label) - 2)]
            if not passage.strip():
                break
            passages[ref] = passage
            part = label + passage
            evidence_parts.append(part)
            remaining -= len(part) + 2
        return {"evidence": "\n\n".join(evidence_parts), "source_passages": passages}

    async def ask(self, s, prompt, task=None, response_schema=None):
        if task != "verification" and s.get("review_issues"):
            feedback = json.dumps(s["review_issues"][:6], ensure_ascii=False)[:2500]
            prompt += (
                "\nREVISION REQUIRED: Correct the previous draft using this independent review. Omit unsupported details, preserve the required schema, and use only the supplied source. Review feedback: "
                + feedback
            )
        kwargs = {"task": task or s["task"]}
        if response_schema is not None:
            kwargs["response_schema"] = response_schema
        c = await self.ai.complete(s["owner"], prompt, **kwargs)
        try:
            value = json.loads(c.text)
        except ValueError:
            raise AIError("AI generated malformed JSON. Try a smaller source.", 502)
        return value, {
            "provider": c.provider,
            "model": c.model,
            "tokens": c.tokens,
            "cached": c.cached,
        }

    async def quiz(self, s):
        options = dict(s["options"])
        previous = s.get("result") if s.get("review_issues") else None
        repair_ids = set(s.get("review_question_ids", []))
        repair_positions = []
        if previous:
            repair_positions = [
                i
                for i, q in enumerate(previous["questions"])
                if not repair_ids or q["id"] in repair_ids
            ]
            if not repair_positions:
                repair_positions = list(range(len(previous["questions"])))
            options["count"] = len(repair_positions)
            options["exclude"] = list(
                dict.fromkeys(
                    options.get("exclude", [])
                    + [
                        q["question"]
                        for i, q in enumerate(previous["questions"])
                        if i not in repair_positions
                    ]
                )
            )[:50]
        example = {
            "questions": [
                {
                    "question": "A clear source-grounded question?",
                    "type": "single",
                    "options": [
                        "First option",
                        "Second option",
                        "Third option",
                        "Fourth option",
                    ],
                    "correct": [0],
                    "explanation": "Explain why the selected option follows from the source.",
                    "difficulty": "medium",
                    "topic": "Source topic",
                    "source_quote": "An exact short quotation from the source",
                }
            ]
        }
        kind = (
            options["question_type"]
            if options["question_type"] != "mixed"
            else "single"
        )
        sample = example["questions"][0]
        sample["type"] = kind
        sample["options"] = (
            ["True", "False"] if kind == "boolean" else sample["options"]
        )
        sample["correct"] = [0, 2] if kind == "multiple" else [0]
        sample["difficulty"] = (
            options["difficulty"] if options["difficulty"] != "mixed" else "medium"
        )
        sample.pop("source_quote")
        sample["source_section"] = next(iter(s["source_passages"]))
        schema = quiz_schema(options, s["source_passages"])
        prompt = f"Generate exactly {options['count']} source-grounded questions. Difficulty: {options['difficulty']}. Type: {options['question_type']}. Return ONLY a JSON object with a questions array, using exactly these question fields: {json.dumps(example)}. Build each question from an explicitly stated fact in its chosen source section. Do not ask a general textbook question unless that section contains its answer. If a concept is absent, choose another supported fact. Keep each explanation to 1–2 sentences and each option short; do not include any prose outside JSON. correct MUST be an array of zero-based integer option indices, such as [0] or [1,3]. type must be single/multiple/boolean; difficulty must be easy/medium/hard, never mixed. Use 2–6 distinct options. Boolean questions use the literal options True and False. Single/boolean questions have exactly one correct index; multiple questions need a distractor. source_section MUST be one of these exact section IDs: {json.dumps(list(s['source_passages']))}. Choose the section that supports the answer; do not write or paraphrase a source quotation. The server attaches the actual source text. Honor the requested question type rather than copying another type from examples. Do not invent IDs, settings, or extra metadata. Avoid these previous questions: {json.dumps(options.get('exclude', []))}.\nSOURCE DATA:\n{s['evidence']}"
        if previous:
            candidates = quiz_candidate(previous, s["source_passages"])
            broken = [candidates["questions"][i] for i in repair_positions]
            prompt += (
                "\nCORRECT THESE IDENTIFIED QUESTIONS ONLY. Preserve their intended subject when possible, fix the reviewer issues and select supporting source sections. Prior question IDs identify feedback targets but must not be included in output. Previous questions: "
                + json.dumps(broken, ensure_ascii=False)
            )
        failure = ""
        tokens = 0
        for attempt in range(2):
            try:
                value, usage = await self.ask(
                    s,
                    prompt
                    + (
                        "\nFORMAT CORRECTION: The previous output failed these checks: "
                        + failure
                        + ". Return a fresh complete corrected questions array following the example exactly."
                        if failure
                        else ""
                    ),
                    response_schema=schema,
                )
                tokens += usage["tokens"]
                draft = generated_quiz(
                    value, options, s["source"], s["source_passages"]
                )
                if previous:
                    merged = list(previous["questions"])
                    for index, replacement in zip(repair_positions, draft.questions):
                        merged[index] = replacement.model_dump(mode="json")
                    draft = QuizDraft.model_validate({**previous, "questions": merged})
                usage.update({"tokens": tokens, "generation_attempts": attempt + 1})
                return {"result": draft.model_dump(mode="json"), "_usage": usage}
            except (ValueError, TypeError) as error:
                failure = validation_feedback(error)[:1200]
            except AIError as error:
                if not str(error).startswith("AI generated malformed JSON"):
                    raise
                failure = "Return syntactically valid JSON, without code fences"
        error = AIError(
            "The quiz format could not be corrected after two attempts. Try fewer questions or a more focused source.",
            502,
        )
        error.validation_issues = failure
        raise error

    async def content(self, s):
        if s["task"] == "notes":
            minimum, target = notes_requirements(s["source"])
            prompt = f"Produce notes. Write detailed study notes, NOT a short summary. Target {target}, proportional to the amount of source material. Use a title and clear ## sections: concepts and definitions; step-by-step mechanisms or algorithms; worked examples or traces supported by the lecture; comparisons, edge cases and complexities when stated; and a revision checklist with practice questions. Explain what, why and how rather than listing headings. For code lectures, explain each covered operation and use grounded pseudocode where helpful. Do not add unsupported facts or pad a short source. Return JSON {{text:string}} containing complete Markdown notes. {s.get('context', '')}\nSOURCE DATA:\n{s['evidence']}"
            feedback = ""
            tokens = 0
            for attempt in range(2):
                value, usage = await self.ask(
                    s,
                    prompt
                    + (
                        "\nDETAIL CORRECTION: "
                        + feedback
                        + ". Return the complete expanded notes, not an outline."
                        if feedback
                        else ""
                    ),
                )
                tokens += usage["tokens"]
                text = value.get("text") if isinstance(value, dict) else None
                try:
                    notes_quality(text, minimum)
                    usage.update({"tokens": tokens, "generation_attempts": attempt + 1})
                    return {"result": text, "_usage": usage}
                except ValueError as error:
                    feedback = str(error)
            raise AIError(
                "The provider returned notes that were still too brief after correction. Try a smaller topic or regenerate detailed notes.",
                502,
            )
        shapes = {
            "summary": "{overview:string,mainPoints:string[],keyTerms:[{term:string,definition:string}]}",
            "flashcards": "{items:[{front:string,back:string,difficulty:Easy|Medium|Hard,topic:string}]}",
            "notes": "{text:string} with detailed structured Markdown notes",
            "mindmap": "{text:string} with valid Mermaid graph TD syntax; quoted labels; no HTML, links, directives or code fences",
            "topics": "{items:[{timestamp:number,topic:string}]} preserving actual source timestamps",
        }
        value, usage = await self.ask(
            s,
            f"Produce {s['task']}. Be concise: a summary needs at most six main points and eight key terms; flashcards need eight items. Return JSON {shapes[s['task']]}. Use source only. {s.get('context', '')}\nSOURCE DATA:\n{s['evidence']}",
        )
        try:
            if s["task"] == "summary":
                value = Summary.model_validate(value).model_dump()
            elif s["task"] == "flashcards":
                value = [
                    Flashcard.model_validate(v).model_dump() for v in value["items"]
                ]
            elif s["task"] == "topics":
                value = value["items"]
                if not all(
                    isinstance(v.get("timestamp"), (int, float))
                    and isinstance(v.get("topic"), str)
                    for v in value
                ):
                    raise ValueError()
            else:
                value = value["text"]
                if not isinstance(value, str) or not value.strip():
                    raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise AIError("Generated study content failed validation", 502)
        return {"result": value, "_usage": usage}

    async def tutor(self, s):
        value, usage = await self.ask(
            s,
            f"Answer the learner's question using only source evidence. Cite [Source section N]. If unsupported, say so. Return JSON {{text:string}}. Learner question and recent conversation: {s['context']}\nSOURCE DATA:\n{s['evidence']}",
        )
        if not isinstance(value.get("text"), str):
            raise AIError("Invalid tutor response", 502)
        return {"result": value["text"], "_usage": usage}

    async def planner(self, s):
        value, usage = await self.ask(
            s,
            f"Act as a personalized study planner. Analyze supplied performance, identify weak topics, propose specific revision and a seven-day schedule. Do not invent previous scores. Return JSON {{text:string}} in Markdown.\nPERFORMANCE DATA:\n{s['evidence']}",
        )
        if not isinstance(value.get("text"), str):
            raise AIError("Invalid study plan", 502)
        return {"result": value["text"], "_usage": usage}

    async def verification(self, s):
        rules = (
            "Reject incorrect answer indices, unsupported explanations, ambiguous single-answer questions, multiple valid options in single-answer questions and duplicate questions. For every rejected question return its id in question_ids and explain the specific correction in issues. Check the cited source_section; do not reject because the server uses source IDs instead of copying quotes."
            if s["task"] == "quiz"
            else "For study plans reject invented past scores or contradictions with supplied performance. Proposed future revision activities are recommendations, not factual claims."
            if s["task"] == "planner"
            else "Check factual faithfulness to the supplied excerpts. Reject specific unsupported or contradictory claims and invented citations. A concise summary need not cover every excerpt. Repeating a term in an overview and glossary, paraphrasing, decoding HTML entities, and omitting detail are not errors. Do not apply quiz-answer or duplicate-question rules to study notes."
        )
        candidate = (
            quiz_candidate(s["result"], s["source_passages"])
            if s["task"] == "quiz"
            else s["result"]
        )
        value, usage = await self.ask(
            s,
            f"Independently audit the {s['task']} candidate against the source. {rules} Return accepted=true unless you can identify a concrete factual problem, and give actionable corrections for each actual problem. Return JSON {{accepted:boolean,issues:string[],question_ids:string[]}}.\nSOURCE DATA:\n{s['evidence']}\nCANDIDATE DATA:\n{json.dumps(candidate, ensure_ascii=False)}",
            task="verification",
        )
        try:
            review = Review.model_validate(value)
        except ValueError:
            raise AIError("Verification returned an invalid verdict", 502)
        if not review.accepted and s.get("revision_count", 0) < 1:
            return {
                "verified": False,
                "revision_count": 1,
                "review_issues": review.issues,
                "review_question_ids": review.question_ids,
                "_status": "needs_revision",
                "_usage": usage,
            }
        if not review.accepted:
            raise AIError(
                "Independent verification rejected generated content. Please regenerate or narrow the source.",
                502,
            )
        return {"verified": True, "review_issues": [], "_usage": usage}

    async def run(self, owner, request):
        is_quiz = isinstance(request, GenerateRequest)
        task = "quiz" if is_quiz else request.task
        if task == "quiz" and not is_quiz:
            request = GenerateRequest(source=request.source)
            is_quiz = True
        with Session() as db:
            run = AgentRun(owner=owner, workflow=task)
            db.add(run)
            db.commit()
            run_id = run.id
        start = time.monotonic()
        try:
            state = await self.graph.ainvoke(
                {
                    "owner": owner,
                    "task": task,
                    "source": request.source,
                    "context": "" if is_quiz else request.context,
                    "options": request.model_dump() if is_quiz else {},
                    "run_id": run_id,
                    "steps": [],
                },
                {"recursion_limit": 12},
            )
            with Session() as db:
                run = db.get(AgentRun, run_id)
                run.status = "complete"
                run.elapsed = time.monotonic() - start
                if task == "planner":
                    db.add(StudyPlan(owner=owner, content=state["result"]))
                db.commit()
            return {
                "run_id": run_id,
                "result": state["result"],
                "steps": state["steps"],
            }
        except Exception as e:
            with Session() as db:
                run = db.get(AgentRun, run_id)
                run.status = "failed"
                run.elapsed = time.monotonic() - start
                run.error = (
                    str(e)[:200]
                    if isinstance(e, AIError)
                    else "Workflow failed validation or provider request"
                )
                db.commit()
            if isinstance(e, AIError):
                raise
            raise AIError(
                "Workflow failed safely; no generated content was saved.", 502
            ) from e


workflows = Workflows()
