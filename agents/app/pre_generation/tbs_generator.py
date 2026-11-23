"""
TBS Generator — produces exam-style Task-Based Simulations for every CPA
section and stores them in tbs_tasks / tbs_answer_keys.

Pipeline per task: generate (LLM) -> check_tbs() (schema + numeric recompute)
-> verify_tbs_answer_keys() (independent solve). Only tasks that pass every
check are inserted as 'approved'; tasks whose verifier call failed are
inserted as 'draft' for review; anything disputed or invalid is dropped.

Usage:
    cd agents && python -m cli.main generate-tbs --subject far --per-subtopic 1 --limit-subtopics 4 --dry-run --out tbs_far.json
    cd agents && python -m cli.main generate-tbs --subject all --per-subtopic 1 --limit-subtopics 4
    cd agents && python -m cli.main generate-tbs --from-file tbs_all.json      # insert a dry-run's output, no LLM calls
"""

from __future__ import annotations

import asyncio
import json
from collections import Counter

from agno.agent import Agent
from agno.models.anthropic import Claude

from app.pre_generation.content_workflow import SUBJECT_CONFIGS
from app.pre_generation.cpa_problem_generator import CPA_SUBJECT_LABELS, _extract_json_array
from app.pre_generation.problem_quality import DIFFICULTY_RUBRIC
from app.pre_generation.seed_act_question_bank import _resolve_subtopics
from app.pre_generation.tbs_quality import (
    CONSTANT_PREFIX,
    MAX_FIELDS,
    MIN_FIELDS,
    check_tbs,
    verify_tbs_answer_keys,
)
from app.utils.db import client

MAX_RETRIES = 3
TASK_CONCURRENCY = 4
DIFFICULTY_CYCLE = ["easy", "medium", "hard"]
DEFAULT_MINUTES = {"easy": 10, "medium": 15, "hard": 20}

SECTION_NOTES = {
    "aud": "Use audit workpapers, engagement memos, client emails and control descriptions. Prefer option_list fields (procedures, risk assessments, report modifications, sampling results) plus numeric fields for materiality or sampling calculations.",
    "far": "Use trial balances, invoices, contracts and schedules. Include at least one journal_entry field and numeric fields for measurements under US GAAP.",
    "reg": "Use client tax documents, emails and business facts. Numeric fields for taxable income/basis/gain; option_list for treatment or entity questions.",
    "bar": "Use financial statements, budgets and valuation inputs. Numeric fields for ratios, variances, NPV-style or advanced accounting calculations; a journal_entry where natural.",
    "isc": "Use system descriptions, SOC report excerpts, access logs and policies. Mostly option_list fields (control type, deficiency, SOC report type) with a numeric field where data supports it.",
    "tcp": "Use client planning memos, prior-year returns and entity facts. Numeric fields for tax computations; option_list for planning choices.",
}

tbs_agent = Agent(
    name="CPA TBS Generator",
    model=Claude(id="claude-sonnet-4-6"),
    description="You write realistic CPA Exam Task-Based Simulations with exact answer keys.",
    instructions=[
        "You are an expert AICPA Task-Based Simulation writer.",
        "Generate ONE simulation. Return ONLY a JSON array containing exactly one object with these keys:",
        "- title: string (short, specific)",
        "- difficulty: 'easy' | 'medium' | 'hard'",
        "- instructions: string (what the candidate must do; markdown allowed)",
        "- estMinutes: number (realistic completion time)",
        "- exhibits: 2-4 items of { id: 'ex1'..., title, kind: 'text' | 'table', body?: markdown string (memos, emails, invoices), table?: { columns: string[], rows: (string|number)[][] } }. Table numbers must be plain JSON numbers.",
        f"- fields: {MIN_FIELDS}-{MAX_FIELDS} items of {{ id: 'f1'..., type: 'numeric' | 'option_list' | 'journal_entry', label, points }}. option_list fields add options: string[] (4-8 choices). journal_entry fields add accounts: string[] (a 5-10 account chart of accounts including distractors). numeric fields may add unit: string.",
        "- answers: object keyed by field id:",
        "    numeric: { type: 'numeric', value: number, formula: string, inputs: { name: number } } where formula is a Python arithmetic expression over the input names (+ - * / parentheses, round/min/max/abs) that reproduces value. inputs must be RAW numbers copied verbatim from the exhibits; compute every intermediate amount inside the formula, never as an input. Name pure domain constants (12 months, 365 days) with the prefix " + CONSTANT_PREFIX + ". Work each calculation out step by step before writing value.",
        "    option_list: { type: 'option_list', value: exact text of the correct option }",
        "    journal_entry: { type: 'journal_entry', lines: [{ account (from that field's accounts), side: 'debit' | 'credit', amount: positive number }] } and debits MUST equal credits.",
        "- explanation: string (concise, field by field, citing the standard/code section)",
        "All numeric answers are whole dollars unless the label says otherwise. Every fact needed must be in the exhibits; include a few irrelevant facts on medium/hard.",
        DIFFICULTY_RUBRIC,
        "Never use em-dashes. No markdown code fences or extra text outside the JSON.",
    ],
    markdown=False,
)


REPAIR_ATTEMPTS = 1


async def repair_tbs_task(task: dict, errors: list[str]) -> dict:
    """One self-correction pass: feed the checker's errors back to the generator."""
    prompt = (
        "This simulation failed automated checks. Fix ONLY what is needed so every check passes "
        "(recompute each numeric value from its formula and inputs, make journal entries balance, "
        "make inputs raw exhibit numbers). Return the full corrected simulation as a one-item JSON array.\n"
        "Errors:\n- " + "\n- ".join(errors) + "\n"
        f"Simulation:\n{json.dumps(task)}"
    )
    response = await tbs_agent.arun(prompt)
    fixed = _extract_json_array(response.content)
    if not fixed or not isinstance(fixed[0], dict):
        raise ValueError("empty repair response")
    fixed[0]["difficulty"] = task.get("difficulty")
    return fixed[0]


async def generate_tbs_task(subject: str, topic_name: str, subtopic_name: str, difficulty: str) -> dict:
    prompt = (
        f"CPA Exam Section: {CPA_SUBJECT_LABELS[subject]}\n"
        f"Topic: {topic_name}\nSubtopic: {subtopic_name}\nDifficulty: {difficulty}\n"
        f"{SECTION_NOTES[subject]}\n"
        "Write one task-based simulation for this subtopic."
    )
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            response = await tbs_agent.arun(prompt)
            tasks = _extract_json_array(response.content)
            if not tasks or not isinstance(tasks[0], dict):
                raise ValueError("empty response")
            task = tasks[0]
            task["difficulty"] = difficulty
            return task
        except Exception as e:  # noqa: BLE001
            last_error = e
            if attempt < MAX_RETRIES - 1:
                print(f"  ⚠ retry {attempt + 1}/{MAX_RETRIES - 1} for {subtopic_name}", flush=True)
    raise RuntimeError(f"TBS generation failed for {subtopic_name}: {last_error}")


def _spread(items: list, k: int | None) -> list:
    """k items spread evenly across the list (so a section's TBS cover its range)."""
    if not k or k >= len(items):
        return items
    step = len(items) / k
    return [items[int(i * step)] for i in range(k)]


async def _build_one(item: dict, difficulty: str, verify: bool) -> dict:
    """Generates and checks one task. Returns a record with status approved|draft|rejected."""
    record = {
        "section": item["subject"],
        "subtopic_id": item["subtopic_id"],
        "subtopic": item["sub_name"],
        "difficulty": difficulty,
    }
    try:
        task = await generate_tbs_task(item["subject"], item["topic_name"], item["sub_name"], difficulty)
    except Exception as e:  # noqa: BLE001
        return {**record, "status": "rejected", "reason": f"generation: {e}"}

    errors = check_tbs(task)
    for _ in range(REPAIR_ATTEMPTS):
        if not errors:
            break
        try:
            task = await repair_tbs_task(task, errors)
            errors = check_tbs(task)
        except Exception as e:  # noqa: BLE001
            errors = [*errors, f"repair failed: {e}"]
    if errors:
        return {**record, "task": task, "status": "rejected", "reason": "; ".join(errors[:3])}

    verdict = await verify_tbs_answer_keys(task, CPA_SUBJECT_LABELS[item["subject"]]) if verify else None
    if verdict is False:
        return {**record, "task": task, "status": "rejected", "reason": "disputed answer key"}
    return {**record, "task": task, "status": "approved" if verdict else "draft"}


async def build_tbs(subject: str, per_subtopic: int, limit_subtopics: int | None, verify: bool = True) -> list[dict]:
    subjects = list(SUBJECT_CONFIGS) if subject == "all" else [subject]
    jobs: list[tuple[dict, str]] = []
    for subj in subjects:
        items, _ = _resolve_subtopics(SUBJECT_CONFIGS[subj]["content_map"], subj, count=0, force=True)
        for s_idx, item in enumerate(_spread(items, limit_subtopics)):
            for n in range(per_subtopic):
                jobs.append((item, DIFFICULTY_CYCLE[(s_idx + n) % len(DIFFICULTY_CYCLE)]))

    print(f"  Generating {len(jobs)} TBS across {', '.join(s.upper() for s in subjects)}...", flush=True)
    sem = asyncio.Semaphore(TASK_CONCURRENCY)

    async def run(item: dict, difficulty: str) -> dict:
        async with sem:
            rec = await _build_one(item, difficulty, verify)
            mark = {"approved": "+", "draft": "~", "rejected": "x"}[rec["status"]]
            print(f"  {mark} [{rec['section'].upper()}] {item['sub_name'][:50]} ({difficulty}) {rec.get('reason', '')[:80]}", flush=True)
            return rec

    return list(await asyncio.gather(*(run(i, d) for i, d in jobs)))


# ── Sample selection + persistence ─────────────────────────────────────────

def pick_samples(records: list[dict], sections_with_sample: set[str]) -> None:
    """Marks the best approved easy/medium task per section as the trial sample (in place)."""
    by_section: dict[str, list[dict]] = {}
    for r in records:
        if r["status"] == "approved" and r["difficulty"] in ("easy", "medium"):
            by_section.setdefault(r["section"], []).append(r)
    for section, candidates in by_section.items():
        if section in sections_with_sample:
            continue
        # Prefer easy, then richer tasks (more fields / a journal entry).
        best = min(
            candidates,
            key=lambda r: (
                r["difficulty"] != "easy",
                -len(r["task"]["fields"]),
                not any(f["type"] == "journal_entry" for f in r["task"]["fields"]),
            ),
        )
        best["is_sample"] = True


def _public_fields(fields: list[dict]) -> list[dict]:
    allowed = {"id", "type", "label", "points", "options", "accounts", "unit"}
    return [{k: v for k, v in f.items() if k in allowed and v is not None} for f in fields]


def _clean_exhibits(exhibits: list[dict]) -> list[dict]:
    """Drops null body/table keys (the TS schema treats them as absent)."""
    allowed = {"id", "title", "kind", "body", "table"}
    return [{k: v for k, v in e.items() if k in allowed and v is not None} for e in exhibits]


def _grading_key(answers: dict) -> dict:
    """Strips generator-only metadata (formula/inputs) from the stored key."""
    out = {}
    for fid, key in answers.items():
        if key["type"] == "numeric":
            out[fid] = {"type": "numeric", "value": key["value"], **({"tolerance": key["tolerance"]} if key.get("tolerance") else {})}
        elif key["type"] == "option_list":
            out[fid] = {"type": "option_list", "value": key["value"]}
        else:
            out[fid] = {"type": "journal_entry", "lines": [{k: ln[k] for k in ("account", "side", "amount")} for ln in key["lines"]]}
    return out


def sections_with_existing_sample() -> set[str]:
    rows = client().table("tbs_tasks").select("section").eq("is_sample", True).eq("status", "approved").execute().data or []
    return {r["section"] for r in rows}


def save_tbs(records: list[dict]) -> int:
    saved = 0
    for r in records:
        if r["status"] not in ("approved", "draft"):
            continue
        t = r["task"]
        row = (
            client()
            .table("tbs_tasks")
            .insert({
                "section": r["section"],
                "subtopic_id": r["subtopic_id"],
                "title": t["title"],
                "difficulty": r["difficulty"],
                "instructions": t["instructions"],
                "exhibits": _clean_exhibits(t["exhibits"]),
                "fields": _public_fields(t["fields"]),
                "explanation": t["explanation"],
                "est_minutes": int(t.get("estMinutes") or DEFAULT_MINUTES[r["difficulty"]]),
                "status": r["status"],
                "is_sample": bool(r.get("is_sample")),
            })
            .execute()
            .data[0]
        )
        client().table("tbs_answer_keys").insert({"tbs_id": row["id"], "answers": _grading_key(t["answers"])}).execute()
        saved += 1
    return saved


def summary_table(records: list[dict]) -> str:
    counts = Counter((r["section"], r["difficulty"], r["status"]) for r in records)
    samples = Counter(r["section"] for r in records if r.get("is_sample"))
    sections = sorted({r["section"] for r in records})
    lines = ["  section | easy | medium | hard | approved | draft | rejected | sample", "  " + "-" * 70]
    for s in sections:
        appr = {d: counts[(s, d, "approved")] for d in DIFFICULTY_CYCLE}
        lines.append(
            f"  {s.upper():7} | {appr['easy']:4} | {appr['medium']:6} | {appr['hard']:4} | "
            f"{sum(appr.values()):8} | {sum(counts[(s, d, 'draft')] for d in DIFFICULTY_CYCLE):5} | "
            f"{sum(counts[(s, d, 'rejected')] for d in DIFFICULTY_CYCLE):8} | {samples[s]:6}"
        )
    lines.append("  (easy/medium/hard columns count approved tasks)")
    return "\n".join(lines)


async def generate_tbs(
    subject: str = "all",
    per_subtopic: int = 1,
    limit_subtopics: int | None = None,
    dry_run: bool = False,
    out: str | None = None,
    from_file: str | None = None,
    verify: bool = True,
) -> list[dict]:
    if from_file:
        with open(from_file, encoding="utf-8") as fh:
            records = json.load(fh)
        # Re-run deterministic checks: a hand-edited file can't bypass them.
        for r in records:
            if r["status"] != "rejected" and check_tbs(r.get("task") or {}):
                r["status"], r["reason"] = "rejected", "failed re-check"
            r.pop("is_sample", None)
    else:
        records = await build_tbs(subject, per_subtopic, limit_subtopics, verify)

    pick_samples(records, set() if dry_run else sections_with_existing_sample())

    if out:
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(records, fh, indent=2)
        print(f"  Wrote {len(records)} records to {out}", flush=True)

    if not dry_run:
        print(f"  Saved {save_tbs(records)} task(s) to tbs_tasks.", flush=True)
    print(summary_table(records), flush=True)
    return records
