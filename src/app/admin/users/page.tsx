"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminFetch, adminSend, AuditList, Badge, TextInput, type AuditItem } from "@/components/admin/admin-ui";

type UserHit = { id: string; email: string; displayName: string | null; tier: string; planType: string };
type UserDetail = {
  id: string;
  clerkId: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  planType: string;
  subscriptionStatus: string;
  subscriptionEndDate: string | null;
  tier: string;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialDaysLeft: number;
  stripeCustomerId: string | null;
  stripeUrl: string | null;
  currentStreak: number;
  bestStreak: number;
  questBlocked: boolean;
  lastMissedQuestDate: string | null;
  streakFreezes: { startDate: string; endDate: string }[];
  createdAt: string;
  lastActive: string | null;
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : "—");
const today = () => new Date().toISOString().slice(0, 10);

export default function AdminUsersPage() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["admin", "users", q],
    queryFn: () => adminFetch<{ users: UserHit[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
  });
  useEffect(() => {
    if (isError) toast.error("User search failed");
  }, [isError]);

  return (
    <div className="flex gap-6">
      <div className="w-96 shrink-0">
        <h1 className="mb-4 text-xl font-semibold">Users</h1>
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(input.trim());
          }}
        >
          <TextInput
            className="flex-1"
            placeholder="Email, user ID or Clerk ID"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button type="submit" size="sm">Search</Button>
        </form>
        {isFetching && <p className="text-sm text-muted-foreground">Searching…</p>}
        <ul className="divide-y rounded-lg border">
          {data?.users.map((u) => (
            <li
              key={u.id}
              onClick={() => setSelected(u.id)}
              className={`cursor-pointer px-3 py-2 text-sm hover:bg-accent/40 ${selected === u.id ? "bg-accent/60" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{u.email}</span>
                <Badge value={u.tier} />
              </div>
              <div className="text-xs text-muted-foreground">{u.displayName ?? "—"} · {u.planType}</div>
            </li>
          ))}
          {data && !data.users.length && <li className="px-3 py-4 text-sm text-muted-foreground">No users found.</li>}
        </ul>
      </div>
      <div className="min-w-0 flex-1">{selected && <UserPanel key={selected} id={selected} />}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function UserPanel({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: ["admin", "user", id],
    queryFn: () => adminFetch<{ user: UserDetail; audit: AuditItem[] }>(`/api/admin/users/${id}`),
  });
  useEffect(() => {
    if (isError) toast.error("Failed to load user");
  }, [isError]);

  const [days, setDays] = useState(7);
  const [freeze, setFreeze] = useState({ startDate: today(), endDate: today() });

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminSend<Record<string, unknown>>(`/api/admin/users/${id}/actions`, "POST", body),
    onSuccess: () => {
      toast.success("Done");
      qc.invalidateQueries({ queryKey: ["admin", "user", id] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const u = data.user;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {u.email} <Badge value={u.tier} /> {u.isAdmin && <Badge value="admin" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <Field label="Name">{u.displayName ?? "—"}</Field>
          <Field label="User ID"><code className="text-xs">{u.id}</code></Field>
          <Field label="Clerk ID"><code className="text-xs">{u.clerkId}</code></Field>
          <Field label="Plan">{u.planType} · {u.subscriptionStatus}</Field>
          <Field label="Subscription ends">{fmt(u.subscriptionEndDate)}</Field>
          <Field label="Stripe">
            {u.stripeUrl ? (
              <a href={u.stripeUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                {u.stripeCustomerId}
              </a>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Trial started">{fmt(u.trialStartedAt)}</Field>
          <Field label="Trial ends">
            {fmt(u.trialEndsAt)}
            {u.tier === "trial" ? ` (${u.trialDaysLeft}d left)` : ""}
          </Field>
          <Field label="Signed up">{fmt(u.createdAt)}</Field>
          <Field label="Streak">{u.currentStreak} (best {u.bestStreak})</Field>
          <Field label="Accountability lock">
            {u.questBlocked ? `Locked (missed ${u.lastMissedQuestDate ?? "?"})` : "Not locked"}
          </Field>
          <Field label="Last active">{fmt(u.lastActive)}</Field>
          <Field label="Streak freezes">
            {u.streakFreezes.length ? u.streakFreezes.map((f) => `${f.startDate}→${f.endDate}`).join(", ") : "None"}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Support actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Extend trial by (days)
              <TextInput type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-24" />
            </label>
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ action: "extend_trial", days })}>
              Extend trial
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ action: "clear_lock" })}>
              Clear practice lock
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Freeze from
              <TextInput type="date" value={freeze.startDate} onChange={(e) => setFreeze({ ...freeze, startDate: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              to
              <TextInput type="date" value={freeze.endDate} onChange={(e) => setFreeze({ ...freeze, endDate: e.target.value })} />
            </label>
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ action: "add_streak_freeze", ...freeze })}>
              Add streak freeze
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ action: "resend_notification", kind: "welcome" })}>
              Resend welcome email
            </Button>
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ action: "resend_notification", kind: "streak_alert" })}>
              Send streak alert (email + push)
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admin history</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditList items={data.audit} />
        </CardContent>
      </Card>
    </div>
  );
}
