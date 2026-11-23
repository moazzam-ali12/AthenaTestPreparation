"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

type InviteCheck = { valid: boolean; status: string; message?: string };

/** Validates ?invite=CODE and parks it in an httpOnly cookie (see /api/beta/invite). */
export function InviteBanner() {
  const code = useSearchParams().get("invite");
  const { data, isLoading } = useQuery<InviteCheck>({
    queryKey: ["beta-invite", code],
    queryFn: () =>
      fetch(`/api/beta/invite?code=${encodeURIComponent(code!)}`).then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      }),
    enabled: !!code,
    staleTime: Infinity,
    retry: false,
  });

  if (!code || isLoading) return null;
  if (!data) {
    return (
      <p role="alert" data-testid="invite-status" className="max-w-sm text-center text-sm text-destructive">
        We couldn&apos;t check your invite code. You can still sign up.
      </p>
    );
  }
  return data.valid ? (
    <p data-testid="invite-status" data-valid="true" className="max-w-sm text-center text-sm text-primary">
      🎉 Beta invite applied — welcome to the Athena CPA beta.
    </p>
  ) : (
    <p role="alert" data-testid="invite-status" data-valid="false" className="max-w-sm text-center text-sm text-destructive">
      {data.message} You can still sign up, but you won&apos;t join the beta cohort.
    </p>
  );
}
