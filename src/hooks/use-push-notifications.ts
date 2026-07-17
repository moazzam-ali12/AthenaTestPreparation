"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type PushState = "unsupported" | "denied" | "default" | "subscribed";

export function usePushNotifications() {
  const [state, setState] = useState<PushState>("default");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    // Check if already subscribed
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) setState("subscribed");
      })
    );
  }, []);

  const subscribe = useCallback(async () => {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      toast.error("Push notifications are not configured yet.");
      return;
    }

    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return;
      }

      // Register (or reuse) the SW, then wait for it to be active
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const subJson = sub.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subJson),
      });

      if (!res.ok) {
        // Rollback browser subscription if server save failed
        await sub.unsubscribe().catch(() => {});
        throw new Error("Failed to save subscription");
      }

      setState("subscribed");
      toast.success("Notifications enabled!");
    } catch (err) {
      console.error("Push subscribe error:", err);
      toast.error("Could not enable notifications. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        // Remove from server first; if that fails, keep local subscription intact
        const res = await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });

        if (!res.ok) throw new Error("Failed to unsubscribe on server");

        await sub.unsubscribe();
      }

      setState("default");
    } catch (err) {
      console.error("Push unsubscribe error:", err);
      toast.error("Could not disable notifications. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback(() => {
    if (state === "subscribed") return unsubscribe();
    return subscribe();
  }, [state, subscribe, unsubscribe]);

  return { state, loading, toggle };
}
