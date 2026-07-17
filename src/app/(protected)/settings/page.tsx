"use client";

import { Suspense } from "react";
import { NotificationToggle } from "@/components/settings/notification-toggle";
import { CanvasIntegration } from "@/components/settings/canvas-integration";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your notifications and integrations
        </p>
      </div>

      {/* Notifications */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Notifications
        </h2>
        <div className="rounded-xl border border-border bg-card p-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Push Notifications</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Get reminders for daily quests and streaks
            </p>
          </div>
          <NotificationToggle />
        </div>
      </section>

      {/* Integrations */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Integrations
        </h2>
        <Suspense fallback={<div className="rounded-xl border border-border bg-card p-6 h-24 animate-pulse" />}>
          <CanvasIntegration />
        </Suspense>
      </section>
    </div>
  );
}
