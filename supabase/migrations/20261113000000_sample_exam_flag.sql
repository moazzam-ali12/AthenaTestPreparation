-- Free-trial sample tests reuse cpa_section_exam_attempts. Flag them so they
-- never touch section pass status / full-exam stats. Existing rows are full exams.
ALTER TABLE cpa_section_exam_attempts
  ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT false;
