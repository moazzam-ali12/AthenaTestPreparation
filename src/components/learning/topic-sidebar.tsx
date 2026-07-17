"use client";

import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getTopicIcon } from "@/lib/topic-icons";
import { Lock } from "lucide-react";

type Topic = {
  slug: string;
  name: string;
  subject: string;
  locked?: boolean;
};

const SUBJECT_LABELS: Record<string, string> = {
  english: "English",
  math: "Math",
  reading: "Reading",
  science: "Science",
};

export function TopicSidebar({
  topics,
  activeSlug,
}: {
  topics: Topic[];
  activeSlug: string;
}) {
  const subjects = [...new Set(topics.map((t) => t.subject))];

  return (
    <nav className="w-56 shrink-0 space-y-4">
      {subjects.map((subject) => (
        <div key={subject}>
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {SUBJECT_LABELS[subject] ?? subject}
          </p>
          <div className="space-y-1">
            {topics
              .filter((t) => t.subject === subject)
              .map((topic) => {
                const isActive = topic.slug === activeSlug;
                const Icon = getTopicIcon(topic.slug);

                if (topic.locked) {
                  return (
                    <button
                      key={topic.slug}
                      type="button"
                      onClick={() =>
                        toast.error("Complete the earlier topics in your curriculum first.")
                      }
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-muted-foreground/40 transition-colors hover:bg-accent/20"
                    >
                      <Lock className="h-4 w-4 shrink-0" />
                      {topic.name}
                    </button>
                  );
                }

                return (
                  <Link
                    key={topic.slug}
                    href={`/learning/${topic.slug}`}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {topic.name}
                  </Link>
                );
              })}
          </div>
        </div>
      ))}
    </nav>
  );
}
