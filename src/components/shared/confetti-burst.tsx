"use client";

import { useState } from "react";
import { motion } from "framer-motion";

const COLORS = ["#f59e0b", "#22c55e", "#3b82f6", "#ec4899", "#a855f7", "#eab308"];

function generateParticles(count: number) {
  return Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * 280,
    y: 150 + Math.random() * 150,
    rotate: Math.random() * 360,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    delay: Math.random() * 0.15,
    size: 6 + Math.random() * 6,
    duration: 1.1 + Math.random() * 0.4,
  }));
}

export function ConfettiBurst({ count = 28 }: { count?: number }) {
  const [particles] = useState(() => generateParticles(count));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible">
      {particles.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-sm"
          style={{
            backgroundColor: p.color,
            width: p.size,
            height: p.size,
            top: "50%",
            left: "50%",
          }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y, opacity: 0, rotate: p.rotate }}
          transition={{ duration: p.duration, delay: p.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}
