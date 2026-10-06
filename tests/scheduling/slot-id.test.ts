import { describe, expect, it } from "vitest";

import { IdSchema } from "@/lib/validation";
import { slotId } from "@/lib/scheduling/slot-id";

describe("slotId", () => {
  const start = new Date("2026-10-08T10:00:00.000Z");

  it("is deterministic and independent of input representation", () => {
    const a = slotId("doc1", start);
    expect(a).toBe(slotId("doc1", new Date(start)));
    expect(a).toBe(slotId("doc1", start.getTime()));
    expect(a).toBe(slotId("doc1", start.toISOString()));
    expect(a).toBe(`doc1_${start.getTime()}`);
  });

  it("differs per doctor and per start", () => {
    expect(slotId("doc1", start)).not.toBe(slotId("doc2", start));
    expect(slotId("doc1", start)).not.toBe(
      slotId("doc1", new Date(start.getTime() + 1800_000))
    );
  });

  it("is a legal Appwrite id for typical ids", () => {
    const id = slotId("65f0c1a2b3d4e5f6a7b8", start); // 20-char ID.unique()
    expect(id.length).toBeLessThanOrEqual(36);
    expect(IdSchema.safeParse(id).success).toBe(true);
  });

  it("falls back to a stable hash for long or unusual doctor ids", () => {
    const long = slotId("a".repeat(36), start);
    expect(long).toMatch(/^h[0-9a-f]{35}$/);
    expect(long).toBe(slotId("a".repeat(36), start));
    const odd = slotId("dr smith/é", start);
    expect(IdSchema.safeParse(odd).success).toBe(true);
    expect(odd).not.toBe(slotId("dr smith/e", start));
  });

  it("rejects invalid dates", () => {
    expect(() => slotId("doc1", "nope")).toThrow();
  });
});
