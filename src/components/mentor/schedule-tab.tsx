"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect } from "react";
import { CalendarDays, Clock } from "lucide-react";
import { ScheduleEditor } from "@/components/profile/schedule-editor";

type ScheduleSlot = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
};

type UpcomingSession = {
  date: Date;
  dayLabel: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  isToday: boolean;
};

const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatTimeStr(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function getUpcomingSessions(schedules: ScheduleSlot[]): UpcomingSession[] {
  const sessions: UpcomingSession[] = [];
  const now = new Date();
  const todayIdx = now.getDay();
  const todayStr = now.toISOString().split("T")[0];

  for (const slot of schedules) {
    if (!slot.isActive) continue;
    const targetIdx = DAY_INDEX[slot.dayOfWeek];
    if (targetIdx === undefined) continue;

    let daysUntil = targetIdx - todayIdx;
    if (daysUntil < 0) daysUntil += 7;

    // If same day but session time has already passed, push to next week
    if (daysUntil === 0) {
      const [h, m] = slot.startTime.split(":").map(Number);
      const sessionMins = h * 60 + m;
      const nowMins = now.getHours() * 60 + now.getMinutes();
      if (nowMins >= sessionMins) daysUntil = 7;
    }

    const sessionDate = new Date(now);
    sessionDate.setDate(now.getDate() + daysUntil);
    sessionDate.setHours(0, 0, 0, 0);
    const sessionDateStr = sessionDate.toISOString().split("T")[0];

    sessions.push({
      date: sessionDate,
      dayLabel: DAY_NAMES[targetIdx],
      dateLabel: sessionDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      startTime: formatTimeStr(slot.startTime),
      endTime: formatTimeStr(slot.endTime),
      isToday: sessionDateStr === todayStr,
    });
  }

  return sessions
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 7);
}

export function MentorScheduleTab() {
  const { data, isLoading, isError } = useQuery<{ schedules: ScheduleSlot[] }>({
    queryKey: ["profile-schedule"],
    queryFn: () =>
      fetch("/api/profile/schedule").then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      }),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (isError) toast.error("Failed to load schedule");
  }, [isError]);

  const schedules = data?.schedules ?? [];
  const upcoming = getUpcomingSessions(schedules);

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse bg-muted rounded" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold">Study Schedule</h2>
          <p className="text-sm text-muted-foreground">Your upcoming sessions</p>
        </div>
        <ScheduleEditor triggerOnly />
      </div>

      {upcoming.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium">No schedule set yet</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Set a weekly study schedule to get session reminders and stay consistent.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {upcoming.map((session, i) => (
            <div
              key={i}
              className={`flex items-center gap-4 rounded-lg border p-4 ${
                session.isToday
                  ? "border-foreground/30 bg-foreground/5"
                  : "bg-card"
              }`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                {session.isToday ? "TODAY" : session.dayLabel.slice(0, 3).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">
                  {session.isToday ? "Today" : session.dayLabel}
                  <span className="ml-2 text-muted-foreground font-normal">
                    {session.dateLabel}
                  </span>
                </p>
                <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                  <Clock className="h-3.5 w-3.5" />
                  {session.startTime} – {session.endTime}
                </div>
              </div>
              {session.isToday && (
                <span className="shrink-0 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-semibold text-background">
                  Now
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
