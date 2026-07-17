# CPA Migration Plan — Schema Checklist (Day 2 Execution Guide)

> Modeled on the previous SAT→ACT schema checklist (`SAT_TO_ACT_MIGRATION_PLAN.md`... currently still named `ACT_MIGRATION_PLAN.md`). Unlike that migration, this one is a **structural** change, not just a rename — the CPA exam has no combined test and no composite score, so the "full-length test spanning 4 sections" shape doesn't carry over. All target tables currently have 0 rows in the new CPA database (verified 2026-07-01), so this is written as a clean rebuild rather than a data-preserving migration.

---

## Key structural differences from ACT (why this isn't just a rename)

| ACT | CPA |
|---|---|
| One combined test, 4 fixed sections in one sitting | 4 independent, separately-scheduled exams |
| Composite score (avg of 4 sections, 1-36) | No composite — each section pass/fail independently |
| Sections: English, Math, Reading, Science (all required) | Core: AUD, FAR, REG (all required) + 1 of 3 disciplines: BAR, ISC, TCP (candidate picks) |
| Section score: 1-36 scaled | Section score: 0-99 scaled, passing = 75 |

---

## Section 1 — New Enum

1. `CREATE TYPE cpa_section AS ENUM ('AUD', 'FAR', 'REG', 'BAR', 'ISC', 'TCP')`

## Section 2 — Enum Value Renames

2. `problem_source` enum: rename value `'act'` → `'cpa'`
3. `problem_source` enum: rename value `'full_act'` → `'full_cpa'`
4. `session_source` enum: rename value `'act'` → `'cpa'`
5. `session_source` enum: rename value `'full_act'` → `'full_cpa'`

## Section 3 — Table Renames + Structural Rebuild

6. `full_act_tests` → `cpa_section_exams`
   - ADD `section cpa_section NOT NULL` (one exam form = one section, not 4 combined)
7. `full_act_test_problems` → `cpa_section_exam_problems`
   - Structure otherwise unchanged (problem_id, module, order_index, etc.)
8. `full_act_attempts` → `cpa_section_exam_attempts`
   - DROP `english_raw_score`, `english_scaled_score`, `math_raw_score`, `math_scaled_score`, `reading_raw_score`, `reading_scaled_score`, `science_raw_score`, `science_scaled_score`, `composite_score`, `english_module1_correct`, `math_module1_correct`, `english_time_seconds`, `math_time_seconds`, `reading_time_seconds`, `science_time_seconds`
   - ADD `section cpa_section NOT NULL` (attempt is for ONE section)
   - ADD `raw_score integer`
   - ADD `scaled_score integer` (0-99)
   - ADD `passed boolean GENERATED ALWAYS AS (scaled_score >= 75) STORED`
   - `total_time_seconds` stays as-is
   - DROP `current_section` (redundant — attempt already has one `section`)
9. `full_act_answers` → `cpa_section_exam_answers`
   - DROP `section` column (redundant — derivable via attempt, which is single-section now)

## Section 4 — `users` Table Changes

10. DROP `start_composite`, `current_composite`, `current_english`, `current_reading`, `current_science` (ACT 1-36 scale, meaningless for CPA)
11. `current_math` → repurpose as generic; actually DROP too — CPA has no cross-exam "current score" concept, replaced by Section 5's per-section progress table
12. DROP `target_score` (and its 1-36 CHECK) — CPA has no analogous single target score
13. ADD `target_discipline_section cpa_section` (nullable) — which discipline (BAR/ISC/TCP) the candidate is preparing for; this is the CPA analogue of ACT's "set a target score" onboarding goal

## Section 5 — New Table: Per-Section Progress

14. `CREATE TABLE user_cpa_section_progress`:
    - `user_id` (FK → users)
    - `section cpa_section NOT NULL`
    - `best_scaled_score integer CHECK (best_scaled_score BETWEEN 0 AND 99)`
    - `passed boolean NOT NULL DEFAULT false`
    - `passed_at timestamptz`
    - `attempts_count integer NOT NULL DEFAULT 0`
    - `last_attempt_at timestamptz`
    - `updated_at timestamptz NOT NULL DEFAULT now()`
    - PRIMARY KEY (`user_id`, `section`)

## Section 6 — Column Renames Elsewhere

15. `topics.act_relevance` (jsonb) → `cpa_relevance`
16. `problems.act_frequency` (text) → `cpa_frequency`

## Section 7 — CHECK Constraint Value Changes

17. `subsection_skills.section_category` CHECK:
    - FROM: `IN ('English', 'Math', 'Reading', 'Science')`
    - TO: `IN ('AUD', 'FAR', 'REG', 'BAR', 'ISC', 'TCP')`

## Section 8 — Indexes, Constraints, RLS

18. Rename all `idx_full_act_*` → `idx_cpa_section_exam_*`
19. Rename unique constraints `full_act_test_problems_unique` → `cpa_section_exam_problems_unique`, `full_act_answers_attempt_order` → `cpa_section_exam_answers_attempt_order`
20. Drop + recreate RLS policies on renamed tables (same policy logic, new table names)

## What Is NOT Changing (confirmed safe to leave)

- `users.total_xp`, `users.skill_score` — exam-agnostic
- `subsection_skills` table structure (except `section_category` values, item 17)
- `daily_quests`, `daily_quest_problems` — no exam-specific columns
- `quiz_sessions.score` / `quiz_answers` — percentage-based (0-100), not exam-scaled
- `problems.difficulty_level` (1-10 scale) — exam-agnostic
- All auth, scheduling, onboarding, friendship, subscription, push notification tables

## Execution Order

1. Section 1 (new enum — needed before columns can use it)
2. Section 2 (enum value renames)
3. Section 3 (table renames + rebuild — all tables empty, no data migration needed)
4. Section 4 + 5 (users table changes + new progress table)
5. Section 6 (column renames)
6. Section 7 (constraint value changes)
7. Section 8 (indexes/constraints/RLS)
