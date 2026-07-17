"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useMotionValue, useSpring, useAnimationFrame, type MotionValue } from "framer-motion";

/**
 * Drives the roaming floating-tutor FAB in viewport space.
 *
 * Trimmed down from the client-provided `use-orb-presence.ts`, which was
 * built to live inside a whiteboard canvas' coordinate space (pen-tip
 * tracking, docking to an "Extra Help" panel, spotlighting shape parts —
 * none of which apply to a sitewide floating widget). This keeps only the
 * "rest" behavior: the FAB idles near `restAnchor`, gently attracted toward
 * / repelled from the cursor so it never sits on what the user is reading,
 * with a light organic float so it never looks perfectly parked.
 *
 * When `layerRef` is omitted, the whole viewport is treated as the layer
 * (there's no canvas region to scope positioning to for a sitewide FAB).
 */
export interface OrbPoint {
  x: number;
  y: number;
}

export interface UseFloatingTutorPresenceArgs {
  /** Flag gate — when false the hook is inert (no frame loop side effects). */
  enabled: boolean;
  /** Resting position (FAB center) in layer-local px. */
  restAnchor: OrbPoint;
  /** Scopes cursor/clamp math to this element instead of the full viewport. */
  layerRef?: RefObject<HTMLElement | null>;
  /** Enable cursor attraction/avoidance. */
  cursorAttract?: boolean;
  /** When true, collapse spring motion (prefers-reduced-motion). */
  reducedMotion?: boolean;
}

export interface FloatingTutorPresence {
  x: MotionValue<number>;
  y: MotionValue<number>;
  /** "left" | "right" while travelling appreciably, "none" at rest. */
  movement: MotionValue<"left" | "right" | "none">;
}

const REST_SPRING = { stiffness: 240, damping: 20, mass: 0.7 } as const;

// Gentle organic bob so the FAB always feels like it's floating, not parked.
const FLOAT_AMP_REST = 9; // px

// Cursor force: mildly pulled toward a standoff ring around the cursor, but
// strongly shoved out of a "reading bubble" close in so it never blocks what
// the user is looking at.
const READING_BUBBLE = 150; // px: hard no-go radius around the cursor
const ATTRACT_RANGE = 520; // px: beyond this the cursor is ignored
const ATTRACT_GAIN = 0.18; // fraction of the gap pulled toward standoff
const REPEL_GAIN = 1.0; // strength of the push out of the bubble
const MOVING_EPS = 0.6; // px/frame considered "in motion"
const DIR_THRESHOLD = 0.8; // px/frame horizontal step to flip walk facing
const CLAMP_MARGIN = 56; // px: keep the FAB center this far from layer edges

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Combined attraction/repulsion offset applied to the rest anchor. */
function cursorForce(anchor: OrbPoint, cursor: OrbPoint | null | undefined): OrbPoint {
  if (!cursor) return { x: anchor.x, y: anchor.y };
  const dx = anchor.x - cursor.x;
  const dy = anchor.y - cursor.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const ux = dx / dist;
  const uy = dy / dist;

  if (dist < READING_BUBBLE) {
    const push = (READING_BUBBLE - dist) * REPEL_GAIN;
    return { x: anchor.x + ux * push, y: anchor.y + uy * push };
  }

  if (dist < ATTRACT_RANGE) {
    const targetDist = READING_BUBBLE + 60;
    const pull = (dist - targetDist) * ATTRACT_GAIN;
    return { x: anchor.x - ux * pull, y: anchor.y - uy * pull };
  }

  return { x: anchor.x, y: anchor.y };
}

export function useFloatingTutorPresence(
  args: UseFloatingTutorPresenceArgs,
): FloatingTutorPresence {
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  });

  const tx = useMotionValue(args.restAnchor.x);
  const ty = useMotionValue(args.restAnchor.y);

  const restSpring = args.reducedMotion ? { stiffness: 500, damping: 50, mass: 1 } : REST_SPRING;
  const x = useSpring(tx, restSpring);
  const y = useSpring(ty, restSpring);

  const movement = useMotionValue<"left" | "right" | "none">("none");
  const lastDir = useRef<"left" | "right">("right");
  const prev = useRef<OrbPoint>({ x: args.restAnchor.x, y: args.restAnchor.y });

  // Track the cursor in viewport coords via a single passive listener — read
  // in the frame loop and converted to layer-local px, so pointer moves
  // never trigger React re-renders.
  const clientCursor = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      clientCursor.current = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      clientCursor.current = null;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  useAnimationFrame((t) => {
    const a = argsRef.current;
    if (!a.enabled) return;

    // Scope to layerRef's rect if given, otherwise the whole viewport is
    // the layer (there's no canvas region for a sitewide FAB).
    const rect = a.layerRef?.current?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let cursor: OrbPoint | null = null;
    if (a.cursorAttract && clientCursor.current) {
      cursor = {
        x: clientCursor.current.x - rect.left,
        y: clientCursor.current.y - rect.top,
      };
    }

    const resolved = a.cursorAttract ? cursorForce(a.restAnchor, cursor) : a.restAnchor;
    // Copy into a fresh object: cursorForce/restAnchor may hand back a
    // shared reference, and the float + clamp below MUTATE `target`.
    const target = { x: resolved.x, y: resolved.y };

    if (!a.reducedMotion) {
      target.x += Math.sin(t / 820) * FLOAT_AMP_REST;
      target.y += Math.sin(t / 1100 + 1.3) * FLOAT_AMP_REST * 0.8;
    }

    if (rect.width > 0) {
      target.x = clamp(target.x, CLAMP_MARGIN, rect.width - CLAMP_MARGIN);
      target.y = clamp(target.y, CLAMP_MARGIN, rect.height - CLAMP_MARGIN);
    }

    tx.set(target.x);
    ty.set(target.y);

    const cx = x.get();
    const cy = y.get();
    const ddx = cx - prev.current.x;
    const ddy = cy - prev.current.y;
    const isMoving = Math.hypot(ddx, ddy) > MOVING_EPS;

    if (isMoving) {
      if (ddx > DIR_THRESHOLD) lastDir.current = "right";
      else if (ddx < -DIR_THRESHOLD) lastDir.current = "left";
      if (movement.get() !== lastDir.current) movement.set(lastDir.current);
    } else if (movement.get() !== "none") {
      movement.set("none");
    }
    prev.current = { x: cx, y: cy };
  });

  return { x, y, movement };
}
