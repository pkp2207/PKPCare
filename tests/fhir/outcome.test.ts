import { describe, expect, it } from "vitest";

import {
  badRequest,
  forbidden,
  methodNotAllowed,
  notEnabled,
  notFound,
  operationOutcome,
  serverError,
  tooManyRequests,
  unauthorized,
} from "@/lib/fhir/outcome";

describe("OperationOutcome", () => {
  it("has the FHIR shape", () => {
    expect(operationOutcome("invalid", "bad")).toEqual({
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: "invalid", details: { text: "bad" } }],
    });
  });

  it.each([
    ["notEnabled", notEnabled(), 404, "not-found"],
    ["methodNotAllowed", methodNotAllowed(), 405, "not-supported"],
    ["unauthorized", unauthorized(), 401, "login"],
    ["forbidden", forbidden(), 403, "forbidden"],
    ["notFound", notFound(), 404, "not-found"],
    ["badRequest", badRequest("x"), 400, "invalid"],
    ["tooManyRequests", tooManyRequests(30), 429, "throttled"],
    ["serverError", serverError(), 500, "exception"],
  ])("%s", async (_name, res, status, code) => {
    expect(res.status).toBe(status);
    expect(res.headers.get("content-type")).toBe("application/fhir+json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await res.json();
    expect(json.resourceType).toBe("OperationOutcome");
    expect(json.issue[0].code).toBe(code);
  });

  it("sets protocol headers", () => {
    expect(methodNotAllowed().headers.get("allow")).toBe("GET");
    expect(unauthorized().headers.get("www-authenticate")).toBe('Bearer realm="fhir"');
    expect(tooManyRequests(0).headers.get("retry-after")).toBe("1");
  });

  it("server error never leaks detail", async () => {
    const text = JSON.stringify(await serverError().json());
    expect(text).not.toMatch(/stack|Error:|node_modules/);
  });
});
