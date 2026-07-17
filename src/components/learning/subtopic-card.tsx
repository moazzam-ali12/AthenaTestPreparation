"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

type SubtopicCardProps = {
  slug: string;
  name: string;
  difficulty: string;
  estimatedMinutes: number;
  description: string;
  locked?: boolean;
};

const difficultyStyles: Record<string, string> = {
  easy: "bg-green-500/10 text-green-700 dark:text-green-400",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  hard: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function SubtopicCard({
  subtopic,
  topicSlug,
}: {
  subtopic: SubtopicCardProps;
  topicSlug: string;
}) {
  const cardContent = (
    <Card
      className={cn(
        "transition-colors",
        subtopic.locked ? "opacity-50" : "hover:bg-accent/30"
      )}
    >
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
            {subtopic.locked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            {subtopic.name}
          </h3>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize",
              difficultyStyles[subtopic.difficulty] ?? difficultyStyles.medium
            )}
          >
            {subtopic.difficulty}
          </span>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {subtopic.description}
        </p>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{subtopic.estimatedMinutes} min</span>
        </div>
      </CardContent>
    </Card>
  );

  if (subtopic.locked) {
    return (
      <button
        type="button"
        className="text-left"
        onClick={() =>
          toast.error("Complete the earlier subtopics in your curriculum first.")
        }
      >
        {cardContent}
      </button>
    );
  }

  return (
    <Link href={`/learning/${topicSlug}/${subtopic.slug}/micro-lesson`}>
      {cardContent}
    </Link>
  );
}
