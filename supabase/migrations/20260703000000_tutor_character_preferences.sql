-- Tutor character + voice preference (floating AI tutor picker)
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS tutor_character_id text;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS tutor_voice_id text;
