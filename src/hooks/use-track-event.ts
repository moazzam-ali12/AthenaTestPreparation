"use client";

import { useMutation } from "@tanstack/react-query";

/** Client-reported analytics events (server accepts only CLIENT_EVENT_NAMES). Fire-and-forget. */
type ClientEvent = "paywall_viewed";

export function useTrackEvent() {
  const { mutate } = useMutation({
    mutationFn: (e: { name: ClientEvent; props?: Record<string, string | number | boolean | null> }) =>
      fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(e),
        keepalive: true,
      }).then(() => undefined),
    retry: false,
  });
  return mutate;
}
