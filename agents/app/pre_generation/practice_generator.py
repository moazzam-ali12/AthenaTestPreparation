"""
Practice problem generator (problems.source = 'practice').

Practice problems power the quiz tutor's practice loop (after a candidate
misses a quiz question twice). They are served from the DB by
GET /api/learning/[topicSlug]/[subtopicSlug]/practice-problems, matched on
topic_slug + subtopic_slug. Nothing generates them at request time.

Reuses the question-bank pipeline: generate_cpa_problems_batch (prompt with
the difficulty rubric + is_valid_problem) and the independent answer-key
check (verify_answer_keys, strict: unverified problems are dropped). Only
problems that pass every check are written ("approved").

Re-runnable: each subtopic only generates its shortfall per band. Records are
keyed by slugs, not ids, so an --out file can be inserted into another
project (e.g. prod) with --from-file.

Usage:
    cd agents && python -m cli.main generate-practice --subject aud --subtopic <slug> --dry-run
    cd agents && python -m cli.main generate-practice --subject all --out data/practice_all.json
    cd agents && python -m cli.main generate-practice --from-file data/practice_all.json
"""

import asyncio
import json
import os
import time

from app.pre_generation.content_workflow import SUBJECT_CONFIGS
from app.pre_generation.cpa_problem_generator import CPA_SUBJECT_LABELS, generate_cpa_problems_batch
from app.pre_generation.problem_quality import DIFFICULTY_LEVELS, verify_answer_keys
from app.pre_generation.seed_act_question_bank import _resolve_subtopics
from app.utils.db import client, get_subtopic, get_topic_by_slug, save_practice_problems

SUBTOPIC_CONCURRENCY = 5
MAX_ROUNDS = 3  # regenerate the shortfall if verification drops problems
# Offset into PROBLEM_TYPE_ROTATIONS so practice doesn't mirror the quiz bank's batches.
BATCH_OFFSET = 1
E2E_FIXTURE_MARK = "[e2e practice fixture]"


def band_targets(per_subtopic: int) -> dict[str, int]:
    """5 -> 2 easy / 2 medium / 1 hard; other sizes keep roughly 40/40/20."""
    hard = max(1, round(per_subtopic * 0.2)) if per_subtopic >= 3 else 0
    easy = round((per_subtopic - hard) / 2)
    return {"easy": easy, "medium": per_subtopic - hard - easy, "hard": hard}


def _existing(topic_slug: str, subtopic_slug: str) -> tuple[dict[str, int], set[str], int]:
    """Real (non-fixture) practice rows for a subtopic: band counts, stems, next order_index."""
    rows = (
        client()
        .table("problems")
        .select("difficulty, question_text, order_index, hint")
        .eq("source", "practice")
        .eq("topic_slug", topic_slug)
        .eq("subtopic_slug", subtopic_slug)
        .execute()
    ).data or []
    counts = {"easy": 0, "medium": 0, "hard": 0}
    stems: set[str] = set()
    for r in rows:
        if E2E_FIXTURE_MARK in (r.get("hint") or ""):
            continue
        band = r.get("difficulty") or "medium"
        counts[band] = counts.get(band, 0) + 1
        stems.add(_norm(r["question_text"]))
    next_order = max((r.get("order_index") or 0 for r in rows if (r.get("order_index") or 0) < 9000), default=-1) + 1
    return counts, stems, next_order


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def _to_camel(p: dict) -> dict:
    return {"questionText": p["question_text"], "options": p["options"], "correctOption": p["correct_option"]}


async def _generate_subtopic(item: dict, targets: dict[str, int], skip_existing: bool) -> list[dict]:
    counts, stems, _ = _existing(item["topic_slug"], item["subtopic_slug"]) if skip_existing else ({}, set(), 0)
    label = CPA_SUBJECT_LABELS[item["subject"]]
    out: list[dict] = []

    for rnd in range(MAX_ROUNDS):
        have = {b: counts.get(b, 0) + sum(1 for r in out if r["difficulty"] == b) for b in targets}
        missing = {b: targets[b] - have[b] for b in targets if targets[b] - have[b] > 0}
        if not missing:
            break

        async def one_band(band: str, n: int) -> list[dict]:
            batch = await generate_cpa_problems_batch(
                subtopic_name=item["sub_name"],
                topic_name=item["topic_name"],
                subtopic_id=item["subtopic_id"],
                batch_number=BATCH_OFFSET + rnd,
                difficulty=band,
                # Ask for one spare so a single disputed key doesn't cost a round.
                batch_size=n + 1,
                subject=item["subject"],
            )
            # Independent solve without the key; strict = drop if the check can't run.
            keep = await verify_answer_keys([_to_camel(p) for p in batch], label, strict=True)
            kept_stems = {_norm(k["questionText"]) for k in keep}
            return [p for p in batch if _norm(p["question_text"]) in kept_stems][:n]

        results = await asyncio.gather(*(one_band(b, n) for b, n in missing.items()), return_exceptions=True)
        for res in results:
            if isinstance(res, Exception):
                print(f"    !! {item['sub_name']}: {res}", flush=True)
                continue
            for p in res:
                stem = _norm(p["question_text"])
                if stem in stems:
                    continue
                stems.add(stem)
                out.append(p)

    records = []
    for p in out:
        records.append({
            "section": item["subject"],
            "topic_slug": item["topic_slug"],
            "subtopic_slug": item["subtopic_slug"],
            "status": "approved",
            "difficulty": p["difficulty"],
            "difficulty_level": DIFFICULTY_LEVELS[p["difficulty"]],
            "question_text": p["question_text"],
            "options": p["options"],
            "correct_option": p["correct_option"],
            "explanation": p["explanation"],
            "solution_steps": p.get("solution_steps", []),
            "concept_tags": p.get("concept_tags", []),
            "common_errors": p.get("common_errors", []),
            "time_recommendation_seconds": p.get("time_recommendation_seconds", 90),
            "cpa_frequency": p.get("cpa_frequency"),
            "hint": p.get("hint", ""),
            "detailed_hint": p.get("detailed_hint", ""),
            "option_hints": p.get("option_hints", []),
        })
    return records


def insert_practice_records(records: list[dict]) -> dict[str, int]:
    """
    Insert approved records into the current SUPABASE_URL project. Resolves
    subtopic_id by slug in that project and skips stems already present, so
    re-running the same file is a no-op.
    """
    stats = {"inserted": 0, "duplicate": 0, "no_subtopic": 0}
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in records:
        if r.get("status", "approved") == "approved":
            groups.setdefault((r["topic_slug"], r["subtopic_slug"]), []).append(r)

    for (topic_slug, subtopic_slug), recs in groups.items():
        topic = get_topic_by_slug(topic_slug)
        sub = get_subtopic(topic["id"], subtopic_slug) if topic else None
        if not sub:
            print(f"  !! {topic_slug}/{subtopic_slug} not in this DB — skipped {len(recs)}", flush=True)
            stats["no_subtopic"] += len(recs)
            continue
        _, stems, order = _existing(topic_slug, subtopic_slug)
        rows = []
        for r in recs:
            if _norm(r["question_text"]) in stems:
                stats["duplicate"] += 1
                continue
            stems.add(_norm(r["question_text"]))
            rows.append({**r, "subtopic_id": sub["id"], "order_index": order})
            order += 1
        save_practice_problems(rows)
        stats["inserted"] += len(rows)
    return stats


def practice_counts(subject: str = "all", minimum: int = 5) -> list[tuple[str, int, int, int, int]]:
    """Per section: (section, subtopics, subtopics with >= minimum real rows, min per subtopic, total)."""
    out = []
    subjects = list(SUBJECT_CONFIGS) if subject == "all" else [subject]
    for subj in subjects:
        items, _ = _resolve_subtopics(SUBJECT_CONFIGS[subj]["content_map"], subj, count=0, force=True)
        totals = [sum(_existing(i["topic_slug"], i["subtopic_slug"])[0].values()) for i in items]
        out.append((subj.upper(), len(items), sum(1 for t in totals if t >= minimum), min(totals, default=0), sum(totals)))
    return out


def _target_project() -> str:
    url = os.environ.get("SUPABASE_URL", "")
    return url.split("//")[-1].split(".")[0] or "?"


async def generate_practice(
    subject: str = "all",
    per_subtopic: int = 5,
    subtopic: str | None = None,
    dry_run: bool = False,
    out: str | None = None,
    from_file: str | None = None,
) -> dict:
    print(f"  Target Supabase project: {_target_project()}", flush=True)

    if from_file:
        with open(from_file, encoding="utf-8") as fh:
            records = json.load(fh)
        print(f"  Loaded {len(records)} records from {from_file}", flush=True)
        if dry_run:
            return {"records": len(records), "inserted": 0}
        return {"records": len(records), **insert_practice_records(records)}

    targets = band_targets(per_subtopic)
    subjects = list(SUBJECT_CONFIGS) if subject == "all" else [subject]
    items: list[dict] = []
    for subj in subjects:
        found, _ = _resolve_subtopics(SUBJECT_CONFIGS[subj]["content_map"], subj, count=0, force=True)
        items.extend(found)
    if subtopic:
        items = [i for i in items if i["subtopic_slug"] == subtopic]
        if not items:
            raise SystemExit(f"Subtopic '{subtopic}' not found in {subject}")

    print(f"  {len(items)} subtopics, target {targets} each", flush=True)
    sem = asyncio.Semaphore(SUBTOPIC_CONCURRENCY)
    lock = asyncio.Lock()
    stats = {"subtopics": len(items), "generated": 0, "failed": 0, "inserted": 0, "duplicate": 0, "no_subtopic": 0}

    async def run(item: dict) -> list[dict]:
        async with sem:
            t0 = time.time()
            recs = await _generate_subtopic(item, targets, skip_existing=True)
            by_band = {b: sum(1 for r in recs if r["difficulty"] == b) for b in targets}
            print(f"  + [{item['subject'].upper()}] {item['sub_name']}: {len(recs)} {by_band} ({int(time.time() - t0)}s)", flush=True)
            # Save per subtopic so an interrupted run keeps its work (and re-runs resume).
            async with lock:
                if out:
                    _append_out(out, recs)
                if not dry_run:
                    for k, v in insert_practice_records(recs).items():
                        stats[k] += v
                stats["generated"] += len(recs)
            return recs

    results = await asyncio.gather(*(run(i) for i in items), return_exceptions=True)
    for item, res in zip(items, results):
        if isinstance(res, Exception):
            stats["failed"] += 1
            print(f"  !! {item['sub_name']}: {res}", flush=True)
    return stats


def _append_out(out: str, records: list[dict]) -> None:
    """Merge records into the --out JSON file (dedup by subtopic + stem)."""

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    existing = []
    if os.path.exists(out):
        with open(out, encoding="utf-8") as fh:
            existing = json.load(fh)
    seen = {(r["subtopic_slug"], _norm(r["question_text"])) for r in existing}
    merged = existing + [r for r in records if (r["subtopic_slug"], _norm(r["question_text"])) not in seen]
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, indent=2, ensure_ascii=False)
