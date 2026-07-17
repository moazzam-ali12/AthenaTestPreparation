-- cpa_section_exam_attempts/_answers and user_cpa_section_progress had
-- RLS policies gated on auth.uid() (Supabase Auth), but this app uses Clerk
-- for auth — the Supabase client never has a Supabase Auth session, so
-- auth.uid() is always NULL and every insert/update was silently blocked.
-- Every other table in this app has RLS disabled and relies on Clerk checks
-- in the API route layer instead; align these three with that pattern.
DROP POLICY IF EXISTS "Users can read own attempts" ON cpa_section_exam_attempts;
DROP POLICY IF EXISTS "Users can insert own attempts" ON cpa_section_exam_attempts;
DROP POLICY IF EXISTS "Users can update own attempts" ON cpa_section_exam_attempts;
ALTER TABLE cpa_section_exam_attempts DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own answers" ON cpa_section_exam_answers;
DROP POLICY IF EXISTS "Users can insert own answers" ON cpa_section_exam_answers;
DROP POLICY IF EXISTS "Users can update own answers" ON cpa_section_exam_answers;
ALTER TABLE cpa_section_exam_answers DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own section progress" ON user_cpa_section_progress;
DROP POLICY IF EXISTS "Users can insert own section progress" ON user_cpa_section_progress;
DROP POLICY IF EXISTS "Users can update own section progress" ON user_cpa_section_progress;
ALTER TABLE user_cpa_section_progress DISABLE ROW LEVEL SECURITY;
