-- Task-Based Simulations (TBS), phase 1: numeric, option-list and journal-entry
-- fields over markdown/table exhibits. Answer keys live in their own table that
-- only the service role can read; the client receives them only after submit.

-- ── Tasks (public definition, no answers) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS tbs_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section      TEXT NOT NULL CHECK (section IN ('aud', 'far', 'reg', 'bar', 'isc', 'tcp')),
  subtopic_id  UUID REFERENCES subtopics(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  difficulty   TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  instructions TEXT NOT NULL,
  -- [{ id, title, kind: 'text'|'table', body?, table?: { columns, rows } }]
  exhibits     JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ id, type: 'numeric'|'option_list'|'journal_entry', label, points, options?/accounts? }]
  fields       JSONB NOT NULL DEFAULT '[]'::jsonb,
  explanation  TEXT NOT NULL DEFAULT '',
  est_minutes  INTEGER NOT NULL DEFAULT 15 CHECK (est_minutes > 0),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  -- The one task per section offered to free-trial users.
  is_sample    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tbs_tasks_section_status_idx ON tbs_tasks (section, status);
-- At most one approved sample per section.
CREATE UNIQUE INDEX IF NOT EXISTS tbs_tasks_one_sample_per_section
  ON tbs_tasks (section) WHERE is_sample AND status = 'approved';

-- ── Answer keys (service role only) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbs_answer_keys (
  tbs_id  UUID PRIMARY KEY REFERENCES tbs_tasks(id) ON DELETE CASCADE,
  -- { [fieldId]: { type:'numeric', value, tolerance? } | { type:'option_list', value }
  --              | { type:'journal_entry', lines: [{ account, side, amount }] } }
  answers JSONB NOT NULL
);

-- ── Attempts ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbs_attempts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tbs_id             UUID NOT NULL REFERENCES tbs_tasks(id) ON DELETE CASCADE,
  responses          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  score              NUMERIC(8, 2),
  max_score          NUMERIC(8, 2),
  field_results      JSONB,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at       TIMESTAMPTZ,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0 CHECK (time_spent_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS tbs_attempts_user_tbs_idx ON tbs_attempts (user_id, tbs_id);
-- One in-progress attempt per user per task.
CREATE UNIQUE INDEX IF NOT EXISTS tbs_attempts_one_in_progress
  ON tbs_attempts (user_id, tbs_id) WHERE status = 'in_progress';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- The app reads/writes through the service role (bypasses RLS). Policies only
-- matter for the anon/authenticated keys.
ALTER TABLE tbs_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbs_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbs_attempts ENABLE ROW LEVEL SECURITY;

-- Answer keys: no policies at all, and no table privileges for client roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON tbs_answer_keys FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON tbs_answer_keys FROM authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tbs_attempts' AND policyname = 'Users can read own tbs attempts'
  ) THEN
    CREATE POLICY "Users can read own tbs attempts" ON tbs_attempts
      FOR SELECT
      USING (user_id IN (SELECT id FROM users WHERE clerk_id = (auth.jwt() ->> 'sub')));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
