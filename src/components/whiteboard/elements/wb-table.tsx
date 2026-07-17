"use client";

import { motion } from "framer-motion";
import type { TableAction } from "@/types/whiteboard";

type WbTableProps = {
  action: TableAction;
  x: number;
  y: number;
  width: number;
  height: number;
  progress: number;
  isAnimating: boolean;
};

export function WbTable({
  action,
  x,
  y,
  width,
  height,
  progress,
  isAnimating,
}: WbTableProps) {
  const { headers, rows, highlightCells } = action;
  const totalRows = rows.length + 1; // +1 for header
  const visibleRows = isAnimating ? Math.ceil(totalRows * progress) : totalRows;

  // Build a set of highlighted cells for quick lookup
  const highlightMap = new Map<string, string>();
  if (highlightCells) {
    for (const cell of highlightCells) {
      highlightMap.set(`${cell.row}-${cell.col}`, cell.color ?? "#fbbf24");
    }
  }

  return (
    <foreignObject x={x} y={y} width={width} height={height} style={{ overflow: "visible" }}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        style={{ width: "100%", padding: "4px 0" }}
      >
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            maxWidth: `${width}px`,
            fontFamily: "system-ui, sans-serif",
            fontSize: "14px",
          }}
        >
          {/* Header */}
          {visibleRows > 0 && (
            <thead>
              <tr>
                {headers.map((h, col) => (
                  <th
                    key={col}
                    style={{
                      padding: "6px 12px",
                      borderBottom: "2px solid var(--secondary-foreground)",
                      textAlign: "left",
                      fontWeight: "bold",
                      color: "var(--foreground)",
                      backgroundColor: "var(--muted)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}

          {/* Body rows */}
          <tbody>
            {rows.map((row, rowIdx) => {
              if (rowIdx + 1 >= visibleRows) return null;
              return (
                <motion.tr
                  key={rowIdx}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.15,
                    delay: isAnimating ? (rowIdx + 1) * 0.08 : 0,
                  }}
                >
                  {row.map((cell, col) => {
                    const hlColor = highlightMap.get(`${rowIdx}-${col}`);
                    return (
                      <td
                        key={col}
                        style={{
                          padding: "5px 12px",
                          borderBottom: "1px solid var(--border)",
                          color: "var(--secondary-foreground)",
                          backgroundColor: hlColor ? `${hlColor}33` : "transparent",
                        }}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </motion.div>
    </foreignObject>
  );
}
