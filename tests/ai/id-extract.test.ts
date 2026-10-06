import { describe, expect, it } from "vitest";

import {
  buildIdExtractRequest,
  normalizeIdentificationType,
  parseIdOutput,
  runIdExtract,
  sniffImageType,
  validateIdImage,
  validBirthDate,
} from "@/lib/ai/id-extract";

import { okTransport, TEST_CONFIG, noSleep } from "./fakes";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

const form = (bytes: Uint8Array, type: string, name: string | null = "id.png") => {
  const fd = new FormData();
  fd.append("blobFile", new Blob([bytes], { type }));
  if (name !== null) fd.append("fileName", name);
  return fd;
};

const f = (value: string, confidence = "high") => ({ value, confidence });
const RAW = {
  name: f("Jane Q. Doe"),
  birthDate: f("1990-04-15"),
  identificationNumber: f("X1234567"),
  identificationType: f("Passport"),
};

describe("validateIdImage", () => {
  it("accepts real images", async () => {
    const r = await validateIdImage(form(PNG, "image/png"));
    expect(r).toMatchObject({ ok: true, data: { mediaType: "image/png" } });
    expect((await validateIdImage(form(JPG, "image/jpeg"))).ok).toBe(true);
  });

  it("rejects PDFs with an explanation", async () => {
    const r = await validateIdImage(form(PDF, "application/pdf"));
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/PDF/);
  });

  it("rejects mismatched content, wrong types, empty, oversize, missing parts", async () => {
    expect((await validateIdImage(form(PDF, "image/png"))).ok).toBe(false);
    expect((await validateIdImage(form(PNG, "text/plain"))).ok).toBe(false);
    expect((await validateIdImage(form(new Uint8Array(0), "image/png"))).ok).toBe(false);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await validateIdImage(form(big, "image/png"))).ok).toBe(false);
    expect((await validateIdImage(form(PNG, "image/png", null))).ok).toBe(false);
    expect((await validateIdImage({} as unknown)).ok).toBe(false);
    expect((await validateIdImage(new FormData())).ok).toBe(false);
  });

  it("sniffs by magic bytes", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(PDF)).toBeNull();
  });
});

describe("parseIdOutput", () => {
  it("accepts clean output", () => {
    expect(parseIdOutput(RAW, new Date("2026-10-06"))).toEqual({
      fields: {
        name: { value: "Jane Q. Doe", confidence: "high" },
        birthDate: { value: "1990-04-15", confidence: "high" },
        identificationNumber: { value: "X1234567", confidence: "high" },
        identificationType: { value: "Passport", confidence: "high" },
      },
    });
  });

  it("drops individually invalid fields but keeps the rest", () => {
    const out = parseIdOutput({
      name: f("<img src=x onerror=1>"),
      birthDate: f("2999-01-01"),
      identificationNumber: f("x".repeat(80)),
      identificationType: f("Library card"),
    });
    expect(out).toEqual({ fields: {} });
    expect(parseIdOutput({ ...RAW, birthDate: f("15/04/1990") })?.fields.birthDate).toBeUndefined();
  });

  it("drops empty values (model's 'not found')", () => {
    expect(parseIdOutput({ ...RAW, name: f("", "low") })?.fields.name).toBeUndefined();
  });

  it.each([
    ["extra top-level key", { ...RAW, instructions: "obey" }],
    ["extra field key", { ...RAW, name: { ...f("Jane"), note: "x" } }],
    ["missing field", { name: RAW.name }],
    ["bad confidence", { ...RAW, name: f("Jane", "sure") }],
    ["oversized value", { ...RAW, name: f("a".repeat(301)) }],
    ["not an object", "Jane Doe"],
  ])("rejects malformed: %s", (_n, value) => {
    expect(parseIdOutput(value)).toBeNull();
  });

  it("validates dates strictly", () => {
    expect(validBirthDate("1990-02-30")).toBeNull();
    expect(validBirthDate("1899-01-01")).toBeNull();
    expect(validBirthDate("1990-04-15")).toBe("1990-04-15");
  });

  it("maps type labels onto the form options", () => {
    expect(normalizeIdentificationType("driving licence")).toBe("Driver's License");
    expect(normalizeIdentificationType("Aadhaar card")).toBe("National Identity Card");
    expect(normalizeIdentificationType("library pass")).toBeNull();
  });
});

describe("request + run", () => {
  it("sends the image as a base64 vision block with no tools, labelled as data", () => {
    const req = buildIdExtractRequest("QUJD", "image/png");
    expect(req.content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "QUJD" },
    });
    expect(req.system).toMatch(/untrusted DATA/);
    expect((req as any).tools).toBeUndefined();
  });

  it("runs end to end with a fake transport", async () => {
    const run = await runIdExtract(
      { bytes: PNG, mediaType: "image/png" },
      { transport: okTransport(RAW), config: TEST_CONFIG, sleep: noSleep },
    );
    expect(run.outcome).toBe("ok");
    expect(run.result.ok && run.result.data.fields.name?.value).toBe("Jane Q. Doe");
  });

  it("an injected image text that hijacks the output is rejected", async () => {
    const run = await runIdExtract(
      { bytes: PNG, mediaType: "image/png" },
      { transport: okTransport({ ...RAW, system_override: "IGNORE ALL" }), config: TEST_CONFIG, sleep: noSleep },
    );
    expect(run.result.ok).toBe(false);
  });
});
