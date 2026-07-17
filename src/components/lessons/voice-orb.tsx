"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Mic } from "lucide-react";

type VoiceOrbState = "idle" | "listening" | "processing" | "speaking";

type VoiceOrbProps = {
  state: VoiceOrbState;
  amplitude: number;
  onTap: () => void;
  disabled?: boolean;
};

const stateConfig = {
  idle: {
    color: "var(--athena-navy)",
    glowColor: "var(--athena-navy-light)",
  },
  listening: {
    color: "var(--athena-amber)",
    glowColor: "var(--athena-amber-light)",
  },
  processing: {
    color: "var(--athena-navy)",
    glowColor: "var(--athena-navy-light)",
  },
  speaking: {
    color: "var(--athena-success)",
    glowColor: "var(--athena-success-light)",
  },
};

export function VoiceOrb({ state, amplitude, onTap, disabled }: VoiceOrbProps) {
  const config = stateConfig[state];
  const isActive = state === "listening" || state === "speaking";
  const scale = isActive ? 1 + amplitude * 0.3 : 1;

  return (
    <div className="relative flex items-center justify-center">
      {/* Outer glow ring */}
      <motion.div
        className="absolute rounded-full"
        style={{ backgroundColor: config.glowColor }}
        animate={{
          width: 88 + (isActive ? amplitude * 24 : 0),
          height: 88 + (isActive ? amplitude * 24 : 0),
          opacity: isActive ? 0.3 + amplitude * 0.4 : 0.15,
        }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      />

      {/* Ripple rings (listening/speaking only) */}
      <AnimatePresence>
        {isActive && amplitude > 0.1 && (
          <>
            <motion.div
              key="ripple-1"
              className="absolute rounded-full border-2"
              style={{ borderColor: config.color }}
              initial={{ width: 72, height: 72, opacity: 0.5 }}
              animate={{ width: 120, height: 120, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.div
              key="ripple-2"
              className="absolute rounded-full border-2"
              style={{ borderColor: config.color }}
              initial={{ width: 72, height: 72, opacity: 0.3 }}
              animate={{ width: 140, height: 140, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                ease: "easeOut",
                delay: 0.3,
              }}
            />
          </>
        )}
      </AnimatePresence>

      {/* Processing spinner ring */}
      {state === "processing" && (
        <motion.div
          className="absolute w-[76px] h-[76px] rounded-full"
          style={{
            border: "2px solid transparent",
            borderTopColor: config.color,
            borderRightColor: config.color,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
      )}

      {/* Inner orb button */}
      <motion.button
        className="relative z-10 flex items-center justify-center w-16 h-16 rounded-full text-white shadow-lg"
        style={{ backgroundColor: config.color }}
        animate={{ scale }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 15 }}
        onClick={onTap}
        disabled={disabled}
        aria-label={
          state === "idle"
            ? "Start recording"
            : state === "listening"
              ? "Stop recording"
              : state === "processing"
                ? "Processing"
                : "Speaking"
        }
      >
        <Mic className="h-6 w-6" />
      </motion.button>

      {/* Idle breathing pulse */}
      {state === "idle" && (
        <motion.div
          className="absolute rounded-full"
          style={{ backgroundColor: config.glowColor }}
          animate={{
            width: [72, 80, 72],
            height: [72, 80, 72],
            opacity: [0.1, 0.2, 0.1],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </div>
  );
}
