import { afterEach, describe, expect, it, vi } from "vitest";

import { getRoom, isTelehealthEnabled } from "@/lib/telehealth";
import { getProviderName, resolveJitsiBaseUrl } from "@/lib/telehealth/providers";
import { base32, deriveRoomName } from "@/lib/telehealth/room";

afterEach(() => vi.unstubAllEnvs());

const START = "2026-10-08T10:00:00.000Z";

describe("deriveRoomName", () => {
  it("is deterministic and well formed", () => {
    const a = deriveRoomName("appt1", START, "secret-one");
    expect(a).toBe(deriveRoomName("appt1", START, "secret-one"));
    expect(a).toMatch(/^pkp-[a-z2-7]{24}$/);
  });

  it("treats Date and ISO string for the same instant alike", () => {
    expect(deriveRoomName("appt1", new Date(START), "s")).toBe(
      deriveRoomName("appt1", "2026-10-08T15:30:00.000+05:30", "s"),
    );
  });

  it("differs by secret, appointment and start time", () => {
    const base = deriveRoomName("appt1", START, "secret-one");
    expect(deriveRoomName("appt1", START, "secret-two")).not.toBe(base);
    expect(deriveRoomName("appt2", START, "secret-one")).not.toBe(base);
    expect(deriveRoomName("appt1", "2026-10-08T10:30:00.000Z", "secret-one")).not.toBe(base);
  });

  it("does not contain the appointment id or time", () => {
    const name = deriveRoomName("appt1", START, "secret-one");
    expect(name).not.toContain("appt1");
    expect(name).not.toContain("2026");
  });

  it("uses TELEHEALTH_ROOM_SECRET over ADMIN_SESSION_SECRET and fails closed with neither", () => {
    vi.stubEnv("TELEHEALTH_ROOM_SECRET", "");
    vi.stubEnv("ADMIN_SESSION_SECRET", "admin");
    const viaAdmin = deriveRoomName("a", START);
    expect(viaAdmin).toBe(deriveRoomName("a", START, "admin"));
    vi.stubEnv("TELEHEALTH_ROOM_SECRET", "room");
    expect(deriveRoomName("a", START)).toBe(deriveRoomName("a", START, "room"));
    vi.stubEnv("TELEHEALTH_ROOM_SECRET", "");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    expect(() => deriveRoomName("a", START)).toThrow(/not configured/);
  });

  it("rejects an invalid start", () => {
    expect(() => deriveRoomName("a", "nope", "s")).toThrow();
  });

  it("base32 matches RFC 4648 vectors (lowercase, unpadded)", () => {
    const enc = (s: string) => base32(new TextEncoder().encode(s));
    expect(enc("f")).toBe("my");
    expect(enc("fo")).toBe("mzxq");
    expect(enc("foobar")).toBe("mzxw6ytboi");
  });
});

describe("providers", () => {
  it("defaults to none / disabled", async () => {
    expect(getProviderName()).toBe("none");
    expect(isTelehealthEnabled()).toBe(false);
    await expect(getRoom({ appointmentId: "a", start: START })).rejects.toThrow();
  });

  it("jitsi builds a room url on the configured base", async () => {
    vi.stubEnv("TELEHEALTH_PROVIDER", "jitsi");
    vi.stubEnv("TELEHEALTH_ROOM_SECRET", "s");
    vi.stubEnv("TELEHEALTH_BASE_URL", "https://meet.example.org/");
    expect(isTelehealthEnabled()).toBe(true);
    const { url } = await getRoom({ appointmentId: "a", start: START });
    expect(url.startsWith(`https://meet.example.org/${deriveRoomName("a", START, "s")}#`)).toBe(
      true,
    );
  });

  it("defaults the base to meet.jit.si; unknown provider means none", async () => {
    vi.stubEnv("TELEHEALTH_PROVIDER", "jitsi");
    vi.stubEnv("TELEHEALTH_ROOM_SECRET", "s");
    vi.stubEnv("TELEHEALTH_BASE_URL", "");
    expect((await getRoom({ appointmentId: "a", start: START })).url).toMatch(
      /^https:\/\/meet\.jit\.si\/pkp-/,
    );
    vi.stubEnv("TELEHEALTH_PROVIDER", "zoom");
    expect(isTelehealthEnabled()).toBe(false);
  });

  it("requires https except for localhost", () => {
    expect(() => resolveJitsiBaseUrl("http://meet.example.org")).toThrow(/https/);
    expect(() => resolveJitsiBaseUrl("not a url")).toThrow();
    expect(resolveJitsiBaseUrl("http://localhost:8443/")).toBe("http://localhost:8443");
    expect(resolveJitsiBaseUrl("https://h.example/jitsi/?x=1#y")).toBe("https://h.example/jitsi");
  });
});
