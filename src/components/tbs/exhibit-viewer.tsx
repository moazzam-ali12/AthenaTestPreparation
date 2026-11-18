"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { TbsExhibit } from "@/lib/tbs/schema";

function formatCell(value: string | number) {
  return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value;
}

function ExhibitBody({ exhibit }: { exhibit: TbsExhibit }) {
  return (
    <div className="space-y-4">
      {exhibit.body && (
        <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-line">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{exhibit.body}</ReactMarkdown>
        </div>
      )}
      {exhibit.table && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {exhibit.table.columns.map((c, i) => (
                  <th key={i} className={cn("border-b px-2 py-1.5 text-left font-semibold", i > 0 && "text-right")}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exhibit.table.rows.map((row, r) => (
                <tr key={r} className="border-b last:border-0">
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={cn("px-2 py-1.5", typeof cell === "number" && "text-right tabular-nums")}
                    >
                      {formatCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Exhibits shown as tabs (memos, invoices, trial balances, emails). */
export function ExhibitViewer({ exhibits }: { exhibits: TbsExhibit[] }) {
  const [active, setActive] = useState(0);
  const current = exhibits[active];
  if (!current) return <p className="text-sm text-muted-foreground">No exhibits.</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
        {exhibits.map((e, i) => (
          <button
            key={e.id}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              i === active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {e.title}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <ExhibitBody exhibit={current} />
      </div>
    </div>
  );
}
