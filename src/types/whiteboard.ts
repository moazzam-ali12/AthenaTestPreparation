// ── Layout ──────────────────────────────────────────────────────────

export type LayoutHint = {
  align?: "left" | "center";
  indentLevel?: number;
};

// ── Positions ───────────────────────────────────────────────────────

/** Absolute position (percentage 0-100 of board). Used by legacy steps. */
export type Position = { x: number; y: number };

/** Local coordinate within a figure's bounding box (0-100). */
export type LocalPoint = { x: number; y: number };

// ── Styles ──────────────────────────────────────────────────────────

export type TextStyle = {
  fontSize?: "sm" | "md" | "lg" | "xl";
  color?: string;
  fontWeight?: "normal" | "bold";
};

export type ShapeStyle = {
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  dashed?: boolean;
};

export type PointStyle = {
  color?: string;
  radius?: number;
  filled?: boolean;
};

export type CurveStyle = {
  strokeColor?: string;
  strokeWidth?: number;
  dashed?: boolean;
};

// ── Coordinate Plane ────────────────────────────────────────────────

export type CoordElement =
  | { type: "function"; points: [number, number][]; style?: CurveStyle; label?: string }
  | { type: "line"; from: [number, number]; to: [number, number]; style?: ShapeStyle; label?: string }
  | { type: "point"; at: [number, number]; label?: string; style?: PointStyle }
  | { type: "vertical_line"; x: number; style?: ShapeStyle; label?: string }
  | { type: "horizontal_line"; y: number; style?: ShapeStyle; label?: string };

export type CoordinatePlaneAction = {
  type: "coordinate_plane";
  xRange: [number, number];
  yRange: [number, number];
  elements: CoordElement[];
  showGrid?: boolean;
  axisLabels?: { x?: string; y?: string };
} & LayoutHint;

// ── Geometry ────────────────────────────────────────────────────────

export type GeoFigure =
  | { type: "polygon"; vertices: LocalPoint[]; style?: ShapeStyle; vertexLabels?: string[] }
  | { type: "circle"; center: LocalPoint; radius: number; style?: ShapeStyle }
  | { type: "ellipse"; center: LocalPoint; rx: number; ry: number; style?: ShapeStyle }
  | { type: "line_segment"; from: LocalPoint; to: LocalPoint; style?: ShapeStyle };

export type GeoLabel = {
  text: string;
  position: LocalPoint;
  fontSize?: number;
};

export type GeoAnnotation =
  | { type: "right_angle"; vertex: LocalPoint; size?: number }
  | { type: "angle_arc"; vertex: LocalPoint; from: LocalPoint; to: LocalPoint; label?: string }
  | { type: "dimension"; from: LocalPoint; to: LocalPoint; label: string; offset?: number }
  | { type: "tick_marks"; from: LocalPoint; to: LocalPoint; count: number };

export type GeometryAction = {
  type: "geometry";
  figures: GeoFigure[];
  labels?: GeoLabel[];
  annotations?: GeoAnnotation[];
  width?: number;
  height?: number;
} & LayoutHint;

// ── Number Line ─────────────────────────────────────────────────────

export type NumberLineAction = {
  type: "number_line";
  range: [number, number];
  tickInterval?: number;
  points?: { value: number; label?: string; style?: PointStyle }[];
  intervals?: {
    from: number;
    to: number;
    fromInclusive?: boolean;
    toInclusive?: boolean;
    color?: string;
  }[];
} & LayoutHint;

// ── Table ───────────────────────────────────────────────────────────

export type TableAction = {
  type: "table";
  headers: string[];
  rows: string[][];
  highlightCells?: { row: number; col: number; color?: string }[];
} & LayoutHint;

// ── Actions ─────────────────────────────────────────────────────────

export type CheckInAction = {
  type: "check_in";
  question: string;
  options: string[];
  correctOption: number;
  explanation: string;
  /** Nudge toward the method (shown after 1st wrong). */
  hint?: string;
  /** Walks through the thinking, leaving only the final step (shown after 2nd wrong). */
  detailedHint?: string;
  /** Optional whiteboard action shown on the canvas alongside the question. */
  visual?: WhiteboardAction;
  /** Visual shown on the canvas when hint is displayed (1st wrong answer). */
  hintVisual?: WhiteboardAction;
  /** Visual shown on the canvas when detailedHint is displayed (2nd wrong answer). */
  detailedHintVisual?: WhiteboardAction;
};

export type PredictAction = {
  type: "predict";
  question: string;
  options: string[];
  correctOption: number;
  explanation: string;
  hint?: string;
  /** Optional whiteboard action shown on the canvas alongside the question. */
  visual?: WhiteboardAction;
  /** Visual shown on the canvas when hint is displayed (1st wrong answer). */
  hintVisual?: WhiteboardAction;
};

export type FillBlankAction = {
  type: "fill_blank";
  prompt: string;
  acceptedAnswers: string[];
  explanation: string;
  /** Nudge toward the method (shown after 1st wrong). */
  hint?: string;
  /** Walks through the thinking, leaving only the final step (shown after 2nd wrong). */
  detailedHint?: string;
  /** Optional whiteboard action shown on the canvas alongside the question. */
  visual?: WhiteboardAction;
  /** Visual shown on the canvas when hint is displayed (1st wrong answer). */
  hintVisual?: WhiteboardAction;
  /** Visual shown on the canvas when detailedHint is displayed (2nd wrong answer). */
  detailedHintVisual?: WhiteboardAction;
};

export type WhiteboardAction =
  // Existing (position field kept for backward compat, LayoutHint added)
  | ({ type: "write_text"; text: string; position?: Position; style?: TextStyle; reveal?: "word" | "line" } & LayoutHint)
  | ({ type: "write_math"; latex: string; position?: Position; style?: TextStyle } & LayoutHint)
  | ({ type: "draw_shape"; shape: "line" | "arrow" | "circle" | "rect"; points: (Position | LocalPoint)[]; style?: ShapeStyle; width?: number; height?: number } & LayoutHint)
  | { type: "highlight"; targetStepIndex?: number; targetStepId?: number; region?: { position: Position; width: number; height: number }; color: string }
  | { type: "erase"; targetStepIndices?: number[]; targetStepIds?: number[] }
  | { type: "clear" }
  // New
  | CoordinatePlaneAction
  | GeometryAction
  | NumberLineAction
  | TableAction
  | CheckInAction
  | PredictAction
  | FillBlankAction;

// ── Steps & Response ────────────────────────────────────────────────

export type WhiteboardStep = {
  id: number;
  delayMs: number;
  durationMs: number;
  narration?: string;
  displayText?: string;
  action: WhiteboardAction;
};

export type WhiteboardResponse = {
  steps: WhiteboardStep[];
};

export type SelectedElement = {
  stepId: number;
  type: "write_text" | "write_math";
  content: string;
  /** true when content is a sub-term/word rather than the full step content */
  isTerm?: boolean;
};
