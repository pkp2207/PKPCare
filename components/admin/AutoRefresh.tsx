"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ui } from "./ui";

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

/**
 * Polling stand-in for live updates: calls router.refresh() every `intervalMs`
 * while the tab is visible, the user has not paused, and no dialog is open.
 * Swap to Appwrite Realtime later: subscribe to the appointments collection
 * channel in an effect and call `refresh()` from the callback (see
 * docs/admin.md); the visible control can stay.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const lastRef = useRef(0);

  const refresh = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    if (document.querySelector(DIALOG_SELECTOR)) return;
    lastRef.current = Date.now();
    router.refresh();
    setUpdatedAt(new Date());
  }, [router]);

  useEffect(() => {
    lastRef.current = Date.now();
    setUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(refresh, intervalMs);
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRef.current >= intervalMs
      ) {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [paused, intervalMs, refresh]);

  const time = updatedAt
    ? updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--:--";

  return (
    <div className="text-12-regular flex items-center gap-2 text-dark-700">
      <span>
        {paused ? "Auto-refresh paused" : "Updated"} {time}
      </span>
      <span aria-hidden="true">&middot;</span>
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-pressed={paused}
        className={`${ui.btnGhost} ${ui.btnSm} text-12-semibold`}
      >
        {paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
}
