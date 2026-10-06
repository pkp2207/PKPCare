import { describe, expect, it } from "vitest";

import { createRateLimiter } from "@/lib/auth/rate-limit";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("createRateLimiter", () => {
  it("limits a key after `max` hits and not before", () => {
    const c = clock();
    const rl = createRateLimiter({ max: 3, windowMs: 1000, now: c.now });
    expect(rl.isLimited("a")).toBe(false);
    expect(rl.hit("a")).toBe(false);
    expect(rl.hit("a")).toBe(false);
    expect(rl.isLimited("a")).toBe(false);
    expect(rl.hit("a")).toBe(true);
    expect(rl.isLimited("a")).toBe(true);
  });

  it("tracks keys independently", () => {
    const c = clock();
    const rl = createRateLimiter({ max: 1, windowMs: 1000, now: c.now });
    rl.hit("a");
    expect(rl.isLimited("a")).toBe(true);
    expect(rl.isLimited("b")).toBe(false);
  });

  it("releases the key when the window elapses", () => {
    const c = clock();
    const rl = createRateLimiter({ max: 1, windowMs: 1000, now: c.now });
    rl.hit("a");
    c.advance(999);
    expect(rl.isLimited("a")).toBe(true);
    c.advance(2);
    expect(rl.isLimited("a")).toBe(false);
    expect(rl.hit("a")).toBe(true); // fresh window
  });

  it("does not extend the window on further hits", () => {
    const c = clock();
    const rl = createRateLimiter({ max: 2, windowMs: 1000, now: c.now });
    rl.hit("a");
    c.advance(600);
    rl.hit("a");
    c.advance(500);
    expect(rl.isLimited("a")).toBe(false);
  });

  it("reset clears a key", () => {
    const c = clock();
    const rl = createRateLimiter({ max: 1, windowMs: 1000, now: c.now });
    rl.hit("a");
    rl.reset("a");
    expect(rl.isLimited("a")).toBe(false);
  });

  it("bounds memory", () => {
    const c = clock();
    const rl = createRateLimiter({ max: 5, windowMs: 10_000, now: c.now, maxKeys: 1500 });
    for (let i = 0; i < 3000; i++) rl.hit(`k${i}`);
    expect(rl.size()).toBeLessThanOrEqual(3000);
    expect(rl.size()).toBeLessThan(3000); // cleared once it exceeded maxKeys
  });
});
