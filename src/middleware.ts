import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getAccess } from "@/lib/subscription";
import { featureLockedResponse, trialExpiredResponse } from "@/lib/trial-gate";
import { isAdminClerkId } from "@/lib/admin/auth";
import {
  MICRO_LESSONS_IN_TRIAL,
  PRICING_PATH,
  QUEST_ENABLED_IN_TRIAL,
  TRIAL_ENDED_PATH,
  TUTOR_ENABLED_IN_TRIAL,
  hasProFeatures,
  isExpiredAllowedApi,
  isExpiredAllowedPage,
} from "@/lib/trial";

// Admin area: anyone but an admin (users.is_admin) gets a plain 404, signed in
// or not. Every admin route/page checks again on the server (src/lib/admin/auth.ts).
const isAdminRoute = createRouteMatcher([/^\/admin(\/|$)/, /^\/api\/admin(\/|$)/]);

const isProtectedRoute = createRouteMatcher([
  "/onboarding(.*)",
  "/dashboard(.*)",
  "/billing(.*)",
  "/subscribe(.*)",
  "/queue(.*)",
  "/my-learning(.*)",
  "/learning(.*)",
  "/review(.*)",
  "/profile(.*)",
  "/progress(.*)",
  "/mentor(.*)",
  "/practice-exam(.*)",
  "/quest(.*)",
  "/tangent(.*)",
]);

// Paid features. Onboarding, dashboard, profile, billing and topic browsing stay free.
const isProPage = createRouteMatcher([
  /^\/learning\/[^/]+\/[^/]+/,
  "/my-learning(.*)",
  "/mentor(.*)",
  "/practice-exam(.*)",
  "/quest(.*)",
  "/queue(.*)",
  "/review(.*)",
  "/progress(.*)",
]);

const isProApi = createRouteMatcher([
  "/api/agent(.*)",
  "/api/my-learning(.*)",
  // Bare /api/practice-exam is the read-only status the dashboard card shows.
  "/api/practice-exam/(.*)",
  "/api/daily-quest(.*)",
  /^\/api\/learning\/[^/]+\/[^/]+/,
  "/api/act-quiz(.*)",
  "/api/lesson-summary(.*)",
  "/api/progress/summary(.*)",
  "/api/lessons(.*)",
  "/api/tbs(.*)",
]);

// ── Free trial (see src/lib/trial.ts) ──
// TRIAL_MODE 'full': trial users pass exactly like Pro (hasProFeatures).
// TRIAL_MODE 'limited': trial users may reach ONLY these paid pages/APIs; every other isProPage /
// isProApi route stays locked until they subscribe. Quotas (MCQs per section,
// sample test, TBS) are enforced inside the API routes themselves.
//   Allowed: subtopic overview, section quizzes (MCQ practice), the sample
//            practice test, basic progress, TBS samples, and the daily quest
//            (while QUEST_ENABLED_IN_TRIAL), and the AI tutor — quiz/quest
//            tutor, floating tutor, AI quiz summary — while TUTOR_ENABLED_IN_TRIAL
//            (daily message cap enforced in the stream routes, src/lib/tutor-cap.ts).
//   Locked:  micro-lessons (premium study material), mentor (+ mentor-chat/tts-token),
//            My Learning, review queue, learning queue,
//            full-length mock exams (served as the short sample instead).
const TRIAL_ALLOWED_PAGES = [
  /^\/learning\/[^/]+\/[^/]+\/?$/,
  /^\/learning\/[^/]+\/[^/]+\/quiz(\/\d+)?\/?$/,
  // Task-Based Simulations (/learning/<section>/tbs/<id>); quota enforced in /api/tbs.
  /^\/learning\/[^/]+\/tbs\/[^/]+\/?$/,
  "/practice-exam(.*)",
  "/progress(.*)",
  ...(QUEST_ENABLED_IN_TRIAL ? [/^\/quest(\/\d+)?\/?$/] : []),
  // Micro-lesson + its post-learning practice (normally Pro-only).
  ...(MICRO_LESSONS_IN_TRIAL ? [/^\/learning\/[^/]+\/[^/]+\/micro-lesson(\/post-learning)?\/?$/] : []),
  ...(TUTOR_ENABLED_IN_TRIAL
    ? [
        /^\/learning\/[^/]+\/[^/]+\/quiz\/\d+\/tutor\/?$/,
        // The tutor's "Why was I wrong?" follow-up practice (pre-seeded, no LLM).
        /^\/learning\/[^/]+\/[^/]+\/practice\/?$/,
        ...(QUEST_ENABLED_IN_TRIAL ? [/^\/quest\/\d+\/tutor\/?$/] : []),
      ]
    : []),
];
const TRIAL_ALLOWED_APIS = [
  /^\/api\/learning\/[^/]+\/[^/]+\/?$/,
  "/api/act-quiz(.*)",
  "/api/practice-exam/(.*)",
  "/api/progress/summary(.*)",
  "/api/tbs(.*)",
  ...(QUEST_ENABLED_IN_TRIAL ? ["/api/daily-quest(.*)"] : []),
  ...(MICRO_LESSONS_IN_TRIAL
    ? [
        "/api/agent/micro-lesson/(.*)",
        /^\/api\/learning\/[^/]+\/[^/]+\/micro-lesson\/?$/,
        // Post-learning practice on the micro-lesson page.
        /^\/api\/learning\/[^/]+\/[^/]+\/practice-problems\/?$/,
      ]
    : []),
  ...(TUTOR_ENABLED_IN_TRIAL
    ? [
        "/api/agent/quiz-chat/stream",
        "/api/agent/chat/stream",
        "/api/agent/speech-to-text",
        "/api/agent/text-to-speech",
        "/api/lesson-summary",
        // Pre-seeded problems for the tutor's practice phase (no LLM).
        /^\/api\/learning\/[^/]+\/[^/]+\/practice-problems\/?$/,
      ]
    : []),
];
const isTrialAllowedPage = createRouteMatcher(TRIAL_ALLOWED_PAGES);
const isTrialAllowedApi = createRouteMatcher(TRIAL_ALLOWED_APIS);


// The onboarding lesson page loads its lesson before the user can subscribe.
const isOnboardingLessonApi = createRouteMatcher(["/api/lessons(.*)"]);

// The onboarding lesson's "Ask tutor" uses these before the user can subscribe.
// Allowed only for new accounts, so a free user can't get unlimited AI by
// simply never finishing onboarding.
const isOnboardingTutorApi = createRouteMatcher([
  "/api/agent/chat/stream",
  "/api/agent/quiz-chat/stream",
  "/api/agent/speech-to-text",
  "/api/agent/text-to-speech",
  "/api/agent/tts-token",
]);
const ONBOARDING_TUTOR_WINDOW_MS = 72 * 60 * 60 * 1000;

export default clerkMiddleware(async (auth, req) => {
  if (isAdminRoute(req)) {
    const { userId } = await auth();
    if (userId && (await isAdminClerkId(userId))) return;
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Render the app's 404 page (status 404) without revealing the route exists.
    return NextResponse.rewrite(new URL("/404", req.url), { status: 404 });
  }

  if (req.nextUrl.pathname === "/pricing") {
    const url = new URL(PRICING_PATH, req.url);
    url.search = req.nextUrl.search;
    return NextResponse.redirect(url);
  }

  if (isProtectedRoute(req)) {
    await auth.protect();
  }

  const proPage = isProPage(req);
  const proApi = isProApi(req);
  // Expired users are locked out of every app page and API except the explicit
  // allow-lists in src/lib/trial.ts (profile, billing, subscribe, settings, sign-out).
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const expiredLocked = isApi
    ? !isExpiredAllowedApi(pathname)
    : isProtectedRoute(req) && !isExpiredAllowedPage(pathname);
  if (!proPage && !proApi && !expiredLocked) return;

  // Unauthenticated API calls fall through so the route returns its own 401.
  const { userId } = await auth();
  if (!userId) return;

  const { data: user, error } = await supabase
    .from("users")
    .select("subscription_status, onboarding_completed, created_at, trial_ends_at, payment_failed_at")
    .eq("clerk_id", userId)
    .maybeSingle();
  if (error) console.error("Subscription check failed:", error);

  // Not synced yet: keep the pre-trial behaviour (free pages only).
  if (!user) {
    if (!proPage && !proApi) return;
    if (proApi) {
      return NextResponse.json(
        { error: "Subscription required", upgradeUrl: PRICING_PATH },
        { status: 402 }
      );
    }
    return NextResponse.redirect(new URL("/dashboard?locked=locked", req.url));
  }

  const { tier } = getAccess({
    subscriptionStatus: user.subscription_status,
    trialEndsAt: user.trial_ends_at,
    createdAt: user.created_at,
    paymentFailedAt: user.payment_failed_at,
  });
  if (hasProFeatures(tier)) return;

  // Limited trial: free surfaces stay open; paid ones go through the allow-lists.
  if (tier === "trial" && !proPage && !proApi) return;

  if (tier === "trial" && proApi && !user.onboarding_completed) {
    if (isOnboardingLessonApi(req)) return;
    const isNewAccount =
      Date.now() - new Date(user.created_at).getTime() < ONBOARDING_TUTOR_WINDOW_MS;
    if (isOnboardingTutorApi(req) && isNewAccount) return;
  }

  if (tier === "trial") {
    if (proApi) return isTrialAllowedApi(req) ? undefined : featureLockedResponse();
    if (isTrialAllowedPage(req)) return;
    return NextResponse.redirect(new URL("/dashboard?locked=locked", req.url));
  }

  // Expired: data is untouched; everything outside the allow-list points at the pricing page.
  if (!expiredLocked) return;
  if (isApi) return trialExpiredResponse();
  return NextResponse.redirect(new URL(TRIAL_ENDED_PATH, req.url));
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
