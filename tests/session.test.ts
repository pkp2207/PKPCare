import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSessionToken,
  safeEqual,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from "@/lib/auth/session";

const SECRET = "test-secret-".padEnd(48, "x");

function b64url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

describe("session constants", () => {
  it("exposes a cookie name and positive TTL", () => {
    expect(typeof SESSION_COOKIE).toBe("string");
    expect(SESSION_COOKIE.length).toBeGreaterThan(0);
    expect(SESSION_TTL_SECONDS).toBeGreaterThan(0);
  });
});

describe("session tokens", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round trips", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(token, SECRET)).toBe(true);
  });

  it("rejects a wrong secret", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(token, "another-secret")).toBe(false);
  });

  it("rejects a tampered payload", async () => {
    const token = await createSessionToken(SECRET);
    const [, signature] = token.split(".");
    const forged = b64url(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 })
    );
    expect(await verifySessionToken(`${forged}.${signature}`, SECRET)).toBe(
      false
    );
  });

  it("rejects a tampered signature", async () => {
    const token = await createSessionToken(SECRET);
    const [payload, signature] = token.split(".");
    const flipped =
      (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    expect(await verifySessionToken(`${payload}.${flipped}`, SECRET)).toBe(
      false
    );
    expect(await verifySessionToken(`${payload}.`, SECRET)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await createSessionToken(SECRET, 1);
    expect(await verifySessionToken(token, SECRET)).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(await verifySessionToken(token, SECRET)).toBe(false);
  });

  it("expires after the default TTL", async () => {
    const token = await createSessionToken(SECRET);
    vi.advanceTimersByTime((SESSION_TTL_SECONDS - 60) * 1000);
    expect(await verifySessionToken(token, SECRET)).toBe(true);
    vi.advanceTimersByTime(120 * 1000);
    expect(await verifySessionToken(token, SECRET)).toBe(false);
  });

  it.each([undefined, "", "garbage", "a.b", "a.b.c", ".", "..", "%%%.%%%"])(
    "returns false (never throws) for %j",
    async (token) => {
      await expect(verifySessionToken(token, SECRET)).resolves.toBe(false);
    }
  );
});

describe("safeEqual", () => {
  it("is true for equal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("", "")).toBe(true);
  });

  it("is false for unequal strings", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("is false for different lengths", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abcd", "abc")).toBe(false);
    expect(safeEqual("", "a")).toBe(false);
  });
});
