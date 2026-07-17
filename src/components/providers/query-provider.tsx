"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        // retry: 0 — a failed query is not auto-retried. Retries on the
        // generation-backed queries (lessons, practice problems) double the
        // Anthropic cost on every transient error, so we don't retry by default.
        defaultOptions: { queries: { staleTime: 60_000, retry: 0 } },
      })
  );
  return (
    <QueryClientProvider client={client}>
      {children}
    </QueryClientProvider>
  );
}
