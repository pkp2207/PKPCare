"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the (server) page once `at` has passed, so a patient waiting on
 * the "not open yet" screen gets the join button without reloading.
 */
export const AutoRefresh = ({ at }: { at: string }) => {
  const router = useRouter();

  useEffect(() => {
    const target = Date.parse(at);
    if (Number.isNaN(target)) return undefined;
    const timer = setInterval(() => {
      if (Date.now() >= target) {
        clearInterval(timer);
        router.refresh();
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [at, router]);

  return null;
};
