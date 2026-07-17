-- Migration: create full ACT test tables
-- Run this in the Supabase SQL Editor before using seed-full-act-bank / assemble-full-act-test

-- Full ACT test blueprints
CREATE TABLE IF NOT EXISTS full_act_tests (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  test_number INTEGER    NOT NULL,
  name       TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ACT has no adaptive modules, so no module column
CREATE TABLE IF NOT EXISTS full_act_test_problems (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id     UUID    NOT NULL REFERENCES full_act_tests(id) ON DELETE CASCADE,
  problem_id  UUID    NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  section     TEXT    NOT NULL,   -- 'english' | 'math' | 'reading' | 'science'
  order_index INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_full_act_test_problems_test_id    ON full_act_test_problems(test_id);
CREATE INDEX IF NOT EXISTS idx_full_act_test_problems_problem_id ON full_act_test_problems(problem_id);
