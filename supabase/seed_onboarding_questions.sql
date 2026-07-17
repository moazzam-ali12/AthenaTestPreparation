-- Seed onboarding diagnostic quiz questions (ACT Math)
-- 3 easy + 3 medium + 4 hard = 10 questions
-- Run once: psql <connection_string> -f seed_onboarding_questions.sql
-- Safe to re-run: ON CONFLICT DO NOTHING

INSERT INTO problems (
  source, order_index, difficulty, difficulty_level,
  category, question_text, options,
  correct_option, explanation, hint,
  time_recommendation_seconds
)
VALUES

-- ── EASY ────────────────────────────────────────────────────────────────────

(
  'onboarding', 1, 'easy', 2,
  'Pre-Algebra',
  'If 2x − 4 = 10, what is the value of x?',
  '["3", "5", "7", "9"]'::jsonb,
  2,
  'Add 4 to both sides to get 2x = 14, then divide by 2 to get x = 7.',
  'Isolate x by performing the same operation on both sides.',
  60
),

(
  'onboarding', 2, 'easy', 2,
  'Pre-Algebra',
  'A jacket originally costs $80. It is on sale for 25% off. What is the sale price?',
  '["$20", "$55", "$60", "$65"]'::jsonb,
  2,
  '25% of $80 = $20. Sale price = $80 − $20 = $60.',
  'Find 25% of the original price, then subtract.',
  60
),

(
  'onboarding', 3, 'easy', 2,
  'Elementary Algebra',
  'What is the value of 2x² + 3 when x = 3?',
  '["15", "21", "33", "39"]'::jsonb,
  1,
  'Substitute x = 3: 2(3)² + 3 = 2(9) + 3 = 18 + 3 = 21.',
  'Substitute the value of x before applying the exponent.',
  60
),

-- ── MEDIUM ──────────────────────────────────────────────────────────────────

(
  'onboarding', 4, 'medium', 5,
  'Elementary Algebra',
  'Solve for x: (x + 3)/4 = (2x − 1)/6',
  '["x = 9", "x = 11", "x = 13", "x = 15"]'::jsonb,
  1,
  'Cross-multiply: 6(x + 3) = 4(2x − 1) → 6x + 18 = 8x − 4 → 22 = 2x → x = 11.',
  'Cross-multiply to eliminate the fractions.',
  90
),

(
  'onboarding', 5, 'medium', 5,
  'Coordinate Geometry',
  'What is the slope of the line passing through the points (2, 5) and (6, 13)?',
  '["1", "2", "3", "4"]'::jsonb,
  1,
  'Slope = (y₂ − y₁)/(x₂ − x₁) = (13 − 5)/(6 − 2) = 8/4 = 2.',
  'Use the slope formula: rise over run.',
  90
),

(
  'onboarding', 6, 'medium', 5,
  'Intermediate Algebra',
  'If x + y = 10 and x − y = 4, what is the value of x?',
  '["3", "5", "7", "9"]'::jsonb,
  2,
  'Add the two equations: 2x = 14, so x = 7.',
  'Try adding the two equations together to eliminate one variable.',
  90
),

-- ── HARD ────────────────────────────────────────────────────────────────────

(
  'onboarding', 7, 'hard', 8,
  'Intermediate Algebra',
  'Which values of x satisfy x² − 5x + 6 = 0?',
  '["x = 2 and x = 3", "x = −2 and x = −3", "x = 1 and x = 6", "x = −1 and x = −6"]'::jsonb,
  0,
  'Factor the quadratic: (x − 2)(x − 3) = 0, giving x = 2 or x = 3.',
  'Look for two numbers that multiply to 6 and add to −5.',
  90
),

(
  'onboarding', 8, 'hard', 8,
  'Functions',
  'If f(x) = 3x − 2 and g(x) = x² + 1, what is g(f(2))?',
  '["11", "17", "23", "35"]'::jsonb,
  1,
  'f(2) = 3(2) − 2 = 4. Then g(4) = 4² + 1 = 16 + 1 = 17.',
  'Evaluate the inner function first, then substitute into the outer function.',
  90
),

(
  'onboarding', 9, 'hard', 8,
  'Plane Geometry',
  'A right triangle has legs of length 5 and 12. What is the length of the hypotenuse?',
  '["10", "13", "15", "17"]'::jsonb,
  1,
  'Apply the Pythagorean theorem: √(5² + 12²) = √(25 + 144) = √169 = 13.',
  'Use the Pythagorean theorem: a² + b² = c².',
  90
),

(
  'onboarding', 10, 'hard', 8,
  'Trigonometry',
  'In a right triangle, the side opposite angle θ is 3 and the hypotenuse is 5. What is sin(θ)?',
  '["3/4", "3/5", "4/5", "5/3"]'::jsonb,
  1,
  'sin(θ) = opposite / hypotenuse = 3/5.',
  'Recall SOH: Sine = Opposite / Hypotenuse.',
  90
)

ON CONFLICT (order_index) WHERE source = 'onboarding' DO NOTHING;
