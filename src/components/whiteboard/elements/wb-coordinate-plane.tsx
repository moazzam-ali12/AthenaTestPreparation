"use client";

import { motion } from "framer-motion";
import type { CoordinatePlaneAction } from "@/types/whiteboard";
import { adaptWbColor, useIsDarkMode } from "../wb-color";

type WbCoordinatePlaneProps = {
  action: CoordinatePlaneAction;
  x: number;
  y: number;
  width: number;
  height: number;
  progress: number;
  isAnimating: boolean;
  equalScale?: boolean;
};

const PADDING = 40;

/** Map data coordinates to SVG coordinates within the bounding box. */
function dataToSvg(
  dataX: number,
  dataY: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): [number, number] {
  const sx = bx + PADDING + ((dataX - xMin) / (xMax - xMin)) * (bw - 2 * PADDING);
  const sy = by + PADDING + ((yMax - dataY) / (yMax - yMin)) * (bh - 2 * PADDING);
  return [sx, sy];
}

/** Catmull-Rom to cubic Bezier control points. */
function catmullRomToBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
): { cp1: [number, number]; cp2: [number, number] } {
  return {
    cp1: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
    cp2: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
  };
}

/** Detect whether a sample set is "approximately linear" — meaning a straight
 *  line explains the data well enough to prefer it over Catmull-Rom smoothing.
 *
 *  AI-authored `function` elements for linear equations sometimes emit one
 *  noisy endpoint that pulls the spline into a visible curve at the extremes
 *  (e.g., `3x + 2y = 12` with a first point (-0.5, 7.75) that should be 6.75).
 *  Catmull-Rom's endpoint clamping amplifies that error.
 *
 *  Strategy: fit a total-least-squares line, sort orthogonal residuals, and
 *  accept the set as linear if the 2nd-largest residual is within `epsilonPx`
 *  — i.e. at most one point can be an outlier. When accepted, the caller
 *  should render a single line segment using the returned fit, which ignores
 *  the outlier rather than passing through it. */
type LinearFit = {
  /** Line passes through (mx, my) with unit direction (dirX, dirY). */
  mx: number;
  my: number;
  dirX: number;
  dirY: number;
};

function tlsFit(pts: [number, number][]): LinearFit {
  const n = pts.length;
  let sumX = 0, sumY = 0;
  for (const [x, y] of pts) { sumX += x; sumY += y; }
  const mx = sumX / n;
  const my = sumY / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    const dx = x - mx;
    const dy = y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { mx, my, dirX: Math.cos(theta), dirY: Math.sin(theta) };
}

function perpDistance(fit: LinearFit, x: number, y: number): number {
  return Math.abs(-fit.dirY * (x - fit.mx) + fit.dirX * (y - fit.my));
}

function fitLineIfLinear(
  pts: [number, number][],
  epsilonPx = 3,
): LinearFit | null {
  if (pts.length < 3) return null;
  // A single bad endpoint skews TLS enough to inflate the other residuals,
  // so iteratively drop the worst point (up to 25% of the set) and refit
  // until the remaining points all lie within epsilonPx of the line.
  const maxOutliers = Math.max(1, Math.floor(pts.length / 4));
  let active = pts.slice();
  for (let trimmed = 0; trimmed <= maxOutliers; trimmed++) {
    if (active.length < 3) return null;
    const fit = tlsFit(active);
    let worstIdx = -1;
    let worstDist = 0;
    for (let i = 0; i < active.length; i++) {
      const d = perpDistance(fit, active[i][0], active[i][1]);
      if (d > worstDist) { worstDist = d; worstIdx = i; }
    }
    if (worstDist <= epsilonPx) return fit;
    active = active.filter((_, i) => i !== worstIdx);
  }
  return null;
}

/** Project a point onto the fit line, returning signed distance along dir. */
function projectOnto(fit: LinearFit, x: number, y: number): number {
  return fit.dirX * (x - fit.mx) + fit.dirY * (y - fit.my);
}

/** Build a smooth SVG path string from data points via Catmull-Rom interpolation. */
function buildSmoothPath(
  dataPoints: [number, number][],
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): string {
  if (dataPoints.length < 2) return "";

  const pts = dataPoints.map(([dx, dy]) => dataToSvg(dx, dy, xMin, xMax, yMin, yMax, bx, by, bw, bh));

  if (pts.length === 2) {
    return `M${pts[0][0]},${pts[0][1]} L${pts[1][0]},${pts[1][1]}`;
  }

  // If the samples are approximately linear (with at most one outlier),
  // render a single straight segment along the best-fit line. Prevents
  // Catmull-Rom's endpoint-clamping from bending a linear function into
  // a curve at the extremes, and corrects for AI-authored outlier endpoints.
  const fit = fitLineIfLinear(pts);
  if (fit) {
    let tMin = Infinity, tMax = -Infinity;
    for (const [x, y] of pts) {
      const t = projectOnto(fit, x, y);
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
    const x1 = fit.mx + fit.dirX * tMin;
    const y1 = fit.my + fit.dirY * tMin;
    const x2 = fit.mx + fit.dirX * tMax;
    const y2 = fit.my + fit.dirY * tMax;
    return `M${x1},${y1} L${x2},${y2}`;
  }

  let d = `M${pts[0][0]},${pts[0][1]}`;

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const { cp1, cp2 } = catmullRomToBezier(p0, p1, p2, p3);
    d += ` C${cp1[0]},${cp1[1]} ${cp2[0]},${cp2[1]} ${p2[0]},${p2[1]}`;
  }

  return d;
}

export function WbCoordinatePlane({
  action,
  x,
  y,
  width,
  height,
  progress,
  isAnimating,
  equalScale,
}: WbCoordinatePlaneProps) {
  const isDark = useIsDarkMode();
  const [xMin, xMax] = action.xRange;
  const [yMin, yMax] = action.yRange;
  const showGrid = action.showGrid !== false;

  // When equalScale is enabled, enforce equal px-per-unit on both axes
  // Otherwise use the raw bounding box (original behavior)
  let bx = x, by = y, bw = width, bh = height;
  if (equalScale) {
    const xSpan = (xMax - xMin) || 1;
    const ySpan = (yMax - yMin) || 1;
    const pw = width - 2 * PADDING;
    const ph = height - 2 * PADDING;
    const s = Math.min(pw / xSpan, ph / ySpan);
    const ew = xSpan * s;
    const eh = ySpan * s;
    bx = x + (pw - ew) / 2;
    by = y + (ph - eh) / 2;
    bw = ew + 2 * PADDING;
    bh = eh + 2 * PADDING;
  }

  // Compute tick values with smart intervals
  function niceTickInterval(rangeMin: number, rangeMax: number): number {
    const span = rangeMax - rangeMin;
    if (span <= 0) return 1;
    // Target roughly 8-12 ticks
    const rough = span / 10;
    // Round to a "nice" number: 1, 2, 5, 10, 20, 25, 50, ...
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const residual = rough / mag;
    let nice: number;
    if (residual <= 1.5) nice = 1;
    else if (residual <= 3.5) nice = 2;
    else if (residual <= 7.5) nice = 5;
    else nice = 10;
    return Math.max(nice * mag, 1);
  }

  const xInterval = niceTickInterval(xMin, xMax);
  const yInterval = niceTickInterval(yMin, yMax);

  const xTicks: number[] = [];
  const yTicks: number[] = [];
  for (let v = Math.ceil(xMin / xInterval) * xInterval; v <= Math.floor(xMax); v += xInterval) xTicks.push(v);
  for (let v = Math.ceil(yMin / yInterval) * yInterval; v <= Math.floor(yMax); v += yInterval) yTicks.push(v);

  // Origin in SVG coords
  const [originX, originY] = dataToSvg(0, 0, xMin, xMax, yMin, yMax, bx, by, bw, bh);

  // Axis endpoints
  const [axisLeft] = dataToSvg(xMin, 0, xMin, xMax, yMin, yMax, bx, by, bw, bh);
  const [axisRight] = dataToSvg(xMax, 0, xMin, xMax, yMin, yMax, bx, by, bw, bh);
  const [, axisTop] = dataToSvg(0, yMax, xMin, xMax, yMin, yMax, bx, by, bw, bh);
  const [, axisBottom] = dataToSvg(0, yMin, xMin, xMax, yMin, yMax, bx, by, bw, bh);

  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Grid lines */}
      {showGrid && (
        <g>
          {xTicks.map((v) => {
            const [sx] = dataToSvg(v, 0, xMin, xMax, yMin, yMax, bx, by, bw, bh);
            return (
              <line
                key={`xg-${v}`}
                x1={sx}
                y1={by + PADDING}
                x2={sx}
                y2={by + bh - PADDING}
                style={{ stroke: "var(--border)" }}
                strokeWidth="0.5"
              />
            );
          })}
          {yTicks.map((v) => {
            const [, sy] = dataToSvg(0, v, xMin, xMax, yMin, yMax, bx, by, bw, bh);
            return (
              <line
                key={`yg-${v}`}
                x1={bx + PADDING}
                y1={sy}
                x2={bx + bw - PADDING}
                y2={sy}
                style={{ stroke: "var(--border)" }}
                strokeWidth="0.5"
              />
            );
          })}
        </g>
      )}

      {/* X axis */}
      <line
        x1={axisLeft}
        y1={originY}
        x2={axisRight}
        y2={originY}
        style={{ stroke: "var(--foreground)" }}
        strokeWidth="1.5"
      />
      {/* X axis arrow */}
      <polygon
        points={`${axisRight},${originY} ${axisRight - 8},${originY - 4} ${axisRight - 8},${originY + 4}`}
        style={{ fill: "var(--foreground)" }}
      />

      {/* Y axis */}
      <line
        x1={originX}
        y1={axisBottom}
        x2={originX}
        y2={axisTop}
        style={{ stroke: "var(--foreground)" }}
        strokeWidth="1.5"
      />
      {/* Y axis arrow */}
      <polygon
        points={`${originX},${axisTop} ${originX - 4},${axisTop + 8} ${originX + 4},${axisTop + 8}`}
        style={{ fill: "var(--foreground)" }}
      />

      {/* X tick marks + labels */}
      {xTicks.map((v) => {
        if (v === 0) return null;
        const [sx] = dataToSvg(v, 0, xMin, xMax, yMin, yMax, bx, by, bw, bh);
        return (
          <g key={`xt-${v}`}>
            <line x1={sx} y1={originY - 4} x2={sx} y2={originY + 4} style={{ stroke: "var(--foreground)" }} strokeWidth="1" />
            <text
              x={sx}
              y={originY + 16}
              textAnchor="middle"
              fontSize="10"
              style={{ fill: "var(--muted-foreground)" }}
              fontFamily="system-ui, sans-serif"
            >
              {v}
            </text>
          </g>
        );
      })}

      {/* Y tick marks + labels */}
      {yTicks.map((v) => {
        if (v === 0) return null;
        const [, sy] = dataToSvg(0, v, xMin, xMax, yMin, yMax, bx, by, bw, bh);
        return (
          <g key={`yt-${v}`}>
            <line x1={originX - 4} y1={sy} x2={originX + 4} y2={sy} style={{ stroke: "var(--foreground)" }} strokeWidth="1" />
            <text
              x={originX - 10}
              y={sy + 3}
              textAnchor="end"
              fontSize="10"
              style={{ fill: "var(--muted-foreground)" }}
              fontFamily="system-ui, sans-serif"
            >
              {v}
            </text>
          </g>
        );
      })}

      {/* Axis labels */}
      {action.axisLabels?.x && (
        <text
          x={axisRight + 12}
          y={originY + 4}
          fontSize="12"
          style={{ fill: "var(--secondary-foreground)" }}
          fontFamily="system-ui, sans-serif"
        >
          {action.axisLabels.x}
        </text>
      )}
      {action.axisLabels?.y && (
        <text
          x={originX + 8}
          y={axisTop - 4}
          fontSize="12"
          style={{ fill: "var(--secondary-foreground)" }}
          fontFamily="system-ui, sans-serif"
        >
          {action.axisLabels.y}
        </text>
      )}

      {/* Elements */}
      {action.elements.map((elem, i) => {
        switch (elem.type) {
          case "function": {
            const pathD = buildSmoothPath(
              elem.points,
              xMin,
              xMax,
              yMin,
              yMax,
              bx,
              by,
              bw,
              bh,
            );
            const pathRef = `coord-fn-${i}`;
            return (
              <g key={`fn-${i}`}>
                <motion.path
                  d={pathD}
                  fill="none"
                  stroke={adaptWbColor(elem.style?.strokeColor ?? "#2563eb", isDark)}
                  strokeWidth={elem.style?.strokeWidth ?? 2}
                  strokeDasharray={elem.style?.dashed ? "6 4" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={isAnimating ? { pathLength: 0 } : undefined}
                  animate={{ pathLength: progress }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                />
                {elem.label && (
                  <text
                    x={dataToSvg(elem.points[elem.points.length - 1][0], elem.points[elem.points.length - 1][1], xMin, xMax, yMin, yMax, bx, by, bw, bh)[0] + 8}
                    y={dataToSvg(elem.points[elem.points.length - 1][0], elem.points[elem.points.length - 1][1], xMin, xMax, yMin, yMax, bx, by, bw, bh)[1] - 8}
                    fontSize="12"
                    fill={adaptWbColor(elem.style?.strokeColor ?? "#2563eb", isDark)}
                    fontFamily="system-ui, sans-serif"
                  >
                    {elem.label}
                  </text>
                )}
              </g>
            );
          }

          case "point": {
            const [px, py] = dataToSvg(elem.at[0], elem.at[1], xMin, xMax, yMin, yMax, bx, by, bw, bh);
            const filled = elem.style?.filled !== false;
            const r = elem.style?.radius ?? 4;
            return (
              <g key={`pt-${i}`}>
                <motion.circle
                  cx={px}
                  cy={py}
                  r={r}
                  fill={filled ? adaptWbColor(elem.style?.color ?? "#2563eb", isDark) : "var(--wb-canvas)"}
                  stroke={adaptWbColor(elem.style?.color ?? "#2563eb", isDark)}
                  strokeWidth="2"
                  initial={{ scale: 0 }}
                  animate={{ scale: progress > 0 ? 1 : 0 }}
                  transition={{ duration: 0.2 }}
                />
                {elem.label && (
                  <text
                    x={px + r + 4}
                    y={py - r - 2}
                    fontSize="11"
                    style={{ fill: "var(--secondary-foreground)" }}
                    fontFamily="system-ui, sans-serif"
                  >
                    {elem.label}
                  </text>
                )}
              </g>
            );
          }

          case "line": {
            const [x1, y1] = dataToSvg(elem.from[0], elem.from[1], xMin, xMax, yMin, yMax, bx, by, bw, bh);
            const [x2, y2] = dataToSvg(elem.to[0], elem.to[1], xMin, xMax, yMin, yMax, bx, by, bw, bh);
            const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            return (
              <g key={`ln-${i}`}>
                <motion.line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  style={{ stroke: elem.style?.strokeColor ?? "var(--secondary-foreground)" }}
                  strokeWidth={elem.style?.strokeWidth ?? 1.5}
                  strokeDasharray={elem.style?.dashed ? "6 4" : (isAnimating ? len : undefined)}
                  strokeDashoffset={isAnimating ? len * (1 - progress) : 0}
                />
                {elem.label && (
                  <text
                    x={(x1 + x2) / 2 + 6}
                    y={(y1 + y2) / 2 - 6}
                    fontSize="11"
                    style={{ fill: "var(--secondary-foreground)" }}
                    fontFamily="system-ui, sans-serif"
                  >
                    {elem.label}
                  </text>
                )}
              </g>
            );
          }

          case "vertical_line": {
            const [vx, vTop] = dataToSvg(elem.x, yMax, xMin, xMax, yMin, yMax, bx, by, bw, bh);
            const [, vBottom] = dataToSvg(elem.x, yMin, xMin, xMax, yMin, yMax, bx, by, bw, bh);
            return (
              <g key={`vl-${i}`}>
                <line
                  x1={vx}
                  y1={vTop}
                  x2={vx}
                  y2={vBottom}
                  style={{ stroke: elem.style?.strokeColor ?? "var(--muted-foreground)" }}
                  strokeWidth={elem.style?.strokeWidth ?? 1}
                  strokeDasharray={elem.style?.dashed ? "6 4" : "4 2"}
                />
                {elem.label && (
                  <text
                    x={vx + 4}
                    y={vTop + 12}
                    fontSize="10"
                    style={{ fill: "var(--muted-foreground)" }}
                    fontFamily="system-ui, sans-serif"
                  >
                    {elem.label}
                  </text>
                )}
              </g>
            );
          }

          case "horizontal_line": {
            const [hLeft, hy] = dataToSvg(xMin, elem.y, xMin, xMax, yMin, yMax, bx, by, bw, bh);
            const [hRight] = dataToSvg(xMax, elem.y, xMin, xMax, yMin, yMax, bx, by, bw, bh);
            return (
              <g key={`hl-${i}`}>
                <line
                  x1={hLeft}
                  y1={hy}
                  x2={hRight}
                  y2={hy}
                  style={{ stroke: elem.style?.strokeColor ?? "var(--muted-foreground)" }}
                  strokeWidth={elem.style?.strokeWidth ?? 1}
                  strokeDasharray={elem.style?.dashed ? "6 4" : "4 2"}
                />
                {elem.label && (
                  <text
                    x={hRight - 4}
                    y={hy - 4}
                    textAnchor="end"
                    fontSize="10"
                    style={{ fill: "var(--muted-foreground)" }}
                    fontFamily="system-ui, sans-serif"
                  >
                    {elem.label}
                  </text>
                )}
              </g>
            );
          }

          default:
            return null;
        }
      })}
    </motion.g>
  );
}
