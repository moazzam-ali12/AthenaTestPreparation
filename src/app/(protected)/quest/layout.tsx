"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTodaysQuest } from "@/hooks/use-daily-quest";
import { QuestProvider } from "@/components/daily-quest/quest-provider";
import { useAccountability } from "@/hooks/use-accountability";
import { ResetFlowModal } from "@/components/daily-quest/reset-flow-modal";

export default function QuestLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isLoading, isError } = useTodaysQuest();
  const { isBlocked, missedQuestId, missedDate } = useAccountability(!isLoading);

  useEffect(() => {
    if (isError) {
      toast.error("Failed to load quest");
      router.push("/dashboard");
    }
  }, [isError, router]);

  // Show reset modal before anything else if user is blocked
  if (isBlocked && missedQuestId && missedDate) {
    return (
      <ResetFlowModal
        missedQuestId={missedQuestId}
        missedDate={missedDate}
        onComplete={() => router.push("/quest")}
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (!data.quest || !data.problems) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">No quest generated yet.</p>
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm font-medium text-primary hover:underline"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <QuestProvider quest={data.quest} problems={data.problems}>
      {children}
    </QuestProvider>
  );
}
