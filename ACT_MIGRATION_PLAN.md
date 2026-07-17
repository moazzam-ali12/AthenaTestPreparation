# ACT Migration Plan — Schema Checklist (Day 2 Execution Guide)

> **Rules:** Run as a single new Supabase migration file. No SQL here — this is the spec only.
> Every item is confirmed against the live schema produced by all 21 existing migrations.

---

## Section 1 — Enum Value Renames

1. `problem_source` enum: rename value `'sat'` → `'act'`
2. `problem_source` enum: rename value `'full_sat'` → `'full_act'`
3. `session_source` enum: rename value `'sat'` → `'act'`
4. `session_source` enum: rename value `'full_sat'` → `'full_act'`

> PostgreSQL does not support renaming enum values directly before v15.
> Strategy: add new values, migrate data, drop old values (or recreate the type).

---

## Section 2 — Table Renames

5. `full_sat_tests` → `full_act_tests`
6. `full_sat_test_problems` → `full_act_test_problems`
7. `full_sat_attempts` → `full_act_attempts`
8. `full_sat_answers` → `full_act_answers`

---

## Section 3 — Column Renames

### `topics` table
9. `sat_relevance` (jsonb) → `act_relevance`

### `problems` table
10. `sat_frequency` (text) → `act_frequency`

### `users` table
11. `current_reading_writing` (integer) → split into three new columns:
    - ADD `current_english integer`
    - ADD `current_reading integer`
    - ADD `current_science integer`
    - Migrate existing `current_reading_writing` values into `current_english` (closest equivalent)
    - DROP `current_reading_writing`
    > ACT has 4 scored sections vs SAT's 2. `current_math` stays as-is.

### `full_act_attempts` table (after rename in Section 2)
12. `rw_raw_score` → `english_raw_score`
13. `rw_scaled_score` → `english_scaled_score`
14. `rw_module1_correct` → `english_module1_correct`
15. `rw_time_seconds` → `english_time_seconds`
16. ADD `reading_raw_score integer`
17. ADD `reading_scaled_score integer`
18. ADD `science_raw_score integer`
19. ADD `science_scaled_score integer`
20. `total_score` → `composite_score`
    > ACT composite is the average of all 4 section scores (1–36 each), rounded to nearest integer.

---

## Section 4 — Score Range Constraints (SAT 200–800 / 1600 → ACT 1–36)

21. `users.target_score`: no current CHECK constraint — add `CHECK (target_score >= 1 AND target_score <= 36)`
22. `users.start_composite`: no current CHECK — add `CHECK (start_composite >= 1 AND start_composite <= 36)`
23. `users.current_composite`: no current CHECK — add `CHECK (current_composite >= 1 AND current_composite <= 36)`
24. `users.current_english`: new column — add `CHECK (current_english >= 1 AND current_english <= 36)`
25. `users.current_math`: existing column — add `CHECK (current_math >= 1 AND current_math <= 36)`
26. `users.current_reading`: new column — add `CHECK (current_reading >= 1 AND current_reading <= 36)`
27. `users.current_science`: new column — add `CHECK (current_science >= 1 AND current_science <= 36)`
28. `full_act_attempts.english_scaled_score`: add `CHECK (english_scaled_score >= 1 AND english_scaled_score <= 36)`
29. `full_act_attempts.math_scaled_score`: add `CHECK (math_scaled_score >= 1 AND math_scaled_score <= 36)`
30. `full_act_attempts.reading_scaled_score`: add `CHECK (reading_scaled_score >= 1 AND reading_scaled_score <= 36)`
31. `full_act_attempts.science_scaled_score`: add `CHECK (science_scaled_score >= 1 AND science_scaled_score <= 36)`
32. `full_act_attempts.composite_score`: add `CHECK (composite_score >= 1 AND composite_score <= 36)`

---

## Section 5 — CHECK Constraint Value Changes (Section Names)

33. `full_act_attempts.current_section` CHECK:
    - FROM: `IN ('reading_writing', 'math')`
    - TO:   `IN ('english', 'math', 'reading', 'science')`

34. `full_act_test_problems.section` CHECK:
    - FROM: `IN ('reading_writing', 'math')`
    - TO:   `IN ('english', 'math', 'reading', 'science')`

35. `full_act_answers.section` CHECK:
    - FROM: `IN ('reading_writing', 'math')`
    - TO:   `IN ('english', 'math', 'reading', 'science')`

36. `subsection_skills.section_category` CHECK:
    - FROM: `IN ('ReadingWriting', 'Math')`
    - TO:   `IN ('English', 'Math', 'Reading', 'Science')`

---

## Section 6 — Data Migrations (UPDATE statements)

37. `UPDATE problems SET source = 'act' WHERE source = 'sat'`
38. `UPDATE problems SET source = 'full_act' WHERE source = 'full_sat'`
39. `UPDATE quiz_sessions SET source = 'act' WHERE source = 'sat'`
40. `UPDATE quiz_sessions SET source = 'full_act' WHERE source = 'full_sat'`
41. `UPDATE full_act_attempts SET current_section = 'english' WHERE current_section = 'reading_writing'`
    > 'reading_writing' no longer valid after constraint change; migrate before applying new CHECK.

---

## Section 7 — Index Renames

42. `idx_full_sat_attempts_user` → `idx_full_act_attempts_user`
43. `idx_full_sat_attempts_user_status` → `idx_full_act_attempts_user_status`
44. `idx_full_sat_attempts_user_completed` → `idx_full_act_attempts_user_completed`
45. `idx_full_sat_answers_attempt` → `idx_full_act_answers_attempt`
46. `idx_fst_problems_test` → `idx_fat_problems_test`
47. `idx_fst_problems_test_section` → `idx_fat_problems_test_section`
48. `idx_problems_sat_subtopic_order` (unique partial index) → `idx_problems_act_subtopic_order`

---

## Section 8 — Constraint Renames

49. `full_sat_test_problems_unique` → `full_act_test_problems_unique`
    (UNIQUE on `test_id, section, module, order_index`)
50. `full_sat_answers_attempt_order` → `full_act_answers_attempt_order`
    (UNIQUE on `attempt_id, section, module, order_index`)

---

## Section 9 — RLS Policy Recreation

All policies are tied to table names, so they must be dropped and recreated after table renames.

51. DROP + recreate `"Anyone can read active tests"` → on `full_act_tests`
52. DROP + recreate `"Anyone can read test problems"` → on `full_act_test_problems`
53. DROP + recreate `"Users can read own attempts"` → on `full_act_attempts`
54. DROP + recreate `"Users can insert own attempts"` → on `full_act_attempts`
55. DROP + recreate `"Users can update own attempts"` → on `full_act_attempts`
56. DROP + recreate `"Users can read own answers"` → on `full_act_answers`
    (subquery references `full_act_attempts`)
57. DROP + recreate `"Users can insert own answers"` → on `full_act_answers`
58. DROP + recreate `"Users can update own answers"` → on `full_act_answers`

---

## Section 10 — Foreign Key Updates

Foreign keys on renamed tables are automatically preserved by `ALTER TABLE ... RENAME`.
However these implicit FKs reference the old table name in their constraint names — rename for clarity:

59. `full_sat_test_problems.test_id` FK → rename constraint to `full_act_test_problems_test_id_fk`
60. `full_sat_test_problems.problem_id` FK → rename constraint to `full_act_test_problems_problem_id_fk`
61. `full_sat_attempts.user_id` FK → rename constraint to `full_act_attempts_user_id_fk`
62. `full_sat_attempts.test_id` FK → rename constraint to `full_act_attempts_test_id_fk`
63. `full_sat_answers.attempt_id` FK → rename constraint to `full_act_answers_attempt_id_fk`
64. `full_sat_answers.problem_id` FK → rename constraint to `full_act_answers_problem_id_fk`

---

## Execution Order for Day 2

Run items in this sequence to avoid FK/constraint conflicts:

1. Sections 6 (data migrations — before enum/constraint changes)
2. Section 1 (enum renames — unblock value changes)
3. Section 2 (table renames)
4. Section 9 (RLS — must drop before column/constraint changes on those tables)
5. Sections 3, 4, 5 (column renames + score constraints + section name constraints)
6. Section 7 (index renames)
7. Section 8 (constraint renames)
8. Section 10 (FK constraint renames)

---

## What Is NOT Changing (confirmed safe to leave)

- `users.total_xp`, `users.skill_score` — exam-agnostic
- `subsection_skills` table structure (except `section_category` values, item 36)
- `daily_quests`, `daily_quest_problems` — no SAT-specific columns
- `quiz_sessions.score` / `quiz_answers` — percentage-based (0–100), not SAT-scaled
- `problems.difficulty_level` (1–10 scale) — exam-agnostic
- All auth, scheduling, onboarding, friendship tables
