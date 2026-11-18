#!/usr/bin/env python3
"""
Athena CLI — admin/utility commands moved out of the HTTP surface.

Usage:
    python -m cli.main health
    python -m cli.main generate-lesson --question-text "..." --correct-answer "..." --category "..." --explanation "..."
    python -m cli.main seed-practice-problems --topic "..." --subtopic "..." [--subject math] [--count 60] [--subtopic-id ...] [--start-order-index 0]
    python -m cli.main generate-content
    python -m cli.main seed-question-bank [--subject all] [--count 25] [--force]
    python -m cli.main seed-cpa-exam-bank [--section all] [--count 50] [--force]
    python -m cli.main assemble-cpa-section-exam --section aud [--test-number 1]
    python -m cli.main generate-practice --subject aud [--subtopic slug] [--per-subtopic 5] [--dry-run] [--out f.json] [--from-file f.json] [--counts]
    python -m cli.main generate-tbs --subject far [--per-subtopic 1] [--limit-subtopics 4] [--dry-run] [--out f.json] [--from-file f.json]
"""

import argparse
import asyncio
import sys
import time

from dotenv import load_dotenv

# The Windows console defaults to cp1252, which can't encode the emoji in
# progress output; force UTF-8 so the CLI works without PYTHONIOENCODING.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

load_dotenv()


async def cmd_health(args):
    print('{"status": "ok", "service": "athena-agents"}')


async def cmd_generate_lesson(args):
    from app.pre_generation.lesson_generator import generate_lesson

    print("╔══════════════════════════════════════════╗")
    print("║  Athena — Lesson Generator               ║")
    print("╚══════════════════════════════════════════╝")
    print(f"  Category: {args.category}")
    print(f"  Question: {args.question_text[:60]}...")
    print()

    start = time.time()
    try:
        content = await generate_lesson(
            question_text=args.question_text,
            correct_answer=args.correct_answer,
            category=args.category,
            explanation=args.explanation,
        )
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    elapsed = time.time() - start
    print(f"✅ Generated in {elapsed:.1f}s\n")
    print(content)


async def cmd_seed_practice_problems(args):
    from app.pre_generation.practice_problem_seeder import generate_practice_problems

    count = max(50, min(100, args.count))

    print("╔══════════════════════════════════════════╗")
    print("║  Athena — Practice Problem Seeder        ║")
    print("╚══════════════════════════════════════════╝")
    print(f"  Topic:    {args.topic}")
    print(f"  Subtopic: {args.subtopic}")
    print(f"  Subject:  {args.subject}")
    print(f"  Count:    {count}")
    if args.subtopic_id:
        print(f"  ID:       {args.subtopic_id}")
    print()

    start = time.time()
    try:
        problems = await generate_practice_problems(
            topic=args.topic,
            subtopic=args.subtopic,
            subject=args.subject,
            count=count,
            subtopic_id=args.subtopic_id,
            start_order_index=args.start_order_index,
        )
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    elapsed = time.time() - start
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)
    print(f"\n✅ Seeded {len(problems)} problems in {minutes}m {seconds}s")


async def cmd_topup_question_bank(args):
    from app.pre_generation.seed_act_question_bank import topup_question_bank

    print(f"  Topping up question bank: subject={args.subject}, easy>={args.easy}, hard>={args.hard}")
    start = time.time()
    stats = await topup_question_bank(subject=args.subject, easy=args.easy, hard=args.hard)
    elapsed = int(time.time() - start)
    print(
        f"\n✅ {stats['generated']} problems across {stats['subtopics_topped_up']} subtopics "
        f"({stats['failed']} failed) in {elapsed // 60}m {elapsed % 60}s"
    )


async def cmd_generate_tbs(args):
    from app.pre_generation.tbs_generator import generate_tbs

    mode = "DRY RUN (nothing saved)" if args.dry_run else "saving to tbs_tasks"
    print(f"  Generating TBS: subject={args.subject}, per-subtopic={args.per_subtopic}, {mode}")
    start = time.time()
    records = await generate_tbs(
        subject=args.subject,
        per_subtopic=args.per_subtopic,
        limit_subtopics=args.limit_subtopics,
        dry_run=args.dry_run,
        out=args.out,
        from_file=args.from_file,
        verify=not args.no_verify,
    )
    elapsed = int(time.time() - start)
    approved = sum(1 for r in records if r["status"] == "approved")
    print(f"\n✅ {approved}/{len(records)} approved in {elapsed // 60}m {elapsed % 60}s")


async def cmd_generate_practice(args):
    from app.pre_generation.practice_generator import generate_practice, practice_counts

    if not args.counts:
        mode = "DRY RUN (nothing saved)" if args.dry_run else "saving to problems (source='practice')"
        print(f"  Generating practice: subject={args.subject}, per-subtopic={args.per_subtopic}, {mode}")
        start = time.time()
        stats = await generate_practice(
            subject=args.subject,
            per_subtopic=args.per_subtopic,
            subtopic=args.subtopic,
            dry_run=args.dry_run,
            out=args.out,
            from_file=args.from_file,
        )
        elapsed = int(time.time() - start)
        print(f"\n✅ {stats} in {elapsed // 60}m {elapsed % 60}s")

    if args.counts or not args.dry_run:
        print(f"\n  {'Section':<8}{'Subtopics':>10}{'>=' + str(args.per_subtopic):>8}{'Min':>6}{'Total':>7}")
        for section, subs, ok, low, total in practice_counts(args.subject, args.per_subtopic):
            print(f"  {section:<8}{subs:>10}{ok:>8}{low:>6}{total:>7}")


async def cmd_seed_question_bank(args):
    from app.pre_generation.seed_act_question_bank import seed_act_question_bank

    count = max(20, min(50, args.count))

    print("╔══════════════════════════════════════════╗")
    print("║  Athena — CPA Question Bank Seeder       ║")
    print("╚══════════════════════════════════════════╝")
    print(f"  Subject(s): {args.subject}")
    print(f"  Count/subtopic: {count}")
    print(f"  Force re-seed: {args.force}")

    overall_start = time.time()
    try:
        stats = await seed_act_question_bank(
            subject=args.subject,
            count=count,
            force=args.force,
        )
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    elapsed = time.time() - overall_start
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)

    print(f"\n  Done in {minutes}m {seconds}s")
    print(f"  Seeded: {stats['seeded']} | Skipped: {stats['skipped']} | Failed: {stats['failed']}")

    if stats["failed"] > 0:
        sys.exit(1)


async def cmd_seed_cpa_exam_bank(args):
    from app.pre_generation.cpa_exam_bank_seeder import seed_cpa_exam_bank

    count = max(20, min(100, args.count))
    sections = (
        ["aud", "far", "reg", "bar", "isc", "tcp"]
        if args.section == "all"
        else [args.section]
    )

    print("+" + "=" * 44 + "+")
    print("|  Athena — CPA Exam Bank Seeder              |")
    print("+" + "=" * 44 + "+")
    print(f"  Section(s): {args.section}")
    print(f"  Count/subtopic: {count}")
    print(f"  Force re-seed: {args.force}")

    total_stats = {"seeded": 0, "skipped": 0, "failed": 0, "combinations": 0}
    overall_start = time.time()

    for section in sections:
        print(f"\n  === {section.upper()} ===")
        stats = await seed_cpa_exam_bank(
            section=section,
            count=count,
            force=args.force,
        )
        for k in total_stats:
            total_stats[k] += stats[k]

    elapsed = time.time() - overall_start
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)

    print(f"\n  Done in {minutes}m {seconds}s")
    print(f"  Seeded: {total_stats['seeded']} | Skipped: {total_stats['skipped']} | Failed: {total_stats['failed']}")

    if total_stats["failed"] > 0:
        sys.exit(1)


async def cmd_assemble_cpa_section_exam(args):
    from app.pre_generation.cpa_section_exam_assembler import assemble_cpa_section_exam

    print("+" + "=" * 44 + "+")
    print("|  Athena — CPA Section Exam Assembler         |")
    print("+" + "=" * 44 + "+")

    start = time.time()
    try:
        exam = assemble_cpa_section_exam(section=args.section, test_number=args.test_number)
    except Exception as e:
        print(f"\n  Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    elapsed = time.time() - start
    print(f"\n  Assembled exam #{exam['test_number']} ({exam['name']}) in {elapsed:.1f}s")
    print(f"  Exam ID: {exam['id']}")


async def cmd_generate_content(args):
    from app.pre_generation.content_workflow import ContentGenerationWorkflow

    print("╔══════════════════════════════════════════╗")
    print("║  Athena — Content Generation Workflow    ║")
    print("╚══════════════════════════════════════════╝\n")

    subjects = (
        ["aud", "far", "reg", "bar", "isc", "tcp"]
        if args.subject == "all"
        else [args.subject]
    )

    workflow = ContentGenerationWorkflow()
    overall_start = time.time()
    all_stats = {}
    try:
        for subject in subjects:
            print(f"\n  === {subject.upper()} ===")
            all_stats[subject] = await workflow.run_generation(subject)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    elapsed = time.time() - overall_start
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)
    print(f"\n✅ Complete in {minutes}m {seconds}s")
    print(f"   Stats: {all_stats}")


def main():
    parser = argparse.ArgumentParser(prog="athena-cli", description="Athena admin utilities")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # health
    subparsers.add_parser("health", help="Check service status")

    # generate-lesson
    p_lesson = subparsers.add_parser("generate-lesson", help="Generate a lesson for a quiz question")
    p_lesson.add_argument("--question-text", required=True)
    p_lesson.add_argument("--correct-answer", required=True)
    p_lesson.add_argument("--category", required=True)
    p_lesson.add_argument("--explanation", required=True)

    # seed-practice-problems
    p_seed = subparsers.add_parser("seed-practice-problems", help="Seed practice problems into the DB")
    p_seed.add_argument("--topic", required=True)
    p_seed.add_argument("--subtopic", required=True)
    p_seed.add_argument("--subject", default="aud", choices=["aud", "far", "reg", "bar", "isc", "tcp"])
    p_seed.add_argument("--count", type=int, default=60)
    p_seed.add_argument("--subtopic-id", default=None)
    p_seed.add_argument("--start-order-index", type=int, default=0)

    # generate-content
    p_gen = subparsers.add_parser("generate-content", help="Run the full CPA content generation workflow")
    p_gen.add_argument("--subject", default="all", choices=["aud", "far", "reg", "bar", "isc", "tcp", "all"])

    # seed-question-bank
    p_qb = subparsers.add_parser("seed-question-bank", help="Seed the CPA topic question bank (20–30 per subtopic)")
    p_qb.add_argument("--subject", default="all", choices=["aud", "far", "reg", "bar", "isc", "tcp", "all"])
    p_qb.add_argument("--count", type=int, default=25, help="Problems per subtopic (default: 25)")
    p_qb.add_argument("--force", action="store_true", help="Re-seed even if problems exist")

    # topup-question-bank
    p_top = subparsers.add_parser(
        "topup-question-bank",
        help="Generate only the missing easy/hard problems per subtopic (re-runnable)",
    )
    p_top.add_argument("--subject", default="all", choices=["aud", "far", "reg", "bar", "isc", "tcp", "all"])
    p_top.add_argument("--easy", type=int, default=8, help="Minimum easy problems per subtopic (default: 8)")
    p_top.add_argument("--hard", type=int, default=8, help="Minimum hard problems per subtopic (default: 8)")

    # seed-cpa-exam-bank
    p_fact = subparsers.add_parser("seed-cpa-exam-bank", help="Seed the full CPA section exam problem bank")
    p_fact.add_argument("--section", default="far", choices=["aud", "far", "reg", "bar", "isc", "tcp", "all"])
    p_fact.add_argument("--count", type=int, default=50, help="Problems per subtopic (default: 50)")
    p_fact.add_argument("--force", action="store_true", help="Re-seed even if problems exist")

    # assemble-cpa-section-exam
    p_cpa_assemble = subparsers.add_parser("assemble-cpa-section-exam", help="Assemble a CPA section exam form from the exam bank")
    p_cpa_assemble.add_argument("--section", required=True, choices=["aud", "far", "reg", "bar", "isc", "tcp"])
    p_cpa_assemble.add_argument("--test-number", type=int, default=None, help="Exam number within the section (auto-increments if omitted)")

    # generate-tbs
    p_tbs = subparsers.add_parser("generate-tbs", help="Generate Task-Based Simulations (checked + verified)")
    p_tbs.add_argument("--subject", default="all", choices=["aud", "far", "reg", "bar", "isc", "tcp", "all"])
    p_tbs.add_argument("--per-subtopic", type=int, default=1, help="Tasks per subtopic (default: 1)")
    p_tbs.add_argument("--limit-subtopics", type=int, default=None, help="Only N subtopics per section, spread evenly")
    p_tbs.add_argument("--dry-run", action="store_true", help="Generate and check, but don't write to the DB")
    p_tbs.add_argument("--out", default=None, help="Write generated records (incl. answer keys) to this JSON file")
    p_tbs.add_argument("--from-file", default=None, help="Insert records from a previous --out file (no LLM calls)")
    p_tbs.add_argument("--no-verify", action="store_true", help="Skip the independent answer-key check (tasks saved as draft)")

    # generate-practice
    p_prac = subparsers.add_parser(
        "generate-practice",
        help="Generate tutor practice problems (source='practice'): checked + answer-key verified, re-runnable",
    )
    p_prac.add_argument("--subject", default="all", choices=["aud", "far", "reg", "bar", "isc", "tcp", "all"])
    p_prac.add_argument("--per-subtopic", type=int, default=5, help="Target per subtopic (default 5: 2 easy, 2 medium, 1 hard)")
    p_prac.add_argument("--subtopic", default=None, help="Only this subtopic slug")
    p_prac.add_argument("--dry-run", action="store_true", help="Generate and check, but don't write to the DB")
    p_prac.add_argument("--out", default=None, help="Write approved records (incl. answer keys) to this JSON file")
    p_prac.add_argument("--from-file", default=None, help="Insert records from a previous --out file (no LLM calls)")
    p_prac.add_argument("--counts", action="store_true", help="Only print the per-section practice count table")

    args = parser.parse_args()

    dispatch = {
        "health": cmd_health,
        "generate-lesson": cmd_generate_lesson,
        "seed-practice-problems": cmd_seed_practice_problems,
        "generate-content": cmd_generate_content,
        "seed-question-bank": cmd_seed_question_bank,
        "topup-question-bank": cmd_topup_question_bank,
        "seed-cpa-exam-bank": cmd_seed_cpa_exam_bank,
        "assemble-cpa-section-exam": cmd_assemble_cpa_section_exam,
        "generate-tbs": cmd_generate_tbs,
        "generate-practice": cmd_generate_practice,
    }

    asyncio.run(dispatch[args.command](args))


if __name__ == "__main__":
    main()
