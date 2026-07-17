"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

type SectionData = {
  subject: string;
  total: number;
  correct: number;
  accuracy: number;
  scaledScore: number;
};

type SectionPerformanceChartProps = {
  sectionScores: {
    aud: SectionData;
    far: SectionData;
    reg: SectionData;
    bar: SectionData;
    isc: SectionData;
    tcp: SectionData;
  };
};

export function SectionPerformanceChart({ sectionScores }: SectionPerformanceChartProps) {
  const chartData = Object.values(sectionScores)
    .filter((s) => s.total > 0)
    .map((s) => ({
      subject: s.subject.toUpperCase(),
      accuracy: s.accuracy,
    }));

  if (chartData.length === 0) {
    return (
      <div className="border bg-muted/30 p-6 h-full">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Section Performance
        </h2>
        <p className="mt-6 text-sm text-muted-foreground">
          Complete quizzes across sections to see this breakdown.
        </p>
      </div>
    );
  }

  return (
    <div className="border bg-muted/30 p-6 h-full flex flex-col">
      <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Section Performance
      </h2>
      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barCategoryGap="35%">
            <XAxis
              dataKey="subject"
              tick={{ fontSize: 11 }}
              stroke="var(--muted-foreground)"
              tickLine={false}
              axisLine={false}
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
            <Bar dataKey="accuracy" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={56} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
