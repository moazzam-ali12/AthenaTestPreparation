import { useCallback, useRef } from "react";

let audioCtx: AudioContext | null = null;

function getCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function playTone(freq: number, duration: number, type: OscillatorType = "sine", vol = 0.15) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

export function useSound() {
  const lastPlayed = useRef(0);

  const throttle = useCallback((fn: () => void, ms = 100) => {
    const now = Date.now();
    if (now - lastPlayed.current > ms) {
      lastPlayed.current = now;
      fn();
    }
  }, []);

  const correct = useCallback(() => {
    throttle(() => {
      playTone(523, 0.15, "sine", 0.12);
      setTimeout(() => playTone(659, 0.15, "sine", 0.12), 100);
      setTimeout(() => playTone(784, 0.2, "sine", 0.12), 200);
    });
  }, [throttle]);

  const wrong = useCallback(() => {
    throttle(() => {
      playTone(200, 0.2, "square", 0.06);
      setTimeout(() => playTone(180, 0.3, "square", 0.06), 150);
    });
  }, [throttle]);

  const click = useCallback(() => {
    throttle(() => playTone(800, 0.05, "sine", 0.08), 50);
  }, [throttle]);

  const complete = useCallback(() => {
    throttle(() => {
      const notes = [523, 659, 784, 1047];
      notes.forEach((n, i) => {
        setTimeout(() => playTone(n, 0.3, "sine", 0.1), i * 120);
      });
    });
  }, [throttle]);

  const pop = useCallback(() => {
    throttle(() => playTone(600, 0.08, "sine", 0.1), 30);
  }, [throttle]);

  const whoosh = useCallback(() => {
    throttle(() => {
      try {
        const ctx = getCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch {}
    });
  }, [throttle]);

  const achievement = useCallback(() => {
    throttle(() => {
      // Triumphant fanfare
      const notes = [523, 659, 784, 1047, 1319];
      notes.forEach((n, i) => {
        setTimeout(() => playTone(n, 0.25, "sine", 0.1), i * 100);
      });
      setTimeout(() => playTone(1047, 0.5, "triangle", 0.08), 500);
    });
  }, [throttle]);

  const levelUp = useCallback(() => {
    throttle(() => {
      const notes = [262, 330, 392, 523, 659, 784];
      notes.forEach((n, i) => {
        setTimeout(() => playTone(n, 0.2, "sine", 0.1), i * 80);
      });
    });
  }, [throttle]);

  return { correct, wrong, click, complete, pop, whoosh, achievement, levelUp };
}
