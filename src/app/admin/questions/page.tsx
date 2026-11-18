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
  type AuditItem,
  useAdminSubtopics,
  type SubtopicOption,
} from "@/components/admin/admin-ui";

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const SOURCES = ["cpa", "full_cpa", "practice", "onboarding"] as const;
const STATUSES = ["draft", "approved", "rejected", "archived"] as const;

type Row = {
  id: string;
  source: string;
  difficulty: string;
  status: string;
  stem: string;
  subtopicName: string | null;
  section: string | null;
};
type ListResponse = { rows: Row[]; total: number; page: number; pageSize: number };
type Question = {
  id: string;
  source: string;
  status: string;
  difficulty: string;
  question_text: string;
  options: string[];
  correct_option: number;
  explanation: string;
  subtopic_id: string | null;
};

export default function AdminQuestionsPage() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ q: "", section: "", subtopicId: "", difficulty: "", source: "", status: "" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const { data: taxonomy } = useAdminSubtopics();

  const params = new URLSearchParams({ page: String(page) });
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "questions", params.toString()],
    queryFn: () => adminFetch<ListResponse>(`/api/admin/questions?${params}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (isError) toast.error("Failed to load questions");
  }, [isError]);

  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value, ...(key === "section" ? { subtopicId: "" } : {}) }));
    setPage(1);
  };
  const subtopics = (taxonomy?.subtopics ?? []).filter((s) => !filters.section || s.section === filters.section);

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <h1 className="mb-4 text-xl font-semibold">Question bank</h1>
        <form
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter("q", search.trim());
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Search stem or ID
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
          </label>
          <FilterSelect label="Section" value={filters.section} options={SECTIONS} onChange={(v) => setFilter("section", v)} />
          <FilterSelect
            label="Subtopic"
            value={filters.subtopicId}
            options={subtopics.map((s) => ({ value: s.id, label: `${s.section.toUpperCase()} · ${s.name}` }))}
            onChange={(v) => setFilter("subtopicId", v)}
          />
          <FilterSelect label="Difficulty" value={filters.difficulty} options={DIFFICULTIES} onChange={(v) => setFilter("difficulty", v)} />
          <FilterSelect label="Source" value={filters.source} options={SOURCES} onChange={(v) => setFilter("source", v)} />
          <FilterSelect label="Status" value={filters.status} options={STATUSES} onChange={(v) => setFilter("status", v)} />
          <Button type="submit" size="sm">Search</Button>
        </form>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Stem</th>
                <th className="px-3 py-2">Section / subtopic</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Difficulty</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Loading…</td>
                </tr>
              )}
              {data?.rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                  className={`cursor-pointer border-t hover:bg-accent/40 ${selected === r.id ? "bg-accent/60" : ""}`}
                >
                  <td className="max-w-md truncate px-3 py-2">{r.stem}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.section?.toUpperCase() ?? "—"} · {r.subtopicName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.source}</td>
                  <td className="px-3 py-2 text-xs">{r.difficulty}</td>
                  <td className="px-3 py-2"><Badge value={r.status} /></td>
                </tr>
              ))}
              {data && !data.rows.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No questions match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </div>

      {selected && (
        <QuestionEditor key={selected} id={selected} subtopics={taxonomy?.subtopics ?? []} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function QuestionEditor({ id, subtopics, onClose }: { id: string; subtopics: SubtopicOption[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isError, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "question", id],
    queryFn: () => adminFetch<{ question: Question; audit: AuditItem[] }>(`/api/admin/questions/${id}`),
  });
  useEffect(() => {
    if (isError) toast.error("Failed to load question");
  }, [isError]);
  if (!data) return <aside className="w-[34rem] shrink-0 text-sm text-muted-foreground">Loading…</aside>;
  return (
    <QuestionForm
      key={dataUpdatedAt}
      initial={data.question}
      audit={data.audit}
      subtopics={subtopics}
      onClose={onClose}
      onSaved={() => {
        qc.invalidateQueries({ queryKey: ["admin", "questions"] });
        qc.invalidateQueries({ queryKey: ["admin", "question", id] });
      }}
    />
  );
}

function QuestionForm({
  initial,
  audit,
  subtopics,
  onClose,
  onSaved,
}: {
  initial: Question;
  audit: AuditItem[];
  subtopics: SubtopicOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = initial.id;
  const [draft, setDraft] = useState<Question>(initial);

  const save = useMutation({
    mutationFn: (patch: Partial<Question>) => adminSend<{ changed: boolean }>(`/api/admin/questions/${id}`, "PATCH", patch),
    onSuccess: (res) => {
      toast.success(res.changed ? "Saved" : "No changes");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const set = <K extends keyof Question>(key: K, value: Question[K]) => setDraft({ ...draft, [key]: value });

  return (
    <aside className="sticky top-4 max-h-[calc(100vh-2rem)] w-[34rem] shrink-0 space-y-4 overflow-y-auto rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge value={draft.status} /> {draft.source} · <code>{draft.id.slice(0, 8)}</code>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>

      <label className="block text-xs text-muted-foreground">
        Stem
        <TextArea rows={6} value={draft.question_text} onChange={(e) => set("question_text", e.target.value)} />
      </label>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">Options (select the correct answer)</div>
        {draft.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="radio"
              name="correct"
              checked={draft.correct_option === i}
              onChange={() => set("correct_option", i)}
              aria-label={`Option ${i + 1} is correct`}
            />
            <TextInput
              className="flex-1"
              value={opt}
              onChange={(e) => set("options", draft.options.map((o, j) => (j === i ? e.target.value : o)))}
            />
            <Button
              variant="ghost"
              size="xs"
              disabled={draft.options.length <= 2}
              onClick={() => {
                const options = draft.options.filter((_, j) => j !== i);
                const correct = draft.correct_option === i ? -1 : draft.correct_option > i ? draft.correct_option - 1 : draft.correct_option;
                setDraft({ ...draft, options, correct_option: correct });
              }}
            >
              Remove
            </Button>
          </div>
        ))}
        {draft.options.length < 6 && (
          <Button variant="outline" size="xs" onClick={() => set("options", [...draft.options, ""])}>Add option</Button>
        )}
      </div>

      <label className="block text-xs text-muted-foreground">
        Explanation
        <TextArea rows={5} value={draft.explanation} onChange={(e) => set("explanation", e.target.value)} />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Difficulty
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            value={draft.difficulty}
            onChange={(e) => set("difficulty", e.target.value)}
          >
            {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Subtopic
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            value={draft.subtopic_id ?? ""}
            onChange={(e) => set("subtopic_id", e.target.value || null)}
          >
            <option value="">—</option>
            {subtopics.map((s) => (
              <option key={s.id} value={s.id}>{s.section.toUpperCase()} · {s.topicName} · {s.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              question_text: draft.question_text,
              options: draft.options,
              correct_option: draft.correct_option,
              explanation: draft.explanation,
              difficulty: draft.difficulty,
              ...(draft.subtopic_id ? { subtopic_id: draft.subtopic_id } : {}),
            })
          }
        >
          Save changes
        </Button>
        <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ status: "approved" })}>Approve</Button>
        <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ status: "rejected" })}>Reject</Button>
        <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ status: "archived" })}>Archive</Button>
      </div>

      <div className="border-t pt-3">
        <div className="mb-1 text-xs font-medium">History</div>
        <AuditList items={audit} />
      </div>
    </aside>
  );
}
