"use client";
import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";

export function ClarityIdentifier() {
  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (!isLoaded || !user) return;
    if (typeof window !== "undefined" && window.clarity) {
      window.clarity("identify", user.id, "", "", user.primaryEmailAddress?.emailAddress ?? "");
    }
  }, [user, isLoaded]);

  return null;
}
