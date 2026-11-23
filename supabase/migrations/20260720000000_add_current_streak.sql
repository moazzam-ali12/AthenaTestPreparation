-- Persist the live current streak alongside best_streak (previously derived on read only).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "current_streak" integer DEFAULT 0 NOT NULL;
