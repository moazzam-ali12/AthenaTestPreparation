import { cn } from "@/lib/utils";
import { effectiveBand, MAX_LEVEL } from "@/lib/adaptive/engine";

const BAND_LABEL = {
  easy: "Easy questions",
  medium: "Medium questions",
  hard: "Hard questions",
} as const;

function formatLevel(level: number) {
  return Number.isInteger(level) ? String(level) : level.toFixed(1);
}

/** Skill level (1-10) with a progress bar and the question tier it unlocks. */
export function SkillLevel({
  level,
  overallLevel = 1,
  showBand = true,
  className,
}: {
  level: number | null | undefined;
  /** Raises the shown question tier to the overall level's difficulty floor. */
  overallLevel?: number;
  showBand?: boolean;
  className?: string;
}) {
  // Responses cached before the level field existed (or a missing skill row)
  // can hand us undefined — render nothing rather than crash the page.
  if (typeof level !== "number" || !Number.isFinite(level)) return null;

  const pct = Math.min(100, Math.max(0, (level / MAX_LEVEL) * 100));

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold tabular-nums">
          Level {formatLevel(level)}
          <span className="font-normal text-muted-foreground"> / {MAX_LEVEL}</span>
        </span>
        {showBand && (
          <span className="text-muted-foreground">
            {BAND_LABEL[effectiveBand(Math.round(level), overallLevel)]}
          </span>
        )}
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={MAX_LEVEL}
        aria-valuenow={level}
        aria-label={`Skill level ${formatLevel(level)} of ${MAX_LEVEL}`}
      >
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
