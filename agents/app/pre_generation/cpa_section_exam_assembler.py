"""
CPA Section Exam Assembler — selects problems from the pre-generated full_cpa
exam bank and assembles them into a single section's exam form.

Unlike the old ACT test assembler (which spanned all 4 ACT sections in one
215-question blueprint), each CPA section (AUD, FAR, REG, BAR, ISC, TCP) now
gets its own independent exam form, matching the real CPA Exam's structure of
6 separately-scheduled, separately-scored sections.

Question distribution: rather than hand-authored per-subtopic counts (which
would require real AICPA blueprint weightings this app doesn't have verified
access to), the target total (SECTION_QUESTION_COUNT = 50, see
src/types/cpa-exam.ts) is split as evenly as possible across the section's
topics, then as evenly as possible across each topic's subtopics, with any
remainder distributed to the first few topics/subtopics so the total always
comes out exactly right.

This app only supports MCQ-style problems, so every problem in the assembled
form is placed in a single module (module=1) — this is a practice-exam
simplification, not a simulation of the real CPA Exam's adaptive multi-module
testlet structure.

Usage:
    cd agents && python -m cli.main assemble-cpa-section-exam --section aud
    cd agents && python -m cli.main assemble-cpa-section-exam --section far --test-number 2
"""

import random

from app.pre_generation.content_workflow import SUBJECT_CONFIGS, _make_slug
from app.utils.db import (
    get_topic_by_slug,
    get_subtopic,
    get_cpa_section_exams,
    create_cpa_section_exam,
    add_cpa_section_exam_problems,
    get_used_cpa_section_exam_problem_ids,
    get_cpa_problems_for_subtopic,
)

# Default total questions per section exam form (see SECTION_QUESTION_COUNT
# in src/types/cpa-exam.ts).
DEFAULT_TOTAL_QUESTIONS = 50

EXAM_MODULE = 1


def _split_evenly(total: int, n: int) -> list[int]:
    """Split `total` into `n` non-negative parts as evenly as possible.

    The remainder (total % n) is distributed one-by-one to the first
    `remainder` parts so the parts always sum back to `total`.
    """
    if n <= 0:
        return []
    base, remainder = divmod(total, n)
    return [base + (1 if i < remainder else 0) for i in range(n)]


def _build_distribution(content_map: dict, total: int) -> dict[str, dict[str, int]]:
    """Compute a roughly-even question distribution across a section's
    topics and, within each topic, across its subtopics."""
    topic_names = list(content_map.keys())
    topic_counts = _split_evenly(total, len(topic_names))

    distribution: dict[str, dict[str, int]] = {}
    for topic_name, topic_total in zip(topic_names, topic_counts):
        subtopics = content_map[topic_name]["subtopics"]
        sub_counts = _split_evenly(topic_total, len(subtopics))
        distribution[topic_name] = dict(zip(subtopics, sub_counts))

    return distribution


def _resolve_subtopic_id(topic_name: str, subtopic_name: str) -> str | None:
    """Look up the subtopic ID from the DB."""
    topic_slug = _make_slug(topic_name)
    topic_row = get_topic_by_slug(topic_slug)
    if not topic_row:
        return None
    subtopic_slug = _make_slug(subtopic_name)
    subtopic_row = get_subtopic(topic_row["id"], subtopic_slug)
    return subtopic_row["id"] if subtopic_row else None


def _select_problems(
    subtopic_id: str,
    count: int,
    used_ids: set[str],
) -> list[dict]:
    """Select `count` random unused problems for a subtopic."""
    all_problems = get_cpa_problems_for_subtopic(subtopic_id)
    available = [p for p in all_problems if p["id"] not in used_ids]

    if len(available) < count:
        print(f"    !! Only {len(available)} available (need {count}) for subtopic {subtopic_id[:8]}...")
        count = len(available)

    if count == 0:
        return []

    return random.sample(available, count)


def _assemble_problems(distribution: dict, used_ids: set[str]) -> list[dict]:
    """Collect problems for one CPA section exam according to its distribution."""
    problems: list[dict] = []
    for topic_name, subtopics in distribution.items():
        for subtopic_name, count in subtopics.items():
            if count <= 0:
                continue
            subtopic_id = _resolve_subtopic_id(topic_name, subtopic_name)
            if not subtopic_id:
                print(f"    !! {subtopic_name}: subtopic not found in DB")
                continue

            selected = _select_problems(subtopic_id, count, used_ids)
            for p in selected:
                used_ids.add(p["id"])
            problems.extend(selected)
            print(f"    + {topic_name} / {subtopic_name}: {len(selected)}/{count}")
    return problems


def assemble_cpa_section_exam(
    section: str,
    test_number: int | None = None,
    total_questions: int = DEFAULT_TOTAL_QUESTIONS,
) -> dict:
    """
    Assemble one CPA section's exam form from that section's full_cpa problem bank.

    Returns the created cpa_section_exams record with its ID.
    """
    config = SUBJECT_CONFIGS.get(section)
    if config is None:
        raise ValueError(f"Unknown CPA section: {section}. Choose from: {', '.join(SUBJECT_CONFIGS)}")

    content_map = config["content_map"]
    section_code = section.upper()

    # `cpa_section_exams.test_number` carries a legacy *global* unique constraint
    # (a leftover from the pre-CPA schema, not scoped per section) — so a fresh
    # test_number must be unique across ALL sections, not just this one.
    existing_exams_for_section = get_cpa_section_exams(section=section)
    if test_number is None:
        all_exams = get_cpa_section_exams()
        test_number = max((e["test_number"] for e in all_exams), default=0) + 1

    exam_ordinal = len(existing_exams_for_section) + 1
    name = f"{section_code} Practice Exam {exam_ordinal}"
    print(f"\n  Assembling: {name} (test_number={test_number})")

    distribution = _build_distribution(content_map, total_questions)

    used_ids = get_used_cpa_section_exam_problem_ids()
    print(f"  {len(used_ids)} problems already used across CPA section exams")

    problems = _assemble_problems(distribution, used_ids)
    print(f"\n  Total selected: {len(problems)} / {total_questions}")

    # Create the exam record
    exam = create_cpa_section_exam(section_code, test_number, name)
    exam_id = exam["id"]
    print(f"  Created exam: {exam_id[:8]}...")

    # Build problem mappings (shuffle, then assign order within the single module)
    random.shuffle(problems)
    mappings = [
        {
            "problem_id": p["id"],
            "module": EXAM_MODULE,
            "order_index": i,
        }
        for i, p in enumerate(problems)
    ]

    add_cpa_section_exam_problems(exam_id, mappings)
    print(f"  Assigned {len(mappings)} problems to exam")

    return exam
