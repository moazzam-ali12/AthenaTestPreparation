"use client";

import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Clock, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTbsList } from "@/hooks/use-tbs";
import { useAccess } from "@/hooks/use-trial";
import { useUpgradeModal } from "@/components/trial/upgrade-modal-provider";
import { TBS_PER_SECTION } from "@/lib/trial";
import type { TbsListItem } from "@/lib/tbs/schema";
import type { CpaSubject } from "@/types/cpa-exam";

/** `limited`: a quota-limited trial user, the only one the "Free sample" tag means anything to. */
function TaskCard({ task, limited }: { task: TbsListItem; limited: boolean }) {
  return (
    <Card className={cn("h-full transition-colors", task.locked ? "opacity-60" : "hover:bg-accent/30")}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start gap-2">
          {task.locked ? (
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : task.status === "submitted" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
          ) : (
            <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          )}
          <h3 className="text-sm font-semibold leading-snug">{task.title}</h3>
        </div>
        {task.subtopicName && <p className="text-xs text-muted-foreground line-clamp-1">{task.subtopicName}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="capitalize">{task.difficulty}</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {task.estMinutes} min
          </span>
          {limited && task.isSample && <span className="font-medium text-primary">Free sample</span>}
          {task.bestPercent !== null && <span>Best {task.bestPercent}%</span>}
          {task.status === "in_progress" && <span>In progress</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/** "Simulations" list for a CPA section. Locked tasks stay visible and open the upgrade modal. */
export function TbsList({ section }: { section: CpaSubject }) {
  const { tier } = useAccess();
  // Expired users are sent to /subscribe by any paid API; don't trigger that from browsing.
  const { data, isLoading } = useTbsList(section, tier === "pro" || tier === "trial");
  const { openUpgrade } = useUpgradeModal();
  const tasks = data?.tasks ?? [];

  if (tier === null || tier === "expired") return null;

  return (
    <section id="simulations" className="mt-10 scroll-mt-20">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold">Simulations</h2>
        {tier === "trial" && (
          <span className="text-xs text-muted-foreground">
            Free trial: {TBS_PER_SECTION} sample simulation per section
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No simulations available yet for this section.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tasks.map((task) =>
            task.locked ? (
              <button
                key={task.id}
                type="button"
                className="text-left"
                aria-label={`${task.title} (Pro)`}
                onClick={() => openUpgrade("tbs")}
              >
                <TaskCard task={task} limited={tier === "trial"} />
              </button>
            ) : (
              <Link key={task.id} href={`/learning/${section}/tbs/${task.id}`}>
                <TaskCard task={task} limited={tier === "trial"} />
              </Link>
            )
          )}
        </div>
      )}
    </section>
  );
}
