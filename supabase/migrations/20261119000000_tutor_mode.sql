-- Quiz tutor mode the candidate last chose (Hint / Guided / Full explanation).
-- NULL = never chosen: the tutor defaults to Hint before answering, Full after.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS tutor_mode TEXT
  CHECK (tutor_mode IS NULL OR tutor_mode IN ('hint', 'guided', 'full'));
