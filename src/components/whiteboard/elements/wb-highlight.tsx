"use client";

import { motion } from "framer-motion";

type WbHighlightProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  progress: number;
};

export function WbHighlight({ x, y, width, height, color, progress }: WbHighlightProps) {
  return (
    <motion.rect
      x={x}
      y={y}
      width={width}
      height={Math.max(height, 40)}
      fill={color}
      fillOpacity={0.18}
      rx="8"
      initial={{ opacity: 0 }}
      animate={{ opacity: progress > 0 ? 1 : 0 }}
      transition={{ duration: 0.3 }}
    />
  );
}
