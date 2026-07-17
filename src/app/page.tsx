import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ParticlesBackground } from "@/components/particles-background";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CheckCircle, Zap, Brain, Target, BarChart2, Shield, Star } from "lucide-react";

const FEATURES = [
  {
    icon: Target,
    title: "Adaptive Daily Quests",
    desc: "20 questions per day, automatically calibrated to your exact skill level across AUD, FAR, REG, and your discipline section.",
  },
  {
    icon: Brain,
    title: "AI Tutoring",
    desc: "Stuck on a problem? Your AI tutor walks you through it step-by-step without giving away the answer.",
  },
  {
    icon: BarChart2,
    title: "Real Progress Tracking",
    desc: "Watch your readiness rise in real time, section by section, as you complete quests.",
  },
  {
    icon: Zap,
    title: "Whiteboard Lessons",
    desc: "Interactive micro-lessons with visual explanations for every topic on the CPA Exam.",
  },
  {
    icon: Shield,
    title: "Accountability System",
    desc: "Miss a session? The platform locks until you recommit — no coasting allowed.",
  },
  {
    icon: Star,
    title: "Gamified Progress",
    desc: "Earn XP, climb tiers from Bronze to Diamond, and maintain streaks that keep momentum.",
  },
];

const TESTIMONIALS = [
  {
    name: "Maya R.",
    score: "FAR: Passed",
    text: "I used Athena for 6 weeks and passed FAR on my first attempt. The daily quests kept me consistent without burning out.",
  },
  {
    name: "James T.",
    score: "AUD: Passed",
    text: "The AI tutor is unreal. It never just gives you the answer — it actually teaches you how to think through the problem.",
  },
  {
    name: "Priya S.",
    score: "REG: Passed",
    text: "I passed REG after two months of daily practice. The adaptive difficulty made sure I was always working on my weakest spots.",
  },
];

const FAQS = [
  {
    q: "How is Athena different from other CPA prep courses?",
    a: "Athena adapts to you in real time. Instead of a fixed curriculum, it builds daily quests around your exact weak spots and increases difficulty as you improve — like a personal trainer for the CPA Exam.",
  },
  {
    q: "How many questions per day?",
    a: "Your daily quest has 20 questions, distributed across your weakest and strongest topics. You can complete it in 20–30 minutes.",
  },
  {
    q: "What happens if I miss a day?",
    a: "Athena's accountability system detects missed sessions and requires you to go through a brief recommit flow before resuming — no silent skipping.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes — you can complete the full onboarding diagnostic for free. Your first quest is on us.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Absolutely. Cancel from your billing page at any time, no questions asked.",
  },
];

const PLAN_FEATURES = [
  "Unlimited daily quests",
  "Adaptive difficulty engine",
  "AI tutor on every problem",
  "Full CPA Exam practice tests",
  "Whiteboard micro-lessons",
  "Progress & readiness tracking",
  "Push & email reminders",
  "Gamification (XP, tiers, streaks)",
];

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      <ParticlesBackground />

      {/* Nav */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 md:px-12 border-b border-border/40">
        <span className="text-xl font-bold tracking-tight">Athena</span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/sign-in">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm">Start free</Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center justify-center px-6 pt-24 pb-20 text-center">
        <div className="inline-block rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary mb-6">
          AI-Powered CPA Exam Prep
        </div>
        <h1 className="max-w-3xl text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl leading-tight">
          Pass your CPA sections
          <br />
          <span className="text-primary">faster.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          Athena gives you a personalized daily quest, an AI tutor that actually teaches, and an accountability system that keeps you honest — for AUD, FAR, REG, and your discipline section.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/sign-up">
            <Button size="lg" className="px-10 text-base">Start for free</Button>
          </Link>
          <Link href="/sign-in">
            <Button size="lg" variant="outline" className="px-10 text-base">Sign in</Button>
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">No credit card required to start</p>
      </section>

      {/* Features */}
      <section className="relative z-10 px-6 py-20 md:px-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold mb-3">Everything you need to pass</h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            Built around the proven principle that daily consistency beats last-minute cramming.
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="rounded-2xl border bg-card p-6">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-1">{f.title}</h3>
                  <p className="text-sm text-muted-foreground">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="relative z-10 px-6 py-20 md:px-12 bg-muted/20 border-y border-border/40">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold mb-12">Candidates who showed up, passed</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="rounded-2xl border bg-card p-6">
                <div className="flex items-center gap-1 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground mb-4">&ldquo;{t.text}&rdquo;</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{t.name}</span>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {t.score}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="relative z-10 px-6 py-20 md:px-12">
        <div className="mx-auto max-w-md">
          <h2 className="text-center text-3xl font-bold mb-3">Simple pricing</h2>
          <p className="text-center text-muted-foreground mb-10">One plan, everything included.</p>
          <div className="rounded-2xl border-2 border-primary bg-card p-8 shadow-lg">
            <div className="flex items-end gap-1 mb-1">
              <span className="text-4xl font-bold">$19</span>
              <span className="text-muted-foreground pb-1">/ month</span>
            </div>
            <p className="text-sm text-muted-foreground mb-6">Cancel anytime. No contracts.</p>
            <ul className="space-y-3 mb-8">
              {PLAN_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3 text-sm">
                  <CheckCircle className="h-4 w-4 shrink-0 text-green-400" />
                  {f}
                </li>
              ))}
            </ul>
            <Link href="/sign-up" className="block">
              <Button size="lg" className="w-full text-base">Get started — first quest free</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative z-10 px-6 py-20 md:px-12 bg-muted/20 border-t border-border/40">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-center text-3xl font-bold mb-12">Frequently asked questions</h2>
          <div className="space-y-4">
            {FAQS.map((faq) => (
              <div key={faq.q} className="rounded-xl border bg-card p-5">
                <p className="font-semibold mb-2">{faq.q}</p>
                <p className="text-sm text-muted-foreground">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 px-6 py-20 md:px-12 text-center">
        <h2 className="text-3xl font-bold mb-4">Ready to start?</h2>
        <p className="text-muted-foreground mb-8 max-w-md mx-auto">
          Join candidates who are passing their CPA sections with consistent, adaptive practice.
        </p>
        <Link href="/sign-up">
          <Button size="lg" className="px-12 text-base">Start preparing for free</Button>
        </Link>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/40 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Athena — Built for candidates who show up.
      </footer>
    </div>
  );
}
