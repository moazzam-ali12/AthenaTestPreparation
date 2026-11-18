"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminFetch, FilterSelect, SECTIONS } from "@/components/admin/admin-ui";
import { cn } from "@/lib/utils";

type Counts = { easy: number; medium: number; hard: number };
type Sub = {
  section: string;
  topicName: string;
  subtopicId: string;
  subtopicName: string;
  mcq: Counts;
  practice: Counts;
  tbs: Counts;
  gaps: string[];
};
type Flagged = {
  problemId: string;
  source: string;
  difficulty: string;
  section: string | null;
  subtopicName: string | null;
  attempts: number;
  correct: number;
  accuracy: number;
  flag: "too_easy" | "too_hard";
};
type Balance = {
  targets: { mcq: Counts; practice: { total: number }; tbs: { total: number } };
  accuracyFlags: { minAttempts: number; tooEasy: number; tooHard: number };
  subtopics: Sub[];
  flagged: Flagged[];
};

function Cell({ value, low }: { value: number; low?: boolean }) {
  return <td className={cn("px-2 py-1 text-right tabular-nums", low && "bg-red-500/15 font-semibold text-red-700 dark:text-red-300")}>{value}</td>;
}

export default function AdminBalancePage() {
  const [section, setSection] = useState("");
  const [gapsOnly, setGapsOnly] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "balance"],
    queryFn: () => adminFetch<Balance>("/api/admin/balance"),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (isError) toast.error("Failed to load balance");
  }, [isError]);

  const rows = useMemo(
    () => (data?.subtopics ?? []).filter((s) => (!section || s.section === section) && (!gapsOnly || s.gaps.length)),
    [data, section, gapsOnly]
  );
  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const t = data.targets;
  const sum = (c: Counts) => c.easy + c.medium + c.hard;
  const withGaps = data.subtopics.filter((s) => s.gaps.length).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Difficulty balance</h1>
        <p className="text-sm text-muted-foreground">
          Approved content per subtopic. Targets: MCQ {t.mcq.easy} easy / {t.mcq.medium} medium / {t.mcq.hard} hard,{" "}
          {t.practice.total} practice{t.tbs.total ? `, ${t.tbs.total} TBS` : ""}. {withGaps} of {data.subtopics.length} subtopics below target.
        </p>
      </div>
      <div className="flex items-end gap-4">
        <FilterSelect label="Section" value={section} options={SECTIONS} onChange={setSection} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} /> Only subtopics with gaps
        </label>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left" rowSpan={2}>Section / subtopic</th>
              <th className="border-l px-2 py-1" colSpan={3}>MCQ</th>
              <th className="border-l px-2 py-1" colSpan={4}>Practice</th>
              <th className="border-l px-2 py-1" colSpan={3}>TBS</th>
            </tr>
            <tr>
              {["E", "M", "H"].map((h) => <th key={`m${h}`} className="px-2 py-1 text-right">{h}</th>)}
              {["E", "M", "H", "Σ"].map((h) => <th key={`p${h}`} className="px-2 py-1 text-right">{h}</th>)}
              {["E", "M", "H"].map((h) => <th key={`t${h}`} className="px-2 py-1 text-right">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.subtopicId} className="border-t">
                <td className="px-2 py-1">
                  <span className="text-xs text-muted-foreground">{s.section.toUpperCase()} · {s.topicName} ·</span> {s.subtopicName}
                </td>
                <Cell value={s.mcq.easy} low={s.mcq.easy < t.mcq.easy} />
                <Cell value={s.mcq.medium} low={s.mcq.medium < t.mcq.medium} />
                <Cell value={s.mcq.hard} low={s.mcq.hard < t.mcq.hard} />
                <Cell value={s.practice.easy} />
                <Cell value={s.practice.medium} />
                <Cell value={s.practice.hard} />
                <Cell value={sum(s.practice)} low={sum(s.practice) < t.practice.total} />
                <Cell value={s.tbs.easy} />
                <Cell value={s.tbs.medium} />
                <Cell value={s.tbs.hard} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Accuracy outliers</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Questions with at least {data.accuracyFlags.minAttempts} answers and accuracy above{" "}
          {Math.round(data.accuracyFlags.tooEasy * 100)}% (too easy) or below {Math.round(data.accuracyFlags.tooHard * 100)}% (too hard).
          Open one in the question bank by searching its ID.
        </p>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Question ID</th>
                <th className="px-3 py-2">Section / subtopic</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Labelled</th>
                <th className="px-3 py-2 text-right">Answers</th>
                <th className="px-3 py-2 text-right">Accuracy</th>
                <th className="px-3 py-2">Flag</th>
              </tr>
            </thead>
            <tbody>
              {data.flagged.map((f) => (
                <tr key={f.problemId} className="border-t">
                  <td className="px-3 py-1.5"><code className="text-xs">{f.problemId}</code></td>
                  <td className="px-3 py-1.5 text-xs">{f.section?.toUpperCase() ?? "—"} · {f.subtopicName ?? "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{f.source}</td>
                  <td className="px-3 py-1.5 text-xs">{f.difficulty}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{f.attempts}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{(f.accuracy * 100).toFixed(1)}%</td>
                  <td className={cn("px-3 py-1.5 text-xs font-medium", f.flag === "too_easy" ? "text-amber-600" : "text-red-600")}>
                    {f.flag === "too_easy" ? "Too easy" : "Too hard"}
                  </td>
                </tr>
              ))}
              {!data.flagged.length && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No outliers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
