"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, TextInput, adminFetch, adminSend } from "@/components/admin/admin-ui";

type Invite = { code: string; max_uses: number; used: number; expires_at: string | null; note: string | null; created_at: string };
type FeedbackStatus = "new" | "triaged" | "fixed";
type Feedback = {
  id: string;
  type: "bug" | "confusing" | "idea";
  message: string;
  page_url: string | null;
  user_agent: string | null;
  app_version: string | null;
  sentry_event_id: string | null;
  status: FeedbackStatus;
  created_at: string;
  screenshot_url: string | null;
  users: { email: string | null; cohort: string | null } | null;
};
type FunnelRow = { step: string; users: number };
type BetaData = {
  invites: Invite[];
  feedback: Feedback[];
  funnel: { all: FunnelRow[]; beta: FunnelRow[] };
  betaUserCount: number;
};

const STEP_LABEL: Record<string, string> = {
  signup: "Signed up",
  onboarding_done: "Finished onboarding",
  first_quest: "Started first quest",
  day3_return: "Returned day 3+",
  subscribed: "Subscribed",
};

function inviteState(i: Invite): string {
  if (i.expires_at && new Date(i.expires_at) <= new Date()) return "expired";
  if (i.used >= i.max_uses) return "used up";
  return "active";
}

function Funnel({ title, rows }: { title: string; rows: FunnelRow[] }) {
  const top = rows[0]?.users || 0;
  return (
    <div className="border p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.step} className="border-t first:border-t-0">
              <td className="py-1.5">{STEP_LABEL[r.step] ?? r.step}</td>
              <td className="py-1.5 text-right font-mono" data-testid={`funnel-${title.toLowerCase()}-${r.step}`}>
                {r.users}
              </td>
              <td className="w-16 py-1.5 text-right text-muted-foreground">
                {top ? `${Math.round((r.users / top) * 100)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminBetaPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "all">("new");
  const [maxUses, setMaxUses] = useState(10);
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [note, setNote] = useState("");

  // Non-admins never get here: middleware + admin/layout.tsx answer 404.
  const { data, isLoading, isError } = useQuery<BetaData>({
    queryKey: ["admin-beta"],
    queryFn: () => adminFetch<BetaData>("/api/admin/beta"),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (isError) toast.error("Failed to load beta admin data");
  }, [isError]);

  const createInvite = useMutation({
    mutationFn: () =>
      adminSend<{ invite: Invite }>("/api/admin/beta/invites", "POST", {
        maxUses,
        expiresAt: expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null,
        note: note || undefined,
      }),
    onSuccess: ({ invite }) => {
      toast.success(`Invite ${invite.code} created`);
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["admin-beta"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: FeedbackStatus }) =>
      adminSend(`/api/admin/beta/feedback/${id}`, "PATCH", { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-beta"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading || !data) {
    return <div className="py-16 text-center text-muted-foreground">{isError ? "Failed to load." : "Loading…"}</div>;
  }

  const counts = { new: 0, triaged: 0, fixed: 0 } as Record<FeedbackStatus, number>;
  for (const f of data.feedback) counts[f.status]++;
  const feedback = statusFilter === "all" ? data.feedback : data.feedback.filter((f) => f.status === statusFilter);
  const signupUrl = (code: string) =>
    typeof window !== "undefined" ? `${window.location.origin}/sign-up?invite=${code}` : `/sign-up?invite=${code}`;

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold">Beta</h1>
        <p className="text-sm text-muted-foreground">
          {data.betaUserCount} beta users · {counts.new} new / {counts.triaged} triaged / {counts.fixed} fixed feedback
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Funnel</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Funnel title="Beta" rows={data.funnel.beta} />
          <Funnel title="All" rows={data.funnel.all} />
        </div>
        <p className="text-xs text-muted-foreground">
          Strict funnel: each step counts users who also reached every earlier step. Day-3 return = any tracked
          event 3+ days after signup.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Feedback</h2>
        <div className="flex flex-wrap gap-2">
          {(["new", "triaged", "fixed", "all"] as const).map((s) => (
            <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
              {s}
              {s !== "all" && ` (${counts[s]})`}
            </Button>
          ))}
        </div>
        {feedback.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <ul className="space-y-3">
            {feedback.map((f) => (
              <li key={f.id} className="space-y-2 border p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {f.type === "bug" ? "🐞 Bug" : f.type === "confusing" ? "😕 Confusing" : "💡 Idea"}{" "}
                    <Badge value={f.status} />
                    <span className="ml-2 font-normal text-muted-foreground">
                      {new Date(f.created_at).toLocaleString()} · {f.users?.email ?? "unknown"}
                      {f.users?.cohort ? ` · ${f.users.cohort}` : ""}
                    </span>
                  </span>
                  <select
                    value={f.status}
                    onChange={(e) => setStatus.mutate({ id: f.id, status: e.target.value as FeedbackStatus })}
                    className="border bg-background px-2 py-1 text-sm"
                    aria-label="Feedback status"
                  >
                    <option value="new">new</option>
                    <option value="triaged">triaged</option>
                    <option value="fixed">fixed</option>
                  </select>
                </div>
                <p className="whitespace-pre-wrap">{f.message}</p>
                <p className="break-all text-xs text-muted-foreground">
                  {f.page_url ?? "—"} · v{f.app_version ?? "?"} · {f.user_agent ?? "—"}
                  {f.sentry_event_id && ` · Sentry ${f.sentry_event_id}`}
                </p>
                {f.screenshot_url && (
                  <a href={f.screenshot_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                    View screenshot
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Invites</h2>
        <form
          className="flex flex-wrap items-end gap-3 border p-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            createInvite.mutate();
          }}
        >
          <label className="flex flex-col gap-1">
            Max uses
            <TextInput type="number" min={1} max={1000} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} className="w-24" />
          </label>
          <label className="flex flex-col gap-1">
            Expires in (days, 0 = never)
            <TextInput type="number" min={0} value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))} className="w-24" />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            Note
            <TextInput value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Becker study group" />
          </label>
          <Button type="submit" disabled={createInvite.isPending}>
            Create invite
          </Button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2">Code</th>
                <th>Used</th>
                <th>Expires</th>
                <th>State</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.invites.map((i) => (
                <tr key={i.code} className="border-t">
                  <td className="py-2 font-mono">{i.code}</td>
                  <td>
                    {i.used}/{i.max_uses}
                  </td>
                  <td>{i.expires_at ? new Date(i.expires_at).toLocaleDateString() : "never"}</td>
                  <td>
                    <Badge value={inviteState(i)} />
                  </td>
                  <td className="text-muted-foreground">{i.note ?? ""}</td>
                  <td className="text-right">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        navigator.clipboard.writeText(signupUrl(i.code)).then(() => toast.success("Link copied"))
                      }
                    >
                      Copy link
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
