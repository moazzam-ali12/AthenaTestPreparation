"""
Supabase persistence layer for content generation workflow.
"""

import os
from supabase import create_client, Client


def get_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


_client: Client | None = None


def client() -> Client:
    global _client
    if _client is None:
        _client = get_client()
    return _client


# ── Queries (for idempotency) ──


def get_topic_by_slug(slug: str) -> dict | None:
    resp = client().table("topics").select("*").eq("slug", slug).execute()
    return resp.data[0] if resp.data else None


def get_subtopic(topic_id: str, slug: str) -> dict | None:
    resp = (
        client()
        .table("subtopics")
        .select("*")
        .eq("topic_id", topic_id)
        .eq("slug", slug)
        .execute()
    )
    return resp.data[0] if resp.data else None


def get_practice_problem_count(topic_slug: str, subtopic_slug: str) -> int:
    resp = (
        client()
        .table("problems")
        .select("id", count="exact")
        .eq("source", "practice")
        .eq("topic_slug", topic_slug)
        .eq("subtopic_slug", subtopic_slug)
        .execute()
    )
    return resp.count or 0


def get_problem_count(subtopic_id: str) -> int:
    resp = (
        client()
        .table("problems")
        .select("id", count="exact")
        .eq("source", "cpa")
        .eq("subtopic_id", subtopic_id)
        .execute()
    )
    return resp.count or 0


# ── Writes ──


def save_topic(topic_data: dict) -> dict:
    """Upsert a topic row. Returns the saved row."""
    resp = (
        client()
        .table("topics")
        .upsert(topic_data, on_conflict="slug")
        .execute()
    )
    return resp.data[0]


def save_subtopic(subtopic_data: dict) -> dict:
    """Upsert a subtopic row. Returns the saved row."""
    resp = (
        client()
        .table("subtopics")
        .upsert(subtopic_data, on_conflict="topic_id,slug")
        .execute()
    )
    return resp.data[0]


def save_problems(problems_list: list[dict]) -> list[dict]:
    """Insert CPA problems. Returns saved rows."""
    if not problems_list:
        return []
    for p in problems_list:
        p.setdefault("source", "cpa")
    resp = (
        client()
        .table("problems")
        .insert(problems_list)
        .execute()
    )
    return resp.data


def save_practice_problems(problems: list[dict]) -> None:
    """Insert practice problems into the problems table."""
    if not problems:
        return
    rows = [
        {
            "source": "practice",
            "subtopic_id": p.get("subtopic_id"),
            "topic_slug": p["topic_slug"],
            "subtopic_slug": p["subtopic_slug"],
            "order_index": p["order_index"],
            "difficulty": p["difficulty"],
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
        }
        for p in problems
    ]
    client().table("problems").insert(rows).execute()


# ── CPA Section Exam Bank ──


def get_full_cpa_problem_count(subtopic_id: str) -> int:
    """Count existing full_cpa (exam-bank) problems for a subtopic."""
    resp = (
        client()
        .table("problems")
        .select("id", count="exact")
        .eq("source", "full_cpa")
        .eq("subtopic_id", subtopic_id)
        .execute()
    )
    return resp.count or 0


def delete_full_cpa_problems(subtopic_id: str) -> None:
    """Delete all full_cpa problems for a subtopic (used before force re-seed)."""
    client().table("problems").delete().eq("source", "full_cpa").eq("subtopic_id", subtopic_id).execute()


def save_full_cpa_problems(problems: list[dict]) -> None:
    """Insert full_cpa (exam-bank) problems into the problems table."""
    if not problems:
        return
    rows = [
        {
            "source": "full_cpa",
            "subtopic_id": p["subtopic_id"],
            "topic_slug": p.get("topic_slug"),
            "subtopic_slug": p.get("subtopic_slug"),
            "order_index": p["order_index"],
            "difficulty": p["difficulty"],
            "difficulty_level": p.get("difficulty_level", 5),
            "question_text": p["question_text"],
            "options": p["options"],
            "correct_option": p["correct_option"],
            "explanation": p["explanation"],
            "solution_steps": p.get("solution_steps", []),
            "concept_tags": p.get("concept_tags", []),
            "common_errors": p.get("common_errors", []),
            "time_recommendation_seconds": p.get("time_recommendation_seconds", 60),
            "cpa_frequency": p.get("cpa_frequency"),
            "hint": p.get("hint", ""),
            "detailed_hint": p.get("detailed_hint", ""),
            "option_hints": p.get("option_hints", []),
        }
        for p in problems
    ]
    client().table("problems").insert(rows).execute()


def get_cpa_section_exams(section: str | None = None) -> list[dict]:
    """Get all cpa_section_exams blueprints, optionally filtered by section."""
    query = client().table("cpa_section_exams").select("*")
    if section:
        query = query.eq("section", section.upper())
    resp = query.order("test_number").execute()
    return resp.data or []


def create_cpa_section_exam(section: str, test_number: int, name: str) -> dict:
    """Create a new CPA section exam blueprint. Returns the saved row."""
    resp = (
        client()
        .table("cpa_section_exams")
        .insert({
            "section": section.upper(),
            "test_number": test_number,
            "name": name,
            "status": "active",
        })
        .execute()
    )
    return resp.data[0]


def add_cpa_section_exam_problems(test_id: str, problems: list[dict]) -> None:
    """Bulk-insert problem mappings for a CPA section exam."""
    if not problems:
        return
    rows = [
        {
            "test_id": test_id,
            "problem_id": p["problem_id"],
            "module": p.get("module", 1),
            "order_index": p["order_index"],
        }
        for p in problems
    ]
    client().table("cpa_section_exam_problems").insert(rows).execute()


def get_used_cpa_section_exam_problem_ids() -> set[str]:
    """Get all problem IDs already assigned to a CPA section exam."""
    resp = (
        client()
        .table("cpa_section_exam_problems")
        .select("problem_id")
        .execute()
    )
    return {row["problem_id"] for row in (resp.data or [])}


def get_cpa_problems_for_subtopic(subtopic_id: str) -> list[dict]:
    """Get all full_cpa problems for a subtopic."""
    resp = (
        client()
        .table("problems")
        .select("id, difficulty, difficulty_level")
        .eq("source", "full_cpa")
        .eq("subtopic_id", subtopic_id)
        .execute()
    )
    return resp.data or []


def upsert_topic(topic_data: dict) -> dict:
    """Upsert a topic row by slug. Returns the saved row."""
    resp = (
        client()
        .table("topics")
        .upsert(topic_data, on_conflict="slug")
        .execute()
    )
    return resp.data[0]


def upsert_subtopic(subtopic_data: dict) -> dict:
    """Upsert a subtopic row by (topic_id, slug). Returns the saved row."""
    resp = (
        client()
        .table("subtopics")
        .upsert(subtopic_data, on_conflict="topic_id,slug")
        .execute()
    )
    return resp.data[0]
