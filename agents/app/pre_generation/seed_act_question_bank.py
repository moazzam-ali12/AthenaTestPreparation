"""
CPA Question Bank Seeder — generates 20–30 questions per subtopic across all
6 CPA Exam sections (AUD, FAR, REG, BAR, ISC, TCP), tagged source='cpa'.

These are the topic-based questions that power the learning flow: quizzes,
micro-lessons, and progress tracking. Distinct from the full_cpa exam bank
(see cpa_exam_bank_seeder.py) used to assemble full section exam forms.

Idempotent: skips subtopics that already have >= count questions unless --force.

Usage:
    cd agents && python -m cli.main seed-question-bank
    cd agents && python -m cli.main seed-question-bank --subject all --count 25
    cd agents && python -m cli.main seed-question-bank --subject far --count 30 --force
"""

import asyncio
import math
import time

from app.pre_generation.cpa_problem_generator import generate_cpa_problems_batch, BATCH_SIZE
from app.pre_generation.content_workflow import SUBJECT_CONFIGS, _make_slug
from app.pre_generation.cpa_exam_bank_seeder import _ensure_topic_and_subtopics, DIFFICULTY_LEVELS
from app.utils.db import get_topic_by_slug, get_subtopic, get_problem_count, save_problems

PROBLEMS_PER_SUBTOPIC = 25  # midpoint of 20–30 target range
SUBTOPIC_CONCURRENCY = 3
BATCH_CONCURRENCY = 6


def _bucket_difficulties(count: int) -> dict[str, int]:
    """Split count into easy/medium/hard buckets (roughly 30/40/30)."""
    easy = round(count * 0.30)
    hard = round(count * 0.30)
    medium = count - easy - hard
    return {"easy": easy, "medium": medium, "hard": hard}


def _resolve_subtopics(
    content_map: dict, subject: str, count: int, force: bool
) -> tuple[list[dict], int]:
    """Return subtopics that need seeding and count of skipped ones."""
    items: list[dict] = []
    skipped = 0

    for topic_name, meta in content_map.items():
        topic_slug = _make_slug(topic_name)
        topic_row = get_topic_by_slug(topic_slug)

        if topic_row is None:
            print(f"  !! topic '{topic_slug}' not in DB — skipping", flush=True)
            skipped += len(meta["subtopics"])
            continue

        for sub_name in meta["subtopics"]:
            subtopic_slug = _make_slug(sub_name)
            subtopic_row = get_subtopic(topic_row["id"], subtopic_slug)

            if subtopic_row is None:
                print(f"  !! subtopic '{subtopic_slug}' not in DB — skipping", flush=True)
                skipped += 1
                continue

            subtopic_id = subtopic_row["id"]
            existing = get_problem_count(subtopic_id)

            if existing >= count and not force:
                print(f"  >> {topic_name} / {sub_name} ({existing} already exist — skip)", flush=True)
                skipped += 1
                continue

            items.append({
                "topic_name": topic_name,
                "sub_name": sub_name,
                "subject": subject,
                "subtopic_id": subtopic_id,
                "topic_slug": topic_row["slug"],
                "subtopic_slug": subtopic_row["slug"],
                "existing": existing,
            })

    return items, skipped


async def _seed_subtopic(item: dict, count: int) -> int:
    """Generate source='cpa' problems for one subtopic and upsert them."""
    buckets = _bucket_difficulties(count)
    sem = asyncio.Semaphore(BATCH_CONCURRENCY)

    async def run_batch(
        difficulty: str, batch_num: int, batch_size: int, order_start: int
    ) -> list[dict]:
        async with sem:
            return await generate_cpa_problems_batch(
                subtopic_name=item["sub_name"],
                topic_name=item["topic_name"],
                subtopic_id=item["subtopic_id"],
                batch_number=batch_num,
                difficulty=difficulty,
                batch_size=batch_size,
                start_order_index=order_start,
                subject=item["subject"],
            )

    tasks: list[asyncio.Task] = []
    global_offset = 0

    for difficulty, bucket_count in buckets.items():
        if bucket_count <= 0:
            continue
        num_batches = math.ceil(bucket_count / BATCH_SIZE)
        diff_offset = global_offset
        for batch_num in range(num_batches):
            already = batch_num * BATCH_SIZE
            remaining = bucket_count - already
            this_batch = min(BATCH_SIZE, remaining)
            task = asyncio.create_task(
                run_batch(difficulty, batch_num, this_batch, diff_offset + already)
            )
            tasks.append(task)
        global_offset += bucket_count

    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_problems: list[dict] = []
    for result in results:
        if isinstance(result, Exception):
            print(f"    !! batch failed: {result}", flush=True)
        else:
            all_problems.extend(result)

    for p in all_problems:
        p["subtopic_id"] = item["subtopic_id"]
        p["topic_slug"] = item["topic_slug"]
        p["subtopic_slug"] = item["subtopic_slug"]
        p["difficulty_level"] = DIFFICULTY_LEVELS.get(p.get("difficulty", "medium"), 5)

    save_problems(all_problems)  # upserts with source='cpa'
    return len(all_problems)


async def seed_act_question_bank(
    subject: str = "all",
    count: int = PROBLEMS_PER_SUBTOPIC,
    force: bool = False,
    parallelism: int = SUBTOPIC_CONCURRENCY,
) -> dict:
    """Seed source='cpa' problems for all subtopics in the given section(s)."""
    if subject == "all":
        content_maps = [(s, cfg["content_map"]) for s, cfg in SUBJECT_CONFIGS.items()]
    else:
        config = SUBJECT_CONFIGS.get(subject)
        if config is None:
            raise ValueError(
                f"Unknown CPA section '{subject}'. Choose: {', '.join(SUBJECT_CONFIGS)}, all"
            )
        content_maps = [(subject, config["content_map"])]

    stats = {"seeded": 0, "skipped": 0, "failed": 0, "combinations": 0}

    for subj, content_map in content_maps:
        print(f"\n  [{subj.upper()}] Ensuring DB records...", flush=True)
        _ensure_topic_and_subtopics(content_map, subj)

        print(f"  [{subj.upper()}] Resolving subtopics...", flush=True)
        items, skipped = _resolve_subtopics(content_map, subj, count, force)
        stats["skipped"] += skipped
        stats["combinations"] += len(items) + skipped

        if not items:
            print(f"  [{subj.upper()}] All subtopics seeded — use --force to regenerate.", flush=True)
            continue

        print(f"  [{subj.upper()}] Seeding {len(items)} subtopics × {count} problems...", flush=True)
        sem = asyncio.Semaphore(parallelism)

        async def seed_one(item: dict) -> int:
            async with sem:
                id_short = item["subtopic_id"][:8]
                print(
                    f"  > {item['topic_name']} / {item['sub_name']} [{id_short}...]",
                    flush=True,
                )
                t0 = time.time()
                n = await _seed_subtopic(item, count)
                elapsed = int(time.time() - t0)
                print(f"  + {item['sub_name']} — {n} problems ({elapsed}s)", flush=True)
                return n

        task_list = [asyncio.create_task(seed_one(item)) for item in items]
        results = await asyncio.gather(*task_list, return_exceptions=True)

        for item, result in zip(items, results):
            if isinstance(result, Exception):
                print(f"  !! {item['sub_name']}: {result}", flush=True)
                stats["failed"] += 1
            else:
                stats["seeded"] += result

    return stats
