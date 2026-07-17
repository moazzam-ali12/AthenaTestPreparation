-- ============================================================
-- ACT Migration — complete schema for remaining migrations + ACT rename
--
-- IMPORTANT: Run in TWO separate executions in Supabase SQL Editor:
--   PART 1: Lines marked [PART 1] — enum ADD VALUE (must commit first)
--   PART 2: Everything else — all table changes + ACT rename
-- ============================================================

-- ============================================================
-- [PART 1] Run this block first, then Run again for PART 2
-- PostgreSQL requires enum ADD VALUE to commit before usage
-- ============================================================

ALTER TYPE problem_source ADD VALUE IF NOT EXISTS 'full_sat';
ALTER TYPE session_source ADD VALUE IF NOT EXISTS 'full_sat';

-- ============================================================
-- STOP HERE. Click Run. Wait for success.
-- Then delete the two lines above and run the rest below.
-- ============================================================

-- ============================================================
-- [PART 2] Subtopic Lore
-- ============================================================

CREATE TABLE IF NOT EXISTS subtopic_lore (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  subtopic_id      uuid NOT NULL,
  whiteboard_steps jsonb DEFAULT '[]'::jsonb NOT NULL,
  status           text DEFAULT 'generating' NOT NULL,
  created_at       timestamptz DEFAULT now() NOT NULL,
  updated_at       timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT subtopic_lore_subtopic_id_unique UNIQUE (subtopic_id)
);

ALTER TABLE subtopic_lore
  DROP CONSTRAINT IF EXISTS subtopic_lore_subtopic_id_subtopics_id_fk;
ALTER TABLE subtopic_lore
  ADD CONSTRAINT subtopic_lore_subtopic_id_subtopics_id_fk
  FOREIGN KEY (subtopic_id) REFERENCES subtopics(id) ON DELETE CASCADE ON UPDATE NO ACTION;

-- ============================================================
-- [PART 2] Full SAT tables
-- ============================================================

ALTER TABLE problems DROP CONSTRAINT IF EXISTS problems_source_linking;
ALTER TABLE problems ADD CONSTRAINT problems_source_linking CHECK (
  CASE source
    WHEN 'sat'        THEN subtopic_id IS NOT NULL
    WHEN 'full_sat'   THEN subtopic_id IS NOT NULL
    WHEN 'practice'   THEN subtopic_id IS NOT NULL
                        OR (topic_slug IS NOT NULL AND subtopic_slug IS NOT NULL)
    WHEN 'custom'     THEN custom_topic_id IS NOT NULL
    WHEN 'onboarding' THEN true
  END
);

CREATE TABLE IF NOT EXISTS full_sat_tests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_number integer NOT NULL UNIQUE,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'retired')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS full_sat_test_problems (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id     uuid NOT NULL REFERENCES full_sat_tests(id) ON DELETE CASCADE,
  problem_id  uuid NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  section     text NOT NULL CHECK (section IN ('reading_writing', 'math')),
  module      integer NOT NULL CHECK (module IN (1, 2)),
  order_index integer NOT NULL,
  CONSTRAINT full_sat_test_problems_unique UNIQUE (test_id, section, module, order_index)
);

CREATE INDEX IF NOT EXISTS idx_fst_problems_test ON full_sat_test_problems(test_id);
CREATE INDEX IF NOT EXISTS idx_fst_problems_test_section ON full_sat_test_problems(test_id, section, module);

CREATE TABLE IF NOT EXISTS full_sat_attempts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_id               uuid NOT NULL REFERENCES full_sat_tests(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  rw_raw_score          integer,
  rw_scaled_score       integer,
  math_raw_score        integer,
  math_scaled_score     integer,
  total_score           integer,
  rw_module1_correct    integer DEFAULT 0,
  math_module1_correct  integer DEFAULT 0,
  rw_time_seconds       integer DEFAULT 0,
  math_time_seconds     integer DEFAULT 0,
  total_time_seconds    integer DEFAULT 0,
  current_section       text DEFAULT 'reading_writing',
  current_module        integer DEFAULT 1,
  current_question      integer DEFAULT 0,
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_full_sat_attempts_user
  ON full_sat_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_full_sat_attempts_user_status
  ON full_sat_attempts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_full_sat_attempts_user_completed
  ON full_sat_attempts(user_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS full_sat_answers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id       uuid NOT NULL REFERENCES full_sat_attempts(id) ON DELETE CASCADE,
  problem_id       uuid NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  section          text NOT NULL CHECK (section IN ('reading_writing', 'math')),
  module           integer NOT NULL CHECK (module IN (1, 2)),
  order_index      integer NOT NULL,
  selected_option  integer,
  is_correct       boolean,
  response_time_ms integer,
  answered_at      timestamptz,
  CONSTRAINT full_sat_answers_attempt_order UNIQUE (attempt_id, section, module, order_index)
);

CREATE INDEX IF NOT EXISTS idx_full_sat_answers_attempt ON full_sat_answers(attempt_id);

ALTER TABLE full_sat_tests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE full_sat_test_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE full_sat_attempts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE full_sat_answers       ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'full_sat_tests' AND policyname = 'Anyone can read active tests') THEN
    CREATE POLICY "Anyone can read active tests" ON full_sat_tests FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'full_sat_test_problems' AND policyname = 'Anyone can read test problems') THEN
    CREATE POLICY "Anyone can read test problems" ON full_sat_test_problems FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'full_sat_attempts' AND policyname = 'Users can read own attempts') THEN
    CREATE POLICY "Users can read own attempts" ON full_sat_attempts FOR SELECT USING (auth.uid()::text = user_id::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'full_sat_attempts' AND policyname = 'Users can insert own attempts') THEN
    CREATE POLICY "Users can insert own attempts" ON full_sat_attempts FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'full_sat_attempts' AND policyname = 'Users can update own attempts') THEN
    CREATE POLICY "Users can update own attempts" ON full_sat_attempts FOR UPDATE USING (auth.uid()::text = user_id::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'full_sat_answers' AND policyname = 'Users can read own answers') THEN
    CREATE POLICY "Users can read own answers" ON full_sat_answers FOR SELECT USING (attempt_id IN (SELECT id FROM full_sat_attempts WHERE user_id::text = auth.uid()::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'full_sat_answers' AND policyname = 'Users can insert own answers') THEN
    CREATE POLICY "Users can insert own answers" ON full_sat_answers FOR INSERT WITH CHECK (attempt_id IN (SELECT id FROM full_sat_attempts WHERE user_id::text = auth.uid()::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'full_sat_answers' AND policyname = 'Users can update own answers') THEN
    CREATE POLICY "Users can update own answers" ON full_sat_answers FOR UPDATE USING (attempt_id IN (SELECT id FROM full_sat_attempts WHERE user_id::text = auth.uid()::text));
  END IF;
END $$;

-- ============================================================
-- [PART 2] Engagement Tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS quiz_question_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  problem_id          uuid NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type          text NOT NULL CHECK (event_type IN (
    'answer_correct', 'answer_wrong', 'hint_shown', 'tutor_entered',
    'tutor_correct', 'practice_started', 'practice_correct', 'practice_exhausted'
  )),
  response_time_ms    integer,
  selected_option     integer,
  wrong_count         integer,
  practice_problem_id uuid REFERENCES problems(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qqe_session     ON quiz_question_events(session_id);
CREATE INDEX IF NOT EXISTS idx_qqe_user        ON quiz_question_events(user_id);
CREATE INDEX IF NOT EXISTS idx_qqe_user_problem ON quiz_question_events(user_id, problem_id);

CREATE TABLE IF NOT EXISTS micro_lesson_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  micro_lesson_id   uuid NOT NULL REFERENCES micro_lessons(id) ON DELETE CASCADE,
  subtopic_id       uuid NOT NULL REFERENCES subtopics(id) ON DELETE CASCADE,
  started_at        timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  duration_seconds  integer DEFAULT 0,
  steps_viewed      integer DEFAULT 0,
  total_steps       integer DEFAULT 0,
  checkins_correct  integer DEFAULT 0,
  checkins_total    integer DEFAULT 0,
  chat_messages     integer DEFAULT 0,
  completed         boolean DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mls_user         ON micro_lesson_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_mls_user_subtopic ON micro_lesson_sessions(user_id, subtopic_id);

ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS wrong_count         integer DEFAULT 0;
ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS hint_used           boolean DEFAULT false;
ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS tutor_used          boolean DEFAULT false;
ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS practice_completed  boolean DEFAULT false;

-- ============================================================
-- [PART 2] Email Notifications
-- ============================================================

ALTER TABLE users    ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sessions_reminder_pending
  ON sessions (scheduled_date, status)
  WHERE reminder_sent_at IS NULL;

-- ============================================================
-- [PART 2] Onboarding Plan Fields
-- ============================================================

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS name             text,
  ADD COLUMN IF NOT EXISTS grade            text,
  ADD COLUMN IF NOT EXISTS learner_types    text[],
  ADD COLUMN IF NOT EXISTS interests        text[],
  ADD COLUMN IF NOT EXISTS struggling_topic text;

ALTER TABLE onboarding_progress ALTER COLUMN current_step SET DEFAULT 'plan';

-- ============================================================
-- [PART 2] ACT Migration — rename all SAT references to ACT
-- ============================================================

ALTER TABLE problems DROP CONSTRAINT IF EXISTS problems_source_linking;
DROP INDEX IF EXISTS idx_problems_sat_subtopic_order;

UPDATE full_sat_attempts
  SET current_section = 'english'
  WHERE current_section = 'reading_writing';

ALTER TYPE problem_source RENAME VALUE 'sat'     TO 'act';
ALTER TYPE problem_source RENAME VALUE 'full_sat' TO 'full_act';
ALTER TYPE session_source RENAME VALUE 'sat'     TO 'act';
ALTER TYPE session_source RENAME VALUE 'full_sat' TO 'full_act';

ALTER TABLE problems ADD CONSTRAINT problems_source_linking CHECK (
  CASE source
    WHEN 'act'        THEN subtopic_id IS NOT NULL
    WHEN 'full_act'   THEN subtopic_id IS NOT NULL
    WHEN 'practice'   THEN subtopic_id IS NOT NULL
                        OR (topic_slug IS NOT NULL AND subtopic_slug IS NOT NULL)
    WHEN 'custom'     THEN custom_topic_id IS NOT NULL
    WHEN 'onboarding' THEN true
  END
);

CREATE UNIQUE INDEX idx_problems_act_subtopic_order
  ON problems(subtopic_id, order_index)
  WHERE source = 'act';

ALTER TABLE full_sat_tests         RENAME TO full_act_tests;
ALTER TABLE full_sat_test_problems RENAME TO full_act_test_problems;
ALTER TABLE full_sat_attempts      RENAME TO full_act_attempts;
ALTER TABLE full_sat_answers       RENAME TO full_act_answers;

DROP POLICY IF EXISTS "Anyone can read active tests"   ON full_act_tests;
DROP POLICY IF EXISTS "Anyone can read test problems"  ON full_act_test_problems;
DROP POLICY IF EXISTS "Users can read own attempts"    ON full_act_attempts;
DROP POLICY IF EXISTS "Users can insert own attempts"  ON full_act_attempts;
DROP POLICY IF EXISTS "Users can update own attempts"  ON full_act_attempts;
DROP POLICY IF EXISTS "Users can read own answers"     ON full_act_answers;
DROP POLICY IF EXISTS "Users can insert own answers"   ON full_act_answers;
DROP POLICY IF EXISTS "Users can update own answers"   ON full_act_answers;

CREATE POLICY "Anyone can read active tests"   ON full_act_tests FOR SELECT USING (true);
CREATE POLICY "Anyone can read test problems"  ON full_act_test_problems FOR SELECT USING (true);
CREATE POLICY "Users can read own attempts"    ON full_act_attempts FOR SELECT USING (auth.uid()::text = user_id::text);
CREATE POLICY "Users can insert own attempts"  ON full_act_attempts FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);
CREATE POLICY "Users can update own attempts"  ON full_act_attempts FOR UPDATE USING (auth.uid()::text = user_id::text);
CREATE POLICY "Users can read own answers"     ON full_act_answers FOR SELECT USING (attempt_id IN (SELECT id FROM full_act_attempts WHERE user_id::text = auth.uid()::text));
CREATE POLICY "Users can insert own answers"   ON full_act_answers FOR INSERT WITH CHECK (attempt_id IN (SELECT id FROM full_act_attempts WHERE user_id::text = auth.uid()::text));
CREATE POLICY "Users can update own answers"   ON full_act_answers FOR UPDATE USING (attempt_id IN (SELECT id FROM full_act_attempts WHERE user_id::text = auth.uid()::text));

ALTER TABLE topics   RENAME COLUMN sat_relevance TO act_relevance;
ALTER TABLE problems RENAME COLUMN sat_frequency  TO act_frequency;

ALTER TABLE users ADD COLUMN IF NOT EXISTS current_english integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_reading integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_science integer;
ALTER TABLE users DROP COLUMN IF EXISTS current_reading_writing;

ALTER TABLE full_act_attempts RENAME COLUMN rw_raw_score       TO english_raw_score;
ALTER TABLE full_act_attempts RENAME COLUMN rw_scaled_score    TO english_scaled_score;
ALTER TABLE full_act_attempts RENAME COLUMN rw_module1_correct TO english_module1_correct;
ALTER TABLE full_act_attempts RENAME COLUMN rw_time_seconds    TO english_time_seconds;
ALTER TABLE full_act_attempts ADD COLUMN IF NOT EXISTS reading_raw_score    integer;
ALTER TABLE full_act_attempts ADD COLUMN IF NOT EXISTS reading_scaled_score integer;
ALTER TABLE full_act_attempts ADD COLUMN IF NOT EXISTS science_raw_score    integer;
ALTER TABLE full_act_attempts ADD COLUMN IF NOT EXISTS science_scaled_score integer;
ALTER TABLE full_act_attempts RENAME COLUMN total_score TO composite_score;

ALTER TABLE users ADD CONSTRAINT users_target_score_range     CHECK (target_score >= 1 AND target_score <= 36);
ALTER TABLE users ADD CONSTRAINT users_start_composite_range  CHECK (start_composite >= 1 AND start_composite <= 36);
ALTER TABLE users ADD CONSTRAINT users_current_composite_range CHECK (current_composite >= 1 AND current_composite <= 36);
ALTER TABLE users ADD CONSTRAINT users_current_english_range  CHECK (current_english >= 1 AND current_english <= 36);
ALTER TABLE users ADD CONSTRAINT users_current_math_range     CHECK (current_math >= 1 AND current_math <= 36);
ALTER TABLE users ADD CONSTRAINT users_current_reading_range  CHECK (current_reading >= 1 AND current_reading <= 36);
ALTER TABLE users ADD CONSTRAINT users_current_science_range  CHECK (current_science >= 1 AND current_science <= 36);

ALTER TABLE full_act_attempts ADD CONSTRAINT full_act_attempts_english_score_range  CHECK (english_scaled_score >= 1 AND english_scaled_score <= 36);
ALTER TABLE full_act_attempts ADD CONSTRAINT full_act_attempts_math_score_range     CHECK (math_scaled_score >= 1 AND math_scaled_score <= 36);
ALTER TABLE full_act_attempts ADD CONSTRAINT full_act_attempts_reading_score_range  CHECK (reading_scaled_score >= 1 AND reading_scaled_score <= 36);
ALTER TABLE full_act_attempts ADD CONSTRAINT full_act_attempts_science_score_range  CHECK (science_scaled_score >= 1 AND science_scaled_score <= 36);
ALTER TABLE full_act_attempts ADD CONSTRAINT full_act_attempts_composite_range      CHECK (composite_score >= 1 AND composite_score <= 36);

ALTER TABLE full_act_attempts ADD CONSTRAINT full_act_attempts_current_section_check
  CHECK (current_section IN ('english', 'math', 'reading', 'science'));

ALTER TABLE full_act_test_problems DROP CONSTRAINT IF EXISTS full_sat_test_problems_section_check;
ALTER TABLE full_act_test_problems ADD CONSTRAINT full_act_test_problems_section_check
  CHECK (section IN ('english', 'math', 'reading', 'science'));

ALTER TABLE full_act_answers DROP CONSTRAINT IF EXISTS full_sat_answers_section_check;
ALTER TABLE full_act_answers ADD CONSTRAINT full_act_answers_section_check
  CHECK (section IN ('english', 'math', 'reading', 'science'));

ALTER TABLE subsection_skills DROP CONSTRAINT IF EXISTS subsection_skills_section_category_check;
ALTER TABLE subsection_skills ADD CONSTRAINT subsection_skills_section_category_check
  CHECK (section_category IN ('English', 'Math', 'Reading', 'Science'));

ALTER INDEX IF EXISTS idx_full_sat_attempts_user          RENAME TO idx_full_act_attempts_user;
ALTER INDEX IF EXISTS idx_full_sat_attempts_user_status   RENAME TO idx_full_act_attempts_user_status;
ALTER INDEX IF EXISTS idx_full_sat_attempts_user_completed RENAME TO idx_full_act_attempts_user_completed;
ALTER INDEX IF EXISTS idx_full_sat_answers_attempt        RENAME TO idx_full_act_answers_attempt;
ALTER INDEX IF EXISTS idx_fst_problems_test               RENAME TO idx_fat_problems_test;
ALTER INDEX IF EXISTS idx_fst_problems_test_section       RENAME TO idx_fat_problems_test_section;

ALTER TABLE full_act_test_problems RENAME CONSTRAINT full_sat_test_problems_unique        TO full_act_test_problems_unique;
ALTER TABLE full_act_answers       RENAME CONSTRAINT full_sat_answers_attempt_order       TO full_act_answers_attempt_order;

ALTER TABLE full_act_test_problems RENAME CONSTRAINT full_sat_test_problems_test_id_fkey    TO full_act_test_problems_test_id_fk;
ALTER TABLE full_act_test_problems RENAME CONSTRAINT full_sat_test_problems_problem_id_fkey TO full_act_test_problems_problem_id_fk;
ALTER TABLE full_act_attempts      RENAME CONSTRAINT full_sat_attempts_user_id_fkey         TO full_act_attempts_user_id_fk;
ALTER TABLE full_act_attempts      RENAME CONSTRAINT full_sat_attempts_test_id_fkey         TO full_act_attempts_test_id_fk;
ALTER TABLE full_act_answers       RENAME CONSTRAINT full_sat_answers_attempt_id_fkey       TO full_act_answers_attempt_id_fk;
ALTER TABLE full_act_answers       RENAME CONSTRAINT full_sat_answers_problem_id_fkey       TO full_act_answers_problem_id_fk;
