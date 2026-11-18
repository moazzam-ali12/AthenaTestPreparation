"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTbsTask } from "@/hooks/use-tbs";
import { TbsPlayer } from "@/components/tbs/tbs-player";
import { upgradeReasonFromBody, withLockedParam } from "@/components/trial/upgrade-modal-provider";

// Route: /learning/<section>/tbs/<id>. The first segment is the CPA section
// code; it shares the [topicSlug] name because Next.js requires one dynamic
// segment name per level.
export default function TbsPage() {
  const params = useParams<{ topicSlug: string; id: string }>();
  const router = useRouter();
  const { data, isLoading, isError, error } = useTbsTask(params.id);

  useEffect(() => {
    if (!isError) return;
    // An initial-load 402 can beat the global fetch wrapper, so the target
    // page opens the upgrade modal from `?locked=<reason>`.
    const { status, body } = error as Error & { status?: number; body?: unknown };
    if (status !== 402) toast.error(error.message || "Failed to load simulation");
    const target = `/learning?section=${params.topicSlug}#simulations`;
    router.replace(status === 402 ? withLockedParam(target, upgradeReasonFromBody(body) ?? "tbs") : target);
  }, [isError, error, router, params.topicSlug]);

  if (isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  return <TbsPlayer key={data.attempt.id} task={data.task} attempt={data.attempt} />;
}
