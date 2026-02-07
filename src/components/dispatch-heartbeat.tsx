"use client";

import { useEffect } from "react";

const DISPATCH_INTERVAL_MS = 60_000;

async function triggerDueDispatch() {
  if (document.visibilityState !== "visible") return;
  try {
    await fetch("/api/calls/dispatch-due", { method: "POST" });
  } catch {
    // Ignore transient network failures.
  }
}

export function DispatchHeartbeat() {
  useEffect(() => {
    void triggerDueDispatch();
    const timer = window.setInterval(() => {
      void triggerDueDispatch();
    }, DISPATCH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
