-- Overall level: goes up by one when every one of the candidate's sections
-- (AUD, FAR, REG + their discipline) reaches level 10. On each level-up all
-- subsection_skills reset to level 1, and the overall level raises the minimum
-- question difficulty served (see difficultyFloor in src/lib/adaptive/engine.ts).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS overall_level integer NOT NULL DEFAULT 1
  CHECK (overall_level >= 1);
