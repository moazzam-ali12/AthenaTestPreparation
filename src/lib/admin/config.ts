// Content targets for /admin/balance. A subtopic below any target is flagged.
export const BALANCE_TARGETS = {
  mcq: { easy: 8, medium: 8, hard: 8 },
  practice: { total: 5 },
  tbs: { total: 0 },
} as const;

// Per-question accuracy flags (answers across quizzes, exams and daily quests).
export const ACCURACY_FLAGS = {
  minAttempts: 20,
  tooEasy: 0.95,
  tooHard: 0.15,
  limit: 200,
} as const;

export const ADMIN_PAGE_SIZE = 25;
