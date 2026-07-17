-- Accountability system: missed quest detection + reset flow tracking

-- Add missed_at + reset columns to daily_quests
ALTER TABLE daily_quests ADD COLUMN IF NOT EXISTS missed_at timestamptz;
ALTER TABLE daily_quests ADD COLUMN IF NOT EXISTS reset_required boolean NOT NULL DEFAULT false;
ALTER TABLE daily_quests ADD COLUMN IF NOT EXISTS reset_completed_at timestamptz;
ALTER TABLE daily_quests ADD COLUMN IF NOT EXISTS reset_reason text;

-- Add blocked flag to users (set true when a missed quest is pending reset)
ALTER TABLE users ADD COLUMN IF NOT EXISTS quest_blocked boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_missed_quest_date date;
