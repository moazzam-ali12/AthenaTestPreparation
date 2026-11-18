"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { useCurrentUser } from "@/hooks/use-current-user";

/** Tags browser Sentry events with the internal user id (never email/name). */
export function SentryUser() {
  const { data } = useCurrentUser();
  const id = data?.user.id ?? null;
  useEffect(() => {
    Sentry.setUser(id ? { id } : null);
  }, [id]);
  return null;
}
