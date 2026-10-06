"use client";

import { useEffect, useState } from "react";

import { getAiStatus } from "@/lib/actions/ai.actions";

export type AiStatus = { enabled: boolean; emergencyNumber?: string };

// Cached for the lifetime of the page (module scope) so several AI components
// share one cheap, model-free server call.
const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; promise: Promise<AiStatus | null> } | null = null;

const load = (): Promise<AiStatus | null> => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = getAiStatus()
    .then((result) => (result.ok ? result.data : null))
    .catch(() => null);
  cache = { at: Date.now(), promise };
  // Do not cache failures.
  promise.then((value) => {
    if (value === null && cache?.promise === promise) cache = null;
  });
  return promise;
};

/** `undefined` while loading, `null` if the status could not be read. */
export function useAiStatus(): AiStatus | null | undefined {
  const [status, setStatus] = useState<AiStatus | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    load().then((value) => {
      if (active) setStatus(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return status;
}
