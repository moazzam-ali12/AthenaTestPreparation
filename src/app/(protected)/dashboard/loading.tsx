export default function DashboardLoading() {
  return (
    <div className="relative p-6">
      <div className="mx-auto max-w-6xl">
        {/* WelcomeHeader — flex p-6, no border/radius */}
        <div className="h-28 bg-muted animate-pulse" />

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Left column */}
          <div className="space-y-5 lg:col-span-3">
            {/* RankCard — border bg-card p-6: icon row + text-5xl score + progress bar + weapons row ≈ 296px */}
            <div className="h-72 bg-muted animate-pulse" />
            {/* DailyStudyReminder — border bg-card px-5 py-3, single line ≈ 44px */}
            <div className="h-11 bg-muted animate-pulse" />
            {/* DailyQuestCard — border-2 rounded-lg */}
            <div className="h-32 bg-muted animate-pulse rounded-lg" />
            {/* CpaExamCard — rounded-xl border bg-card p-5 + two skeleton lines ≈ 88px */}
            <div className="h-24 bg-muted animate-pulse rounded-xl" />
            {/* QuestStreak — border bg-card p-5, no radius */}
            <div className="h-28 bg-muted animate-pulse" />
            {/* BattleZones — border bg-card p-5, no radius */}
            <div className="h-44 bg-muted animate-pulse" />
          </div>

          {/* Right column */}
          <div className="space-y-5 lg:col-span-2">
            {/* CompanionCard — border bg-card p-5, single flex row h-10 ≈ 80px */}
            <div className="h-20 bg-muted animate-pulse" />
            {/* StatsCards — grid grid-cols-2 gap-3, two cards side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div className="h-20 bg-muted animate-pulse" />
              <div className="h-20 bg-muted animate-pulse" />
            </div>
            {/* FriendsLeaderboard — border bg-card p-5, no radius */}
            <div className="h-32 bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
