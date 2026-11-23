"use client";

import { useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JeLine } from "@/lib/tbs/schema";

const inputClass =
  "h-9 w-full border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

const formatNumber = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Parses "1,234.5", "(1,234)" and "-1234" to a number; null when empty/invalid. */
function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith("-");
  const digits = trimmed.replace(/[(),$\s-]/g, "");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

/** Formatted number input; shows thousands separators when not focused. Allows negatives. */
export function NumericInput({
  value,
  onChange,
  disabled,
  allowNegative = true,
  ariaLabel,
  className,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  allowNegative?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? "" : formatNumber(value));
  return (
    <input
      inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      value={shown}
      className={cn(inputClass, "text-right tabular-nums", className)}
      onFocus={() => setDraft(value === null ? "" : String(value))}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseAmount(e.target.value);
        if (parsed === null || allowNegative || parsed >= 0) onChange(parsed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function OptionSelect({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={inputClass}
    >
      <option value="">Select…</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

const EMPTY_LINE: JeLine = { account: "", debit: null, credit: null };

/** Journal entry rows with running totals and an imbalance warning. */
export function JournalEntryGrid({
  lines,
  accounts,
  onChange,
  disabled,
  label,
}: {
  lines: JeLine[];
  accounts: string[];
  onChange: (lines: JeLine[]) => void;
  disabled?: boolean;
  label: string;
}) {
  const rows = lines.length > 0 ? lines : [EMPTY_LINE, EMPTY_LINE];
  const update = (i: number, patch: Partial<JeLine>) =>
    onChange(rows.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const totalDebit = rows.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalCredit = rows.reduce((s, l) => s + (l.credit ?? 0), 0);
  const touched = rows.some((l) => l.debit !== null || l.credit !== null);
  const unbalanced = touched && Math.round(totalDebit * 100) !== Math.round(totalCredit * 100);

  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[1fr_7rem_7rem_2rem] gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
        <span>Account</span>
        <span className="text-right">Debit</span>
        <span className="text-right">Credit</span>
        <span />
      </div>
      {rows.map((line, i) => (
        <div
          key={i}
          className="grid grid-cols-2 gap-2 border-b pb-2 sm:grid-cols-[1fr_7rem_7rem_2rem] sm:border-0 sm:pb-0"
        >
          <div className="col-span-2 sm:col-span-1">
            <OptionSelect
              ariaLabel={`${label} line ${i + 1} account`}
              value={line.account || null}
              options={accounts}
              disabled={disabled}
              onChange={(v) => update(i, { account: v ?? "" })}
            />
          </div>
          <NumericInput
            ariaLabel={`${label} line ${i + 1} debit`}
            value={line.debit}
            allowNegative={false}
            disabled={disabled}
            onChange={(v) => update(i, { debit: v })}
          />
          <NumericInput
            ariaLabel={`${label} line ${i + 1} credit`}
            value={line.credit}
            allowNegative={false}
            disabled={disabled}
            onChange={(v) => update(i, { credit: v })}
          />
          <button
            type="button"
            aria-label={`Remove line ${i + 1}`}
            disabled={disabled || rows.length <= 1}
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            className="col-span-2 flex h-9 items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-30 sm:col-span-1"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...rows, EMPTY_LINE])}
          className="flex items-center gap-1 text-xs font-medium text-primary disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add line
        </button>
        <div className="flex gap-4 text-xs tabular-nums">
          <span>Dr {formatNumber(totalDebit)}</span>
          <span>Cr {formatNumber(totalCredit)}</span>
        </div>
      </div>
      {unbalanced && (
        <p className="flex items-center gap-1 text-xs text-amber-500">
          <AlertTriangle className="h-3.5 w-3.5" /> Debits and credits don&apos;t balance.
        </p>
      )}
    </div>
  );
}
