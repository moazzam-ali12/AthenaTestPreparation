-- Admin panel: admin flag, question status, audit log, and two read-only
-- aggregate functions for the difficulty-balance page.
--
-- Make someone admin:  UPDATE users SET is_admin = true WHERE lower(email) = lower('<email>');

-- ── Admin flag ─────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Question review status ─────────────────────────────────────────────────
-- Existing rows are live content, so they start as 'approved'. Learner-facing
-- queries serve only approved questions; archived/rejected stay for history
-- (attempts reference them).
ALTER TABLE problems ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'problems_status_check') THEN
    ALTER TABLE problems ADD CONSTRAINT problems_status_check
      CHECK (status IN ('draft', 'approved', 'rejected', 'archived'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS problems_source_status_idx ON problems (source, status);
CREATE INDEX IF NOT EXISTS problems_subtopic_idx ON problems (subtopic_id);

-- ── Audit log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  before      JSONB,
  after       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON admin_audit_log (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log (created_at DESC);

-- Server (service role) only: RLS on, no policies, no client privileges.
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON admin_audit_log FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON admin_audit_log FROM authenticated;
  END IF;
END $$;

-- ── Difficulty balance ─────────────────────────────────────────────────────
-- Approved content per subtopic and kind ('mcq' = cpa + full_cpa, 'practice', 'tbs').
CREATE OR REPLACE FUNCTION admin_difficulty_balance()
RETURNS TABLE (
  section       TEXT,
  topic_name    TEXT,
  subtopic_id   UUID,
  subtopic_name TEXT,
  kind          TEXT,
  easy          BIGINT,
  medium        BIGINT,
  hard          BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH content AS (
    SELECT p.subtopic_id,
           CASE WHEN p.source = 'practice' THEN 'practice' ELSE 'mcq' END AS kind,
           p.difficulty
    FROM problems p
    WHERE p.status = 'approved' AND p.source IN ('cpa', 'full_cpa', 'practice') AND p.subtopic_id IS NOT NULL
    UNION ALL
    SELECT t.subtopic_id, 'tbs', t.difficulty
    FROM tbs_tasks t
    WHERE t.status = 'approved' AND t.subtopic_id IS NOT NULL
  ),
  kinds AS (SELECT unnest(ARRAY['mcq', 'practice', 'tbs']) AS kind)
  SELECT tp.subject, tp.name, s.id, s.name, k.kind,
         COUNT(c.*) FILTER (WHERE c.difficulty = 'easy'),
         COUNT(c.*) FILTER (WHERE c.difficulty = 'medium'),
         COUNT(c.*) FILTER (WHERE c.difficulty = 'hard')
  FROM subtopics s
  JOIN topics tp ON tp.id = s.topic_id
  CROSS JOIN kinds k
  LEFT JOIN content c ON c.subtopic_id = s.id AND c.kind = k.kind
  WHERE tp.subject IN ('aud', 'far', 'reg', 'bar', 'isc', 'tcp')
  GROUP BY tp.subject, tp.order_index, tp.name, s.order_index, s.id, s.name, k.kind
  ORDER BY tp.subject, tp.order_index, s.order_index, k.kind;
$$;

-- ── Per-question accuracy ──────────────────────────────────────────────────
-- Answered attempts across quizzes, practice exams and daily quests. Returns
-- only questions with at least p_min_attempts answers whose accuracy is above
-- p_easy or below p_hard (the flagged ones), most extreme first.
CREATE OR REPLACE FUNCTION admin_question_accuracy(
  p_min_attempts INTEGER DEFAULT 20,
  p_easy NUMERIC DEFAULT 0.95,
  p_hard NUMERIC DEFAULT 0.15,
  p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (
  problem_id    UUID,
  source        TEXT,
  difficulty    TEXT,
  section       TEXT,
  subtopic_name TEXT,
  attempts      BIGINT,
  correct       BIGINT,
  accuracy      NUMERIC,
  flag          TEXT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH answers AS (
    SELECT problem_id, is_correct FROM quiz_answers
    UNION ALL
    SELECT problem_id, is_correct FROM cpa_section_exam_answers WHERE is_correct IS NOT NULL
    UNION ALL
    SELECT problem_id, is_correct FROM daily_quest_problems WHERE is_correct IS NOT NULL
  ),
  stats AS (
    SELECT problem_id, COUNT(*) AS attempts, COUNT(*) FILTER (WHERE is_correct) AS correct
    FROM answers
    GROUP BY problem_id
    HAVING COUNT(*) >= p_min_attempts
  )
  SELECT p.id, p.source::TEXT, p.difficulty, tp.subject, s.name,
         st.attempts, st.correct,
         ROUND(st.correct::NUMERIC / st.attempts, 4) AS accuracy,
         CASE WHEN st.correct::NUMERIC / st.attempts > p_easy THEN 'too_easy' ELSE 'too_hard' END
  FROM stats st
  JOIN problems p ON p.id = st.problem_id
  LEFT JOIN subtopics s ON s.id = p.subtopic_id
  LEFT JOIN topics tp ON tp.id = s.topic_id
  WHERE st.correct::NUMERIC / st.attempts > p_easy OR st.correct::NUMERIC / st.attempts < p_hard
  ORDER BY ABS(st.correct::NUMERIC / st.attempts - 0.5) DESC, st.attempts DESC
  LIMIT p_limit;
$$;

-- Server-only (default privileges from 20261117000000 already lock new
-- functions; repeat explicitly in case this runs elsewhere).
REVOKE EXECUTE ON FUNCTION admin_difficulty_balance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_question_accuracy(INTEGER, NUMERIC, NUMERIC, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_difficulty_balance() TO service_role;
GRANT EXECUTE ON FUNCTION admin_question_accuracy(INTEGER, NUMERIC, NUMERIC, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
