"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Clock, Loader2, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { announceOverallLevelUp } from "@/lib/adaptive/announce-level-up";
import { useSaveTbsAttempt, useSubmitTbs } from "@/hooks/use-tbs";
import { ExhibitViewer } from "@/components/tbs/exhibit-viewer";
import { JournalEntryGrid, NumericInput, OptionSelect } from "@/components/tbs/tbs-fields";
import { TbsResults } from "@/components/tbs/tbs-results";
import { MathContent } from "@/components/quiz/math-content";
import type {
  TbsAttemptState,
  TbsField,
  TbsResponses,
  TbsResponseValue,
  TbsSubmitResponse,
  TbsTaskPublic,
} from "@/lib/tbs/schema";

const AUTOSAVE_DELAY_MS = 1500;

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: TbsField;
  value: TbsResponseValue | undefined;
  onChange: (v: TbsResponseValue) => void;
}) {
  switch (field.type) {
    case "numeric":
      return (
        <div className="flex items-center gap-2">
          <NumericInput
            ariaLabel={field.label}
            value={typeof value === "number" ? value : null}
            onChange={onChange}
          />
          {field.unit && <span className="text-xs text-muted-foreground">{field.unit}</span>}
        </div>
      );
    case "option_list":
      return (
        <OptionSelect
          ariaLabel={field.label}
          value={typeof value === "string" ? value : null}
          options={field.options}
          onChange={onChange}
        />
      );
    case "journal_entry":
      return (
        <JournalEntryGrid
          label={field.label}
          lines={Array.isArray(value) ? value : []}
          accounts={field.accounts}
          onChange={onChange}
        />
      );
  }
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function TbsPlayer({ task, attempt }: { task: TbsTaskPublic; attempt: TbsAttemptState }) {
  const queryClient = useQueryClient();
  const [responses, setResponses] = useState<TbsResponses>(attempt.responses);
  const [mobileTab, setMobileTab] = useState<"exhibits" | "task">("task");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<TbsSubmitResponse | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Elapsed time = time already spent on this attempt + seconds on this page.
  const [secondsHere, setSecondsHere] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecondsHere((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = attempt.timeSpentSeconds + secondsHere;
  const elapsedRef = useRef(elapsed);
  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);
  const overTime = elapsed > task.estMinutes * 60;

  const save = useSaveTbsAttempt(task.id);
  const submit = useSubmitTbs(task.id);
  const { mutate: saveMutate } = save;

  // Debounced autosave whenever responses change (skips the initial load).
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current || result) return;
    const t = setTimeout(() => {
      setSaveState("saving");
      saveMutate(
        { responses, timeSpentSeconds: elapsedRef.current },
        { onSuccess: () => setSaveState("saved"), onError: () => setSaveState("error") }
      );
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [responses, saveMutate, result]);

  const setField = useCallback((id: string, v: TbsResponseValue) => {
    dirty.current = true;
    setResponses((prev) => ({ ...prev, [id]: v }));
  }, []);

  const answered = task.fields.filter((f) => {
    const v = responses[f.id];
    return Array.isArray(v) ? v.some((l) => l.account) : v !== null && v !== undefined && v !== "";
  }).length;

  function handleSubmit() {
    submit.mutate(
      { responses, timeSpentSeconds: elapsedRef.current },
      {
        onSuccess: (data) => {
          setConfirmOpen(false);
          setResult(data);
          announceOverallLevelUp(data.overallLevelUp);
          window.scrollTo({ top: 0 });
        },
      }
    );
  }

  function handleRetry() {
    // Reopening starts a fresh in-progress attempt (free for consumed trial tasks).
    queryClient.resetQueries({ queryKey: ["tbs", "task", task.id] });
  }

  const backHref = `/learning?section=${task.section}#simulations`;

  if (result) {
    return <TbsResults result={result} fields={task.fields} section={task.section} onRetry={handleRetry} />;
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
        <Link href={backHref} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Simulations
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{task.title}</h1>
        <span className={cn("flex items-center gap-1 text-xs tabular-nums", overTime && "text-amber-500")}>
          <Clock className="h-3.5 w-3.5" /> {fmtClock(elapsed)} / {task.estMinutes}:00
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          {saveState === "saving" && (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </>
          )}
          {saveState === "saved" && (
            <>
              <CheckCheck className="h-3.5 w-3.5" /> Saved
            </>
          )}
          {saveState === "error" && <span className="text-destructive">Not saved</span>}
        </span>
        <Button size="sm" onClick={() => setConfirmOpen(true)}>
          Submit
        </Button>
      </div>

      {/* Mobile tabs */}
      <div className="grid grid-cols-2 border-b lg:hidden">
        {(["exhibits", "task"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMobileTab(t)}
            className={cn(
              "py-2 text-xs font-semibold uppercase tracking-wider",
              mobileTab === t ? "border-b-2 border-primary" : "text-muted-foreground"
            )}
          >
            {t === "exhibits" ? "Exhibits" : "Task"}
          </button>
        ))}
      </div>

      {/* Split view */}
      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        <section
          className={cn("min-h-0 overflow-hidden border-r px-4", mobileTab !== "exhibits" && "hidden lg:block")}
        >
          <ExhibitViewer exhibits={task.exhibits} />
        </section>
        <section
          className={cn("min-h-0 overflow-y-auto px-4 py-4", mobileTab !== "task" && "hidden lg:block")}
        >
          <div className="mb-6 border-l-2 border-primary/40 pl-3 text-sm">
            <MathContent content={task.instructions} />
          </div>
          <ol className="space-y-6">
            {task.fields.map((field, i) => (
              <li key={field.id} className="space-y-2">
                <div className="flex items-start justify-between gap-2 text-sm">
                  <label className="font-medium">
                    {i + 1}. {field.label}
                  </label>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {field.points} pt{field.points === 1 ? "" : "s"}
                  </span>
                </div>
                <FieldInput field={field} value={responses[field.id]} onChange={(v) => setField(field.id, v)} />
              </li>
            ))}
          </ol>
        </section>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit this simulation?</DialogTitle>
            <DialogDescription>
              You&apos;ve answered {answered} of {task.fields.length} items. You can&apos;t change answers after
              submitting.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Keep working
            </Button>
            <Button onClick={handleSubmit} disabled={submit.isPending}>
              {submit.isPending ? "Grading…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
