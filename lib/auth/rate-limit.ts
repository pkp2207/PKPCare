// Small in-memory fixed-window limiter.
//
// NOTE: in-memory and therefore per server instance. Counters reset on restart and
// are not shared across replicas/serverless invocations. Move to a shared store
// (Redis, database) for multi-instance deployments.

export type RateLimiterOptions = {
  max: number; // hits allowed per window before limiting
  windowMs: number;
  now?: () => number; // injectable clock (tests)
  maxKeys?: number; // hard memory bound
};

export type RateLimiter = {
  isLimited(key: string): boolean;
  // Records one hit (failure / request). Returns true if the key is now limited.
  hit(key: string): boolean;
  reset(key: string): void;
  size(): number;
};

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { max, windowMs } = options;
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10000;
  const entries = new Map<string, { count: number; resetAt: number }>();

  function prune(t: number) {
    if (entries.size < 1000) return;
    entries.forEach((entry, key) => {
      if (entry.resetAt <= t) entries.delete(key);
    });
    if (entries.size > maxKeys) entries.clear();
  }

  function live(key: string, t: number) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.resetAt <= t) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    isLimited(key) {
      const entry = live(key, now());
      return !!entry && entry.count >= max;
    },
    hit(key) {
      const t = now();
      prune(t);
      const entry = live(key, t) ?? { count: 0, resetAt: t + windowMs };
      entry.count += 1;
      entries.set(key, entry);
      return entry.count >= max;
    },
    reset(key) {
      entries.delete(key);
    },
    size() {
      return entries.size;
    },
  };
}
