"use client";

import { Bell, BellOff } from "lucide-react";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { cn } from "@/lib/utils";

export function NotificationToggle({ className }: { className?: string }) {
  const { state, loading, toggle } = usePushNotifications();

  if (state === "unsupported") return null;

  const enabled = state === "subscribed";
  const denied = state === "denied";

  return (
    <button
      onClick={denied ? undefined : toggle}
      disabled={loading || denied}
      title={
        denied
          ? "Notifications blocked — enable in browser settings"
          : enabled
            ? "Turn off notifications"
            : "Turn on notifications"
      }
      className={cn(
        "flex items-center gap-2 text-xs font-medium transition-colors disabled:opacity-50",
        enabled
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground",
        denied && "cursor-not-allowed",
        className
      )}
    >
      {enabled ? (
        <Bell className="h-4 w-4" />
      ) : (
        <BellOff className="h-4 w-4" />
      )}
      <span>
        {loading
          ? "…"
          : denied
            ? "Notifications blocked"
            : enabled
              ? "Notifications on"
              : "Enable notifications"}
      </span>
    </button>
  );
}
