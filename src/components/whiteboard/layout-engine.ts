import type { WhiteboardStep } from "@/types/whiteboard";

export type LayoutResult = {
  stepId: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const LEFT_MARGIN = 50;
const INDENT_SIZE = 40;
const BOARD_WIDTH = 900;
const GAP = 24;
const TOP_PADDING = 60;

const FONT_HEIGHT: Record<string, number> = {
  sm: 20,
  md: 28,
  lg: 36,
  xl: 48,
};

/** Estimate the height of a step's action for layout purposes. */
function estimateHeight(action: WhiteboardStep["action"]): number {
  switch (action.type) {
    case "write_text": {
      const lineH = FONT_HEIGHT[action.style?.fontSize ?? "md"];
      const fSize = { sm: 14, md: 18, lg: 24, xl: 32 }[action.style?.fontSize ?? "md"] ?? 18;
      const avgCw = fSize * 0.55;
      const maxChars = Math.max(10, Math.floor(BOARD_WIDTH / avgCw));
      let totalLines = 0;
      for (const segment of (action.text ?? "").split("\n")) {
        if (!segment) { totalLines++; continue; }
        const words = segment.split(" ");
        let cur = "";
        for (const w of words) {
          const test = cur ? `${cur} ${w}` : w;
          if (test.length > maxChars && cur) { totalLines++; cur = w; }
          else cur = test;
        }
        if (cur) totalLines++;
      }
      return lineH * Math.max(1, totalLines);
    }
    case "write_math":
      return 70; // overridden by measuredHeights when available
    case "draw_shape":
      return action.height ?? 120;
    case "coordinate_plane":
      return 400;
    case "geometry":
      return action.height ?? 300;
    case "number_line":
      return 80;
    case "table": {
      const rowCount = action.rows?.length ?? 0;
      return 30 + 28 * rowCount;
    }
    // Rendered in left panel, not on canvas
    case "predict":
    case "fill_blank":
      return 0;
    // Non-visual actions
    case "highlight":
    case "erase":
    case "clear":
      return 0;
    default:
      return 0;
  }
}

/** Does the step occupy visual space on the board? */
function isContentStep(action: WhiteboardStep["action"]): boolean {
  return action.type !== "highlight" && action.type !== "erase" && action.type !== "clear" && action.type !== "check_in" && action.type !== "predict" && action.type !== "fill_blank";
}

/** Does the step use the new auto-layout system (no legacy position field)? */
function isAutoLayout(action: WhiteboardStep["action"]): boolean {
  if (action.type === "write_text" || action.type === "write_math") {
    return !action.position;
  }
  if (action.type === "draw_shape") {
    return !!(action as { align?: string }).align || !!(action as { indentLevel?: number }).indentLevel;
  }
  // New element types are always auto-layout
  if (
    action.type === "coordinate_plane" ||
    action.type === "geometry" ||
    action.type === "number_line" ||
    action.type === "table"
  ) {
    return true;
  }
  return false;
}

/**
 * Compute layout positions for all visible steps.
 *
 * Auto-layout steps stack vertically. Legacy steps with position fields
 * fall back to percentage-based absolute positioning.
 */
export function computeLayout(
  steps: WhiteboardStep[],
  visibleStepIds: Set<number>,
  measuredHeights: Map<number, number>,
  options?: { equalScaleCoords?: boolean },
): LayoutResult[] {
  const results: LayoutResult[] = [];
  let cursorY = TOP_PADDING;

  for (const step of steps) {
    if (!visibleStepIds.has(step.id)) continue;

    const { action } = step;

    // Non-visual actions get zero-size entries for lookup
    if (!isContentStep(action)) {
      results.push({ stepId: step.id, x: 0, y: 0, width: 0, height: 0 });
      continue;
    }

    // Legacy absolute positioning fallback
    if (!isAutoLayout(action)) {
      const pos = (action as { position?: { x: number; y: number } }).position;
      if (pos) {
        results.push({
          stepId: step.id,
          x: (pos.x / 100) * 1000,
          y: (pos.y / 100) * 600,
          width: 1000 - (pos.x / 100) * 1000 - 20,
          height: measuredHeights.get(step.id) ?? estimateHeight(action),
        });
        continue;
      }
    }

    // Auto-layout
    const indent = (action as { indentLevel?: number }).indentLevel ?? 0;
    const align = (action as { align?: string }).align ?? "left";
    const stepWidth = BOARD_WIDTH - indent * INDENT_SIZE;

    // Equal-scale coordinate planes: compute height to match px-per-unit on both axes
    let height: number;
    if (options?.equalScaleCoords && action.type === "coordinate_plane") {
      const xSpan = action.xRange[1] - action.xRange[0];
      const ySpan = action.yRange[1] - action.yRange[0];
      const cpPad = 40;
      const plottableW = stepWidth - 2 * cpPad;
      const MAX_CP_HEIGHT = 550;
      height = xSpan > 0 && ySpan > 0
        ? Math.max(300, Math.min(MAX_CP_HEIGHT, Math.round((ySpan / xSpan) * plottableW + 2 * cpPad)))
        : 400;
    } else {
      height = measuredHeights.get(step.id) ?? estimateHeight(action);
    }

    let x = LEFT_MARGIN + indent * INDENT_SIZE;
    if (align === "center") {
      x = (1000 - stepWidth) / 2;
    }

    results.push({
      stepId: step.id,
      x,
      y: cursorY,
      width: stepWidth,
      height,
    });

    cursorY += height + GAP;
  }

  return results;
}

/** Get total board height from layout results. */
export function computeBoardHeight(layout: LayoutResult[]): number {
  if (layout.length === 0) return 600;
  let maxBottom = 0;
  for (const r of layout) {
    const bottom = r.y + r.height;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return Math.max(600, maxBottom + 40);
}

/** Look up layout for a specific step. */
export function getStepLayout(layout: LayoutResult[], stepId: number): LayoutResult | undefined {
  return layout.find((r) => r.stepId === stepId);
}

/** Look up layout by step index (order in layout results). */
export function getStepLayoutByIndex(
  layout: LayoutResult[],
  steps: WhiteboardStep[],
  targetStepIndex: number,
): LayoutResult | undefined {
  const targetStep = steps[targetStepIndex];
  if (!targetStep) return undefined;
  return layout.find((r) => r.stepId === targetStep.id);
}
