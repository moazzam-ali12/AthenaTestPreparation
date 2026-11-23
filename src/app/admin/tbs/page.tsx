"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  adminFetch,
  adminSend,
  AuditList,
  Badge,
  FilterSelect,
  Pager,
  SECTIONS,
  TextArea,
  TextInput,
  useAdminSubtopics,
  type AuditItem,
} from "@/components/admin/admin-ui";

const STATUSES = ["draft", "approved", "rejected"] as const;
const DIFFICULTIES = ["easy", "medium", "hard"] as const;

type Row = {
  id: string;
  section: string;
  title: string;
  difficulty: string;
  status: string;
  isSample: boolean;
  estMinutes: number;
  subtopicName: string | null;
};
type Task = {
  id: string;
  section: string;
  subtopic_id: string | null;
  title: string;
  difficulty: string;
  instructions: string;
  exhibits: unknown;
  fields: unknown;
  explanation: string;
  est_minutes: number;
  status: string;
  is_sample: boolean;
  answer_key: unknown;
};

export default function AdminTbsPage() {
  const [filters, setFilters] = useState({ section: "", status: "", q: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page) });
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "tbs", params.toString()],
    queryFn: () =>
      adminFetch<{ rows: Row[]; total: number; page: number; pageSize: number }>(`/api/admin/tbs?${params}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (isError) toast.error("Failed to load TBS");
  }, [isError]);
  const setFilter = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <h1 className="mb-4 text-xl font-semibold">Task-based simulations</h1>
        <form
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter("q", search.trim());
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Search title or ID
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
          </label>
          <FilterSelect label="Section" value={filters.section} options={SECTIONS} onChange={(v) => setFilter("section", v)} />
          <FilterSelect label="Status" value={filters.status} options={STATUSES} onChange={(v) => setFilter("status", v)} />
          <Button type="submit" size="sm">Search</Button>
        </form>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Section / subtopic</th>
                <th className="px-3 py-2">Difficulty</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {data?.rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                  className={`cursor-pointer border-t hover:bg-accent/40 ${selected === r.id ? "bg-accent/60" : ""}`}
                >
                  <td className="px-3 py-2">
                    {r.title} {r.isSample && <span className="ml-1 rounded bg-sky-500/15 px-1.5 text-xs text-sky-700 dark:text-sky-300">sample</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.section.toUpperCase()} · {r.subtopicName ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.difficulty}</td>
                  <td className="px-3 py-2"><Badge value={r.status} /></td>
                </tr>
              ))}
              {data && !data.rows.length && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No tasks match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </div>
      {selected && <TbsEditor key={selected} id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

const pretty = (v: unknown) => JSON.stringify(v ?? null, null, 2);

function TbsEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isError, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "tbs-task", id],
    queryFn: () => adminFetch<{ task: Task; keyErrors: string[]; audit: AuditItem[] }>(`/api/admin/tbs/${id}`),
  });
  useEffect(() => {
    if (isError) toast.error("Failed to load task");
  }, [isError]);
  if (!data) return <aside className="w-[38rem] shrink-0 text-sm text-muted-foreground">Loading…</aside>;
  return (
    <TbsForm
      key={dataUpdatedAt}
      data={data}
      onClose={onClose}
      refresh={() => {
        qc.invalidateQueries({ queryKey: ["admin", "tbs"] });
        qc.invalidateQueries({ queryKey: ["admin", "tbs-task", id] });
      }}
    />
  );
}

function TbsForm({
  data,
  onClose,
  refresh,
}: {
  data: { task: Task; keyErrors: string[]; audit: AuditItem[] };
  onClose: () => void;
  refresh: () => void;
}) {
  const id = data.task.id;
  const { data: taxonomy } = useAdminSubtopics();
  const [draft, setDraft] = useState<Task>(data.task);
  const [json, setJson] = useState({
    exhibits: pretty(data.task.exhibits),
    fields: pretty(data.task.fields),
    answer_key: pretty(data.task.answer_key),
  });
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => adminSend<{ changed: boolean }>(`/api/admin/tbs/${id}`, "PATCH", patch),
    onSuccess: (r) => {
      toast.success(r.changed ? "Saved" : "No changes");
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const sample = useMutation({
    mutationFn: () => adminSend<{ changed: boolean }>(`/api/admin/tbs/${id}/sample`, "POST", {}),
    onSuccess: () => {
      toast.success("Sample set for this section");
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const set = <K extends keyof Task>(k: K, v: Task[K]) => setDraft({ ...draft, [k]: v });
  const subtopics = (taxonomy?.subtopics ?? []).filter((s) => s.section === draft.section);

  const saveAll = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = {
        exhibits: JSON.parse(json.exhibits),
        fields: JSON.parse(json.fields),
        answer_key: JSON.parse(json.answer_key),
      };
    } catch {
      toast.error("Exhibits, fields and answer key must be valid JSON");
      return;
    }
    save.mutate({
      title: draft.title,
      difficulty: draft.difficulty,
      instructions: draft.instructions,
      explanation: draft.explanation,
      est_minutes: draft.est_minutes,
      subtopic_id: draft.subtopic_id,
      ...parsed,
    });
  };
  const busy = save.isPending || sample.isPending;

  return (
    <aside className="sticky top-4 max-h-[calc(100vh-2rem)] w-[38rem] shrink-0 space-y-3 overflow-y-auto rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge value={draft.status} /> {draft.section.toUpperCase()} {draft.is_sample && "· section sample"}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      {!!data.keyErrors.length && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          Answer key issues: {data.keyErrors.join("; ")}
        </div>
      )}
      <label className="block text-xs text-muted-foreground">
        Title
        <TextInput className="w-full" value={draft.title} onChange={(e) => set("title", e.target.value)} />
      </label>
      <div className="flex gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Difficulty
          <select className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={draft.difficulty} onChange={(e) => set("difficulty", e.target.value)}>
            {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Minutes
          <TextInput type="number" className="w-20" value={draft.est_minutes} onChange={(e) => set("est_minutes", Number(e.target.value))} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Subtopic
          <select className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={draft.subtopic_id ?? ""} onChange={(e) => set("subtopic_id", e.target.value || null)}>
            <option value="">—</option>
            {subtopics.map((s) => <option key={s.id} value={s.id}>{s.topicName} · {s.name}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-xs text-muted-foreground">
        Instructions
        <TextArea rows={4} value={draft.instructions} onChange={(e) => set("instructions", e.target.value)} />
      </label>
      <label className="block text-xs text-muted-foreground">
        Explanation
        <TextArea rows={4} value={draft.explanation} onChange={(e) => set("explanation", e.target.value)} />
      </label>
      {(["exhibits", "fields", "answer_key"] as const).map((k) => (
        <label key={k} className="block text-xs text-muted-foreground">
          {k === "answer_key" ? "Answer key (JSON, admin only)" : `${k[0].toUpperCase()}${k.slice(1)} (JSON)`}
          <TextArea rows={8} className="font-mono text-xs" value={json[k]} onChange={(e) => setJson({ ...json, [k]: e.target.value })} />
        </label>
      ))}
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button size="sm" disabled={busy} onClick={saveAll}>Save changes</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => save.mutate({ status: "approved" })}>Approve</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => save.mutate({ status: "rejected" })}>Reject</Button>
        <Button size="sm" variant="outline" disabled={busy || draft.status !== "approved" || draft.is_sample} onClick={() => sample.mutate()}>
          Set as section sample
        </Button>
      </div>
      <div className="border-t pt-3">
        <div className="mb-1 text-xs font-medium">History</div>
        <AuditList items={data.audit} />
      </div>
    </aside>
  );
}
