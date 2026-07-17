# Athena POV — Dev Guidelines

## Stack
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui
- **Database:** Supabase (PostgreSQL) — direct client in `src/lib/supabase/client.ts`, queries in `src/lib/db/queries/`
- **Auth:** Clerk (`@clerk/nextjs`) + webhook sync via Svix
- **Data fetching:** `@tanstack/react-query` for all client reads/writes
- **AI:** Anthropic SDK
- **Rendering:** Framer Motion (animations), Recharts (charts), KaTeX + remark-math (math), react-markdown
- **Toasts:** Sonner
- **Agents backend:** Python FastAPI + Agno framework in `agents/` (port 8080)

## Data Layer

No Drizzle ORM — all DB access goes through Supabase client. Migrations use Supabase CLI (not Drizzle Kit).

### Key tables (17 total)
`users`, `sessions`, `schedules`, `user_preferences`, `topics`, `subtopics`, `lessons`, `problems`, `quiz_sessions`, `quiz_answers`, `micro_lessons`, `tutor_lesson_plans`, `custom_topics`, `custom_tutor_lesson_plans`, `learning_queue`, `onboarding_progress`, `friendships`

### Query modules (`src/lib/db/queries/`)
`users`, `dashboard`, `progress`, `profile`, `lessons`, `learning-queue`, `schedules`, `quiz`, `sat-quiz`, `sessions`, `custom-learning`, `preferences`, `onboarding`

## Data Fetching — React Query

**All client-side API calls must use `useQuery` (reads) or `useMutation` (writes).** No raw `useState`/`useEffect`/`fetch` for API data.

### Patterns
```tsx
// Read
const { data, isLoading, isError } = useQuery({
  queryKey: ["key"],
  queryFn: () => fetch("/api/endpoint").then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
  staleTime: 60_000,
});
useEffect(() => { if (isError) toast.error("Failed to load ..."); }, [isError]);

// Conditional (auth-gated)
const { data: userData, loading: userLoading } = useCurrentUser();
const enabled = !userLoading && !!userData && userData.user.onboardingCompleted;
const { data } = useQuery({ queryKey: ["key"], queryFn: ..., enabled });
```

### Query keys
| Key | Endpoint | staleTime |
|---|---|---|
| `['user']` | `/api/user/me` | 5 min |
| `['dashboard']` | `/api/dashboard` | 1 min |
| `['learning']` | `/api/learning` | 10 min |
| `['progress']` | `/api/progress` | 1 min |
| `['profile']` | `/api/profile` | 2 min |

### QueryProvider
`src/components/providers/query-provider.tsx` — wraps app inside `<ThemeProvider>`. Defaults: `staleTime: 60_000`, `retry: 1`. DevTools included (dev only).

### SSE / streaming hooks — do NOT migrate to React Query
`use-athena-conversation.ts`, `use-micro-lesson.ts`, `use-generative-lesson.ts` — all use SSE, keep as-is.

## Research Convention

When working with a framework, library, or technology not already in this project's stack, first check https://directory.llmstxt.cloud/ for its `llms.txt` summary. Fetch and read the relevant entry to understand current APIs, patterns, and best practices before writing code. This avoids hallucinating outdated or incorrect usage.

## Conventions

- Hooks in `src/hooks/` (15+ hooks + `tangent/` subdir)
- Pages under `src/app/(protected)/`
- Components organized by feature: `dashboard/`, `learn/`, `learning/`, `lessons/`, `my-learning/`, `onboarding/`, `quiz/`, `tangent/`, `tutor/`, `whiteboard/`, `ui/`
- Providers: `theme-provider`, `query-provider`, `clarity-provider`
- Onboarding redirect: check `userData.user.onboardingCompleted` in `useEffect`, separate from query `enabled` flag
- Error handling: `useEffect` watching `isError` -> `toast.error(...)`
- Math rendering: use KaTeX via `remark-math` + `rehype-katex`

---

## Route Structure

### Public
- `/` — Landing page
- `/sign-in`, `/sign-up` — Clerk auth

### Protected (`src/app/(protected)/`)
- `/dashboard` — Daily quest, streaks, progress, battle zones, leaderboard
- `/profile` — Hero profile, quest stats, tier progression
- `/queue`, `/queue/[lessonId]` — Learning queue
- `/mentor` — AI mentor interface

**Onboarding:**
`/onboarding/gist` -> `/onboarding/quiz` (has `/lesson/[lessonId]` sub-route) -> `/onboarding/schedule` -> `/onboarding/complete` -> `/dashboard`

**Learning hub:**
- `/learning` — Browse topics
- `/learning/[topicSlug]` — Topic overview
- `/learning/[topicSlug]/[subtopicSlug]` — Subtopic overview
- `/learning/[topicSlug]/[subtopicSlug]/micro-lesson` — AI whiteboard lesson
- `/learning/[topicSlug]/[subtopicSlug]/micro-lesson/post-learning` — Post-lesson practice
- `/learning/[topicSlug]/[subtopicSlug]/tutor` — AI tutor for subtopic

**Quiz** (`quiz/layout.tsx` provides `QuizRouteContext`):
- `/learning/[topicSlug]/[subtopicSlug]/quiz/[problemNumber]` — Full-screen SAT problem
- `/learning/[topicSlug]/[subtopicSlug]/quiz/[problemNumber]/tutor` — AI tutor + practice loop

**My Learning:**
- `/my-learning` — Free-form topic search/creation
- `/my-learning/[topicId]` — Generated content
- `/my-learning/[topicId]/micro-lesson` + `/post-learning` — AI whiteboard + practice
- `/my-learning/[topicId]/quiz/[problemNumber]` + `/tutor` — Custom quiz flow

**Tangent:**
- `/tangent` — Tangent mode with static lessons (`/lesson/1`, `/2`, `/3`)
- `/tangent/generative/[lessonId]` — AI-generated tangent lesson

### API Routes (~47 endpoints)
- **Auth/User:** `/api/user/{me,sync}`, `/api/webhooks/clerk`
- **Core data:** `/api/dashboard`, `/api/profile`, `/api/progress`, `/api/schedule`, `/api/learning-queue`
- **Learning:** `/api/learning`, `/api/learning/[topicSlug]/[subtopicSlug]/{route,practice-problems,micro-lesson,tutor-lesson-plan}`
- **My Learning:** `/api/my-learning/topics/[topicId]/{route,practice-problems,tutor-lesson-plan}`, `/api/my-learning/lesson/{stream,chat/stream}`, `/api/my-learning/quiz/{submit,quiz-chat/stream}`
- **Quiz:** `/api/quiz/{questions,attempt,complete}`, `/api/sat-quiz/submit`
- **AI Agents:** `/api/agent/{chat/stream,quiz-chat/stream,micro-lesson/stream,practice-problems,text-to-speech,speech-to-text}`
- **Tutor:** `/api/tutor/{plan,scene,beat,evaluate,tts-with-timestamps}`
- **Other:** `/api/health`, `/api/onboarding/{gist/complete,complete}`, `/api/friends/invite`, `/api/tangent/chat`

---

## User Flows

### Learning & Quiz (primary path)
```
/dashboard -> /learning -> /learning/[topic]/[subtopic]
  -> (optional) micro-lesson -> post-learning practice -> back
  -> quiz -> /quiz/1
    Correct -> auto-advance (1.2s)
    Wrong -> feedback + retry; wrong twice -> "tutor" phase
      -> StuckModal -> /quiz/[N]/tutor (AI chat)
        Correct in tutor -> "practice" phase
          -> PracticeEntryModal -> QuizPracticeLoop (2 problems)
            Correct -> advance
            Wrong twice -> /micro-lesson
    All done -> submit -> ResultsScreen -> optional PostLessonPractice -> close
```

### Quiz state phases (per problem)
`question` -> `hint` (1 wrong) -> `tutor` (2 wrong) -> `practice` (correct in tutor)

### Slug convention
`_make_slug()` in `agents/content_workflow.py` strips spaces, parens, commas. Use it everywhere — never raw `.replace(" ", "-")`.

### Practice problems
Seeded via `agents/seed_all_practice_problems.py` into `practice_problems` table. API: `GET /api/learning/[topicSlug]/[subtopicSlug]/practice-problems?difficulty=...`

---

## Key Layouts & Context

| Layout | Provides |
|--------|----------|
| `src/app/layout.tsx` | ClerkProvider, ThemeProvider, QueryProvider, ClarityProvider, Toaster |
| `src/app/(protected)/layout.tsx` | TopNavWrapper |
| `quiz/layout.tsx` | `QuizRouteContext`: problems, state machine, timer, feedbackMap, lockedIds, modals, save-on-submit |

## Agents Backend (`agents/`)

Python FastAPI service (port 8080) using Agno framework + Claude Sonnet + GPT-4o-mini. Provides SSE streaming endpoints for tutoring, micro-lessons, quiz chat, practice problems, and custom learning. Uses Supabase. See `agents/README.md` for details.

## Utility Modules (`src/lib/`)
- `utils.ts` — General utilities
- `scoring.ts` — SAT/quiz scoring
- `schedule-utils.ts` — Schedule helpers
- `topic-icons.tsx` — Topic icon mapping
- `ranks.ts` — Ranking/progression
- `lesson-types.ts` — Lesson type definitions
- `supabase/client.ts` — Supabase initialization
- `tutor/generate-beats.ts`, `tutor/generate-lesson-plan.ts` — AI tutor generation
