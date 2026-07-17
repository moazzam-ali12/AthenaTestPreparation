-- Migration: rename users.current_reading_writing → current_english
-- ACT has an English section, not Reading & Writing (SAT-specific name)
-- Run this in the Supabase SQL Editor before deploying the updated code

ALTER TABLE users RENAME COLUMN current_reading_writing TO current_english;
