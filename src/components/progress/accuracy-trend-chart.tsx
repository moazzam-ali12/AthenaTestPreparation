"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";

type AccuracyPoint = {
  date: string;
  accuracy: number;
};

// CPA passing threshold, shown as a benchmark line on the trend.
const PASS_BENCHMARK = 75;

export function AccuracyTrendChart({ data }: { data: AccuracyPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="border bg-muted/30 p-6 h-full">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Accuracy Over Time
        </h2>
        <p className="mt-6 text-sm text-muted-foreground">
          Complete quizzes to see your accuracy trend.
        </p>
      </div>
    );
  }

  // Label each session sequentially; keep the date for the tooltip.
  const chartData = data.map((p, i) => ({
    label: `#${i + 1}`,
    date: p.date,
    accuracy: p.accuracy,
  }));

  return (
    <div className="border bg-muted/30 p-6 h-full flex flex-col">
      <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Accuracy Over Time
      </h2>
      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              stroke="var(--muted-foreground)"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
              stroke="var(--muted-foreground)"
              tickLine={false}
              axisLine={false}
              width={40}
              unit="%"
            />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                fontSize: 12,
              }}
              formatter={(value) => [`${value}%`, "Accuracy"]}
              labelFormatter={(_label, payload) =>
                payload?.[0]?.payload?.date ?? ""
              }
            />
            <ReferenceLine
              y={PASS_BENCHMARK}
              stroke="var(--athena-success, #22c55e)"
              strokeDasharray="4 4"
              label={{
                value: `Pass ${PASS_BENCHMARK}%`,
                position: "insideTopRight",
                fontSize: 10,
                fill: "var(--muted-foreground)",
              }}
            />
            <Line
              type="monotone"
              dataKey="accuracy"
              stroke="var(--foreground)"
              strokeWidth={2}
              dot={{
                r: 4,
                fill: "var(--background)",
                stroke: "var(--foreground)",
                strokeWidth: 2,
              }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
