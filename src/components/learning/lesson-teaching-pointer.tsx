"use client";

import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useFloatingTutorPresence, type OrbPoint } from "@/hooks/use-floating-tutor-presence";
import { useTutorCharacter } from "@/components/providers/tutor-character-provider";
import { CharacterAvatar } from "@/components/tutor/tutor-character-popover";
import { getTutorCharacter } from "@/lib/tutor-characters";
import type { StepFocus } from "@/components/whiteboard/whiteboard-canvas";

// Above the step's top edge, with a small margin from each end so the
// sweep doesn't start/end flush against the content's edges.
const STEP_V_GAP = 34; // px
const EDGE_MARGIN = 24; // px, inset from both the left and right edges

/** Converts an SVG user-space point to client (viewport) px via the live
 *  SVG element's screen CTM — the forward direction of the same technique
 *  whiteboard-canvas.tsx uses in reverse for clientToSVG. */
function svgPointToClient(x: number, y: number, svg: SVGSVGElement): OrbPoint | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = x;
  pt.y = y;
  const p = pt.matrixTransform(ctm);
  return { x: p.x, y: p.y };
}

/** Sweeps left-to-right across the step's width as `progress` advances
 *  (0→1), staying just above its top edge — approximates a hand writing
 *  along the content as it's revealed, rather than jumping straight to a
 *  fixed spot once per step. Converting both edges to client px (instead of
 *  scaling a single width) stays correct under any CTM skew/scale. */
function computeAnchor(focus: StepFocus, progress: number): OrbPoint | null {
  const { box, svg } = focus;
  const left = svgPointToClient(box.x, box.y, svg);
  const right = svgPointToClient(box.x + box.width, box.y, svg);
  if (!left || !right) return null;
  const usableWidth = Math.max(0, right.x - left.x - EDGE_MARGIN * 2);
  const p = Math.max(0, Math.min(1, progress));
  return {
    x: left.x + EDGE_MARGIN + usableWidth * p,
    y: left.y - STEP_V_GAP,
  };
}

/**
 * Hovers a small character/orb beside whatever whiteboard step is currently
 * being taught, like a teacher pointing at the board while explaining. Only
 * meant to be shown during teaching steps — the caller passes `active:
 * false` during check-in/predict/fill_blank/chat.
 *
 * Portaled to document.body so `position: fixed` positions against the true
 * viewport, not a Framer Motion ancestor's transform (micro-lesson.tsx wraps
 * the canvas in animated motion.divs, which would otherwise trap it).
 */
export function LessonTeachingPointer({
  stepFocus,
  stepProgress,
  active,
}: {
  stepFocus: StepFocus | null;
  /** 0→1 reveal progress of the current step — drives the left-to-right
   *  sweep so the pointer moves continuously instead of jumping once. */
  stepProgress: number;
  active: boolean;
}) {
  const { characterId } = useTutorCharacter();
  const character = getTutorCharacter(characterId);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const anchor = stepFocus ? computeAnchor(stepFocus, stepProgress) : null;
  const visible = active && !!anchor;

  const presence = useFloatingTutorPresence({
    enabled: visible,
    restAnchor: anchor ?? { x: 0, y: 0 },
    cursorAttract: false,
  });

  if (!mounted || !visible) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ opacity: { duration: 0.2 } }}
      aria-hidden="true"
      className="fixed top-0 left-0 z-40 pointer-events-none"
      style={{ x: presence.x, y: presence.y }}
    >
      <CharacterAvatar character={character} size={36} orbState="idle" />
    </motion.div>,
    document.body,
  );
}
