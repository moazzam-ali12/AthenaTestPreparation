"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";

type DifficultyStat = {
  difficulty: string;
  total: number;
  correct: number;
  accuracy: number;
};

const DIFFICULTY_ORDER = ["easy", "medium", "hard"];
const DIFFICULTY_COLOR: Record<string, string> = {
  easy: "var(--athena-success)",
  medium: "var(--athena-amber)",
  hard: "var(--destructive)",
};

export function AccuracyByDifficultyChart({ data }: { data: DifficultyStat[] }) {
  if (data.length === 0) {
    return (
      <div className="border bg-muted/30 p-6 h-full">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Accuracy by Difficulty
        </h2>
        <p className="mt-6 text-sm text-muted-foreground">
          Complete quizzes to see this breakdown.
        </p>
      </div>
    );
  }

  const chartData = [...data].sort(
    (a, b) => DIFFICULTY_ORDER.indexOf(a.difficulty) - DIFFICULTY_ORDER.indexOf(b.difficulty)
  );

  return (
    <div className="border bg-muted/30 p-6 h-full flex flex-col">
      <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Accuracy by Difficulty
      </h2>
      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barCategoryGap="35%">
            <XAxis
              dataKey="difficulty"
              tick={{ fontSize: 11 }}
              stroke="var(--muted-foreground)"
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: string) => v[0].toUpperCase() + v.slice(1)}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke="var(--muted-foreground)"
              tickLine={false}
              axisLine={false}
              width={40}
              domain={[0, 100]}
            />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                fontSize: 12,
              }}
              formatter={(value?: number) => [`${value ?? 0}%`, "Accuracy"]}
            />
            <Bar dataKey="accuracy" radius={[4, 4, 0, 0]} maxBarSize={56}>
              {chartData.map((d) => (
                <Cell key={d.difficulty} fill={DIFFICULTY_COLOR[d.difficulty] ?? "var(--foreground)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
