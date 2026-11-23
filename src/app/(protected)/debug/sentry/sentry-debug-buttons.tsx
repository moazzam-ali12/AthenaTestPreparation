"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

function hit(target: "api" | "agents") {
  return fetch(`/api/debug/sentry${target === "agents" ? "?target=agents" : ""}`).then(async (r) => ({
    status: r.status,
    body: await r.text(),
  }));
}

export function SentryDebugButtons() {
  const call = useMutation({
    mutationFn: hit,
    onSuccess: (r) => toast.message(`Response ${r.status}`, { description: r.body.slice(0, 120) }),
    onError: () => toast.error("Request failed"),
  });

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={() => {
          // Thrown outside React rendering → captured by the browser SDK's global handler.
          setTimeout(() => {
            throw new Error(`Sentry test error from browser (${new Date().toISOString()})`);
          });
        }}
      >
        Throw in browser
      </Button>
      <Button variant="outline" onClick={() => call.mutate("api")} disabled={call.isPending}>
        Throw in API route
      </Button>
      <Button variant="outline" onClick={() => call.mutate("agents")} disabled={call.isPending}>
        Throw in agents backend
      </Button>
    </div>
  );
}
