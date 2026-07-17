"use client";

import { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";
import katex from "katex";
import type { TextStyle } from "@/types/whiteboard";
import { adaptWbColor, useIsDarkMode } from "../wb-color";

const FONT_SIZES: Record<string, string> = {
  sm: "16px",
  md: "22px",
  lg: "28px",
  xl: "34px",
};

type WbMathProps = {
  latex: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style?: TextStyle;
  progress: number;
  isAnimating: boolean;
  onMeasure?: (height: number) => void;
};

export function WbMath({ latex, x, y, width, height, style, progress, isAnimating, onMeasure }: WbMathProps) {
  const isDark = useIsDarkMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(height);
  const [scale, setScale] = useState(1);
  const fontSize = FONT_SIZES[style?.fontSize ?? "md"];
  const color = adaptWbColor(style?.color ?? "var(--foreground)", isDark);
  const effectiveWidth = Math.max(width, 200);

  useEffect(() => {
    if (!containerRef.current) return;
    try {
      katex.render(latex, containerRef.current, {
        throwOnError: false,
        displayMode: true,
      });
      requestAnimationFrame(() => {
        if (containerRef.current) {
          const h = containerRef.current.scrollHeight;
          const w = containerRef.current.scrollWidth;
          if (h > 0) {
            const measured = h + 16;
            setContentHeight(measured);
            if (Math.abs(measured - height) > 10 && onMeasure) {
              onMeasure(measured);
            }
          }
          // Scale down if content overflows allocated width
          if (w > effectiveWidth) {
            setScale(effectiveWidth / w);
          } else {
            setScale(1);
          }
        }
      });
    } catch {
      if (containerRef.current) {
        containerRef.current.textContent = latex;
      }
    }
  }, [latex, height, onMeasure, effectiveWidth]);

  const clipPath = isAnimating
    ? `inset(0 ${Math.max(0, (1 - progress) * 100)}% 0 0)`
    : "inset(0 0 0 0)";

  return (
    <foreignObject
      x={x}
      y={y}
      width={effectiveWidth}
      height={contentHeight * scale + 4}
      style={{ overflow: "hidden" }}
    >
      <motion.div
        ref={containerRef}
        style={{
          fontSize,
          color,
          fontWeight: style?.fontWeight ?? "normal",
          clipPath,
          lineHeight: 1.4,
          padding: "4px 0",
          transformOrigin: "top left",
          transform: scale < 1 ? `scale(${scale})` : undefined,
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      />
    </foreignObject>
  );
}
