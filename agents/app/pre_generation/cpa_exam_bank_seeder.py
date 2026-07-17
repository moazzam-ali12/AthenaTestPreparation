"""
CPA Section Exam Bank Seeder — generates problems for every subtopic across
all 6 CPA Exam sections (AUD, FAR, REG, BAR, ISC, TCP), tagged source='full_cpa'.

These are the larger, section-scoped exam-bank problems used to assemble full
practice exam forms (see cpa_section_exam_assembler.py). Distinct from the
smaller per-topic question bank seeded by seed_act_question_bank.py.

Creates topic and subtopic rows in the DB if they don't already exist, reusing
the same content maps (and the same `_make_slug`) as the core content
generation workflow so topic/subtopic rows line up exactly.

Usage:
    cd agents && python -m cli.main seed-cpa-exam-bank
    cd agents && python -m cli.main seed-cpa-exam-bank --section all --count 50
    cd agents && python -m cli.main seed-cpa-exam-bank --section far --count 30
"""

import asyncio
import math
import time

from app.pre_generation.cpa_problem_generator import generate_cpa_problems_batch, CPA_SUBJECT_LABELS, BATCH_SIZE
from app.pre_generation.content_workflow import SUBJECT_CONFIGS, _make_slug
from app.utils.db import (
    get_topic_by_slug,
    get_subtopic,
    upsert_topic,
    upsert_subtopic,
    get_full_cpa_problem_count,
    save_full_cpa_problems,
    delete_full_cpa_problems,
)

# Target problems per subtopic
PROBLEMS_PER_SUBTOPIC = 50

SUBTOPIC_CONCURRENCY = 3
BATCH_CONCURRENCY = 6

DIFFICULTY_LEVELS = {
    "easy": 3,
    "medium": 5,
    "hard": 8,
}


def _ensure_topic_and_subtopics(content_map: dict, subject: str) -> None:
    """Create missing topics and subtopics in the DB for a CPA section."""
    subject_label = CPA_SUBJECT_LABELS.get(subject, subject.upper())

    for topic_name, meta in content_map.items():
        topic_slug = _make_slug(topic_name)
        topic_row = get_topic_by_slug(topic_slug)

        if topic_row is None:
            print(f"  + creating topic: {topic_name}", flush=True)
            topic_row = upsert_topic({
                "name": topic_name,
                "slug": topic_slug,
                "subject": subject,
                "order_index": meta["order"],
                "icon": meta["icon"],
                "color_scheme": meta["color"],
                "overview": f"{subject_label} - {topic_name}",
                "estimated_total_minutes": 60,
                "cpa_relevance": {"description": f"Tested on the CPA Exam {subject.upper()} section"},
                "difficulty_distribution": {"easy": 33, "medium": 34, "hard": 33},
                "key_concepts": [],
                "learning_objectives": [],
                "prerequisites": [],
                "pro_tips": [],
            })

        for i, sub_name in enumerate(meta["subtopics"]):
            subtopic_slug = _make_slug(sub_name)
            subtopic_row = get_subtopic(topic_row["id"], subtopic_slug)
            if subtopic_row is None:
                print(f"    + creating subtopic: {sub_name}", flush=True)
                upsert_subtopic({
                    "name": sub_name,
                    "slug": subtopic_slug,
                    "topic_id": topic_row["id"],
                    "order_index": i,
                    "difficulty": "medium",
                    "description": f"{sub_name} — {subject_label} subtopic",
                    "estimated_minutes": 30,
                    "learning_objectives": [],
                    "key_formulas": [],
                    "common_mistakes": [],
                    "tips_and_tricks": [],
                    "conceptual_overview": {},
                    "prerequisite_subtopic_slugs": [],
                })


def _resolve_subtopics(content_map: dict, subject: str, count: int, force: bool) -> tuple[list[dict], int]:
    """
    Resolve all subtopics from the content map, looking up their DB IDs.
    Skips subtopics that already have enough full_cpa problems unless force=True.
    """
    items = []
    skipped = 0

    for topic_name, meta in content_map.items():
        topic_slug = _make_slug(topic_name)
        topic_row = get_topic_by_slug(topic_slug)

        if topic_row is None:
            print(f"  !! topic '{topic_slug}' not in DB — run with --ensure-topics first")
            skipped += len(meta["subtopics"])
            continue

        for sub_name in meta["subtopics"]:
            subtopic_slug = _make_slug(sub_name)
            subtopic_row = get_subtopic(topic_row["id"], subtopic_slug)

            if subtopic_row is None:
                print(f"  !! subtopic '{subtopic_slug}' not in DB — skipping")
                skipped += 1
                continue

            subtopic_id = subtopic_row["id"]
            existing = get_full_cpa_problem_count(subtopic_id)

            if existing >= count and not force:
                print(f"  >> {topic_name} / {sub_name} ({existing} already exist)")
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


async def _seed_subtopic(item: dict, count: int, force: bool = False) -> int:
    """Generate and save full_cpa problems for a single subtopic."""
    if force:
        delete_full_cpa_problems(item["subtopic_id"])
    per_difficulty = count // 3
    remainders = count % 3
    buckets = {
        "easy": per_difficulty + (1 if remainders > 0 else 0),
        "medium": per_difficulty + (1 if remainders > 1 else 0),
        "hard": per_difficulty,
    }

    sem = asyncio.Semaphore(BATCH_CONCURRENCY)

    async def run_batch(difficulty: str, batch_num: int, batch_size: int, order_start: int) -> list[dict]:
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

    save_full_cpa_problems(all_problems)
    return len(all_problems)


async def seed_cpa_exam_bank(
    section: str = "far",
    count: int = PROBLEMS_PER_SUBTOPIC,
    force: bool = False,
    parallelism: int = SUBTOPIC_CONCURRENCY,
) -> dict:
    """Seed full_cpa exam-bank problems for all subtopics in the given section(s)."""
    if section == "all":
        content_maps = [(s, cfg["content_map"]) for s, cfg in SUBJECT_CONFIGS.items()]
    else:
        config = SUBJECT_CONFIGS.get(section)
        if config is None:
            raise ValueError(f"Unknown CPA section: {section}. Choose from: {', '.join(SUBJECT_CONFIGS)}, all")
        content_maps = [(section, config["content_map"])]

    stats = {"seeded": 0, "skipped": 0, "failed": 0, "combinations": 0}

    for subj, content_map in content_maps:
        print(f"\n  Ensuring DB records for {subj}...", flush=True)
        _ensure_topic_and_subtopics(content_map, subj)

        print(f"  Resolving subtopics for {subj}...", flush=True)
        items, skipped = _resolve_subtopics(content_map, subj, count, force)
        stats["skipped"] += skipped
        stats["combinations"] += len(items) + skipped

        if not items:
            continue

        sem = asyncio.Semaphore(parallelism)

        async def seed_one(item: dict) -> int:
            async with sem:
                id_short = item["subtopic_id"][:8]
                print(
                    f"  > {item['topic_name']} / {item['sub_name']} [{id_short}...] — seeding {count}...",
                    flush=True,
                )
                t0 = time.time()
                n = await _seed_subtopic(item, count, force=force)
                elapsed = int(time.time() - t0)
                print(f"  + {item['sub_name']} — {n} problems in {elapsed}s", flush=True)
                return n

        task_list = [asyncio.create_task(seed_one(item)) for item in items]
        results = await asyncio.gather(*task_list, return_exceptions=True)

        for item, result in zip(items, results):
            if isinstance(result, Exception):
                print(f"  !! {item['sub_name']}: {result}")
                stats["failed"] += 1
            else:
                stats["seeded"] += result

    return stats
