-- CPA schema migration (ACT era -> CPA)
-- See CPA_MIGRATION_PLAN.md for the full spec/rationale.
-- All target tables verified empty (0 rows) on the CPA project before this ran.

BEGIN;

-- Section 1: new enum for CPA sections
CREATE TYPE cpa_section AS ENUM ('AUD', 'FAR', 'REG', 'BAR', 'ISC', 'TCP');

-- Section 2: enum value renames
ALTER TYPE problem_source RENAME VALUE 'act' TO 'cpa';
ALTER TYPE problem_source RENAME VALUE 'full_act' TO 'full_cpa';
ALTER TYPE session_source RENAME VALUE 'act' TO 'cpa';
ALTER TYPE session_source RENAME VALUE 'full_act' TO 'full_cpa';

-- Section 3: table renames
ALTER TABLE full_act_tests RENAME TO cpa_section_exams;
ALTER TABLE full_act_test_problems RENAME TO cpa_section_exam_problems;
ALTER TABLE full_act_attempts RENAME TO cpa_section_exam_attempts;
ALTER TABLE full_act_answers RENAME TO cpa_section_exam_answers;

-- cpa_section_exams: one exam form = one section (was: one form spanning all 4 ACT sections)
ALTER TABLE cpa_section_exams ADD COLUMN section cpa_section NOT NULL;

-- cpa_section_exam_problems: drop redundant 'section' text column (implied by parent exam now)
ALTER TABLE cpa_section_exam_problems DROP COLUMN section;
ALTER TABLE cpa_section_exam_problems ADD CONSTRAINT cpa_section_exam_problems_unique UNIQUE (test_id, module, order_index);
CREATE INDEX idx_cpa_section_exam_problems_test_module ON cpa_section_exam_problems (test_id, module);

-- cpa_section_exam_attempts: drop ACT composite/per-section columns, add CPA pass/fail columns
ALTER TABLE cpa_section_exam_attempts
  DROP COLUMN english_raw_score,
  DROP COLUMN english_scaled_score,
  DROP COLUMN math_raw_score,
  DROP COLUMN math_scaled_score,
  DROP COLUMN reading_raw_score,
  DROP COLUMN reading_scaled_score,
  DROP COLUMN science_raw_score,
  DROP COLUMN science_scaled_score,
  DROP COLUMN composite_score,
  DROP COLUMN english_module1_correct,
  DROP COLUMN math_module1_correct,
  DROP COLUMN english_time_seconds,
  DROP COLUMN math_time_seconds,
  DROP COLUMN current_section;

ALTER TABLE cpa_section_exam_attempts ADD COLUMN section cpa_section NOT NULL;
ALTER TABLE cpa_section_exam_attempts ADD COLUMN raw_score integer;
ALTER TABLE cpa_section_exam_attempts ADD COLUMN scaled_score integer CHECK (scaled_score BETWEEN 0 AND 99);
ALTER TABLE cpa_section_exam_attempts ADD COLUMN passed boolean GENERATED ALWAYS AS (scaled_score >= 75) STORED;

-- cpa_section_exam_answers: drop redundant 'section' text column
ALTER TABLE cpa_section_exam_answers DROP COLUMN section;
ALTER TABLE cpa_section_exam_answers ADD CONSTRAINT cpa_section_exam_answers_attempt_order UNIQUE (attempt_id, module, order_index);

-- Section 4: users table — drop ACT 1-36 scoring columns, add CPA goal-setting column
ALTER TABLE users
  DROP COLUMN start_composite,
  DROP COLUMN current_composite,
  DROP COLUMN current_english,
  DROP COLUMN current_reading,
  DROP COLUMN current_science,
  DROP COLUMN current_math,
  DROP COLUMN target_score;

ALTER TABLE users ADD COLUMN target_discipline_section cpa_section;

-- Section 5: new per-section pass/fail progress table (replaces composite-score concept)
CREATE TABLE user_cpa_section_progress (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section cpa_section NOT NULL,
  best_scaled_score integer CHECK (best_scaled_score BETWEEN 0 AND 99),
  passed boolean NOT NULL DEFAULT false,
  passed_at timestamptz,
  attempts_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, section)
);

ALTER TABLE user_cpa_section_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own section progress" ON user_cpa_section_progress
  FOR SELECT USING ((auth.uid())::text = (user_id)::text);
CREATE POLICY "Users can insert own section progress" ON user_cpa_section_progress
  FOR INSERT WITH CHECK ((auth.uid())::text = (user_id)::text);
CREATE POLICY "Users can update own section progress" ON user_cpa_section_progress
  FOR UPDATE USING ((auth.uid())::text = (user_id)::text);

-- Section 6: column renames
ALTER TABLE topics RENAME COLUMN act_relevance TO cpa_relevance;
ALTER TABLE problems RENAME COLUMN act_frequency TO cpa_frequency;

-- Section 7: subsection_skills section_category values
ALTER TABLE subsection_skills DROP CONSTRAINT subsection_skills_section_category_check;
ALTER TABLE subsection_skills ADD CONSTRAINT subsection_skills_section_category_check
  CHECK (section_category = ANY (ARRAY['AUD', 'FAR', 'REG', 'BAR', 'ISC', 'TCP']));

-- Section 8: rename remaining indexes for consistency (cosmetic, no functional effect)
ALTER INDEX idx_full_act_answers_attempt RENAME TO idx_cpa_section_exam_answers_attempt;
ALTER INDEX idx_full_act_attempts_user RENAME TO idx_cpa_section_exam_attempts_user;
ALTER INDEX idx_full_act_attempts_user_status RENAME TO idx_cpa_section_exam_attempts_user_status;
ALTER INDEX idx_full_act_attempts_user_completed RENAME TO idx_cpa_section_exam_attempts_user_completed;
ALTER INDEX idx_fat_problems_test RENAME TO idx_cpa_section_exam_problems_test;

COMMIT;
