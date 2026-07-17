"use client";

import { useEffect } from "react";

// Eagerly registers the service worker so push notifications are received
// even before the user opens the notification settings.
export function SwProvider() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("Service worker registration failed:", err);
      });
    }
  }, []);

  return null;
}
