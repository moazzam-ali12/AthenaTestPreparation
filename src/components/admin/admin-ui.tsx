"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export async function adminFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const adminSend = <T,>(url: string, method: "PATCH" | "POST", body: unknown) =>
  adminFetch<T>(url, { method, body: JSON.stringify(body) });

const NAV = [
  { href: "/admin/questions", label: "Questions" },
  { href: "/admin/tbs", label: "TBS" },
  { href: "/admin/balance", label: "Balance" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/beta", label: "Beta" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 border-b px-6 py-3">
      <Link href="/admin" className="mr-4 font-semibold">
        Athena Admin
      </Link>
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm hover:bg-accent",
            pathname.startsWith(item.href) && "bg-accent font-medium"
          )}
        >
          {item.label}
        </Link>
      ))}
      <Link href="/dashboard" className="ml-auto text-sm text-muted-foreground hover:underline">
        Back to app
      </Link>
    </nav>
  );
}

export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (string | { value: string; label: string })[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        className="h-9 min-w-32 rounded-md border bg-background px-2 text-sm text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">All</option>
        {options.map((o) => {
          const opt = typeof o === "string" ? { value: o, label: o } : o;
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn("h-9 rounded-md border bg-background px-3 text-sm", props.className)}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn("w-full rounded-md border bg-background px-3 py-2 text-sm", props.className)}
    />
  );
}

const STATUS_COLORS: Record<string, string> = {
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  archived: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  pro: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  trial: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  expired: "bg-red-500/15 text-red-700 dark:text-red-300",
};

export function Badge({ value }: { value: string }) {
  return (
    <span className={cn("rounded px-2 py-0.5 text-xs font-medium", STATUS_COLORS[value] ?? "bg-muted")}>
      {value}
    </span>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between py-3 text-sm text-muted-foreground">
      <span>
        {total.toLocaleString()} result{total === 1 ? "" : "s"} · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export type AuditItem = {
  id: string;
  action: string;
  createdAt: string;
  adminEmail: string | null;
};

export function AuditList({ items }: { items: AuditItem[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No admin changes yet.</p>;
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {items.map((a) => (
        <li key={a.id}>
          {new Date(a.createdAt).toLocaleString()} · <span className="font-medium text-foreground">{a.action}</span> ·{" "}
          {a.adminEmail ?? "unknown"}
        </li>
      ))}
    </ul>
  );
}

export type SubtopicOption = { id: string; name: string; section: string; topicName: string };

export const SECTIONS = ["aud", "far", "reg", "bar", "isc", "tcp"] as const;

export function useAdminSubtopics() {
  return useQuery({
    queryKey: ["admin", "subtopics"],
    queryFn: () => adminFetch<{ subtopics: SubtopicOption[] }>("/api/admin/subtopics"),
    staleTime: 10 * 60_000,
  });
}
