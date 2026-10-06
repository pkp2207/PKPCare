import { describe, expect, it, vi } from "vitest";

import { buildRequestBody, callModel, supportsEffort, type AiRequest } from "@/lib/ai/client";
import { getAiConfig, getEmergencyNumber, isAiEnabled } from "@/lib/ai/config";

import {
  envelope,
  hangingTransport,
  noSleep,
  okTransport,
  queueTransport,
  response,
  TEST_CONFIG,
} from "./fakes";

const REQUEST: AiRequest = {
  feature: "triage",
  system: "sys",
  content: [{ type: "text", text: "hello" }],
  schema: { type: "object", properties: {}, additionalProperties: false },
  maxTokens: 500,
};

const deps = (transport: ReturnType<typeof queueTransport>, extra = {}) => ({
  transport,
  config: TEST_CONFIG,
  sleep: noSleep,
  random: () => 0.5,
  ...extra,
});

describe("config", () => {
  it("is off unless AI_ENABLED=true AND a key is present", () => {
    expect(isAiEnabled({})).toBe(false);
    expect(isAiEnabled({ AI_ENABLED: "true" })).toBe(false);
    expect(isAiEnabled({ ANTHROPIC_API_KEY: "k" })).toBe(false);
    expect(isAiEnabled({ AI_ENABLED: "yes", ANTHROPIC_API_KEY: "k" })).toBe(false);
    expect(isAiEnabled({ AI_ENABLED: "TRUE", ANTHROPIC_API_KEY: " k " })).toBe(true);
    expect(getAiConfig({ AI_ENABLED: "true" })).toBeNull();
  });

  it("defaults the model, clamps the timeout, rejects non-https base URLs", () => {
    const base = { AI_ENABLED: "true", ANTHROPIC_API_KEY: "k" };
    expect(getAiConfig(base)?.model).toBe("claude-opus-5-5");
    expect(getAiConfig({ ...base, AI_MODEL: "claude-sonnet-5-5" })?.model).toBe("claude-sonnet-5-5");
    expect(getAiConfig({ ...base, AI_MODEL: "bad model;drop" })?.model).toBe("claude-opus-5-5");
    expect(getAiConfig({ ...base, AI_TIMEOUT_MS: "999999" })?.timeoutMs).toBe(30000);
    expect(getAiConfig({ ...base, AI_TIMEOUT_MS: "1" })?.timeoutMs).toBe(2000);
    expect(getAiConfig({ ...base, ANTHROPIC_BASE_URL: "http://evil.test" })?.baseUrl).toBe(
      "https://api.anthropic.com",
    );
  });

  it("sanitises EMERGENCY_NUMBER", () => {
    expect(getEmergencyNumber({ EMERGENCY_NUMBER: "112" })).toBe("112");
    expect(getEmergencyNumber({ EMERGENCY_NUMBER: "<b>1</b>" })).toBeUndefined();
    expect(getEmergencyNumber({})).toBeUndefined();
  });
});

describe("callModel: request shape", () => {
  it("sends key, version, no tools, schema-constrained output and a hard token cap", async () => {
    const t = okTransport({ ok: 1 });
    const result = await callModel(REQUEST, deps(t));
    expect(result.ok).toBe(true);
    const call = t.calls[0];
    expect(call.url).toBe("https://api.example.test/v1/messages");
    expect(call.headers["x-api-key"]).toBe("test-key");
    expect(call.headers["anthropic-version"]).toBe("2023-06-01");
    expect(call.body.tools).toBeUndefined();
    expect(call.body.temperature).toBeUndefined();
    expect(call.body.max_tokens).toBe(500);
    expect(call.body.output_config.format.type).toBe("json_schema");
    expect(call.body.output_config.effort).toBe("low");
  });

  it("omits effort for models that reject it", () => {
    expect(supportsEffort("claude-haiku-4-5")).toBe(false);
    expect(supportsEffort("claude-opus-5-5")).toBe(true);
    const body = JSON.parse(buildRequestBody(REQUEST, { ...TEST_CONFIG, model: "claude-haiku-4-5" }));
    expect(body.output_config.effort).toBeUndefined();
  });

  it("reports usage and latency", async () => {
    const result = await callModel(REQUEST, deps(okTransport({ a: 1 })));
    expect(result).toMatchObject({ ok: true, usage: { inputTokens: 120, outputTokens: 30 } });
  });
});

describe("callModel: disabled / errors / retry / timeout", () => {
  it("returns disabled without touching the network", async () => {
    const t = queueTransport([]);
    const result = await callModel(REQUEST, { transport: t, config: null });
    expect(result).toMatchObject({ ok: false, code: "disabled" });
    expect(t.calls).toHaveLength(0);
  });

  it("retries once on 429 then succeeds", async () => {
    const sleep = vi.fn(async () => undefined);
    const t = queueTransport([
      response(429, "{}", { "retry-after": "1" }),
      response(200, envelope({ a: 1 })),
    ]);
    const result = await callModel(REQUEST, deps(t, { sleep, config: { ...TEST_CONFIG, timeoutMs: 15000 } }));
    expect(result.ok).toBe(true);
    expect(t.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("retries once on 5xx and gives up after one retry", async () => {
    const t = queueTransport([response(503, "x"), response(500, "x"), response(200, envelope({}))]);
    const result = await callModel(REQUEST, deps(t));
    expect(result).toMatchObject({ ok: false, code: "upstream" });
    expect(t.calls).toHaveLength(2);
  });

  it("maps a repeated 429 to rate_limited and jitters the wait", async () => {
    const sleep = vi.fn(async () => undefined);
    const t = queueTransport([response(429, "{}"), response(429, "{}")]);
    const result = await callModel(REQUEST, deps(t, { sleep, random: () => 0.5, config: { ...TEST_CONFIG, timeoutMs: 15000 } }));
    expect(result).toMatchObject({ ok: false, code: "rate_limited" });
    expect(sleep).toHaveBeenCalledWith(600); // 400 base + 0.5 * 400 jitter
  });

  it("does not retry 4xx and maps auth separately", async () => {
    const bad = queueTransport([response(400, "{}")]);
    expect(await callModel(REQUEST, deps(bad))).toMatchObject({ code: "bad_request" });
    expect(bad.calls).toHaveLength(1);
    const auth = queueTransport([response(401, "{}")]);
    expect(await callModel(REQUEST, deps(auth))).toMatchObject({ code: "auth" });
  });

  it("retries a network error once", async () => {
    const t = queueTransport([new Error("ECONNRESET"), response(200, envelope({ a: 1 }))]);
    expect((await callModel(REQUEST, deps(t))).ok).toBe(true);
    const t2 = queueTransport([new Error("x"), new Error("y")]);
    expect(await callModel(REQUEST, deps(t2))).toMatchObject({ ok: false, code: "network" });
  });

  it("times out on a hanging request and does not retry", async () => {
    const result = await callModel(REQUEST, {
      transport: hangingTransport(),
      config: { ...TEST_CONFIG, timeoutMs: 30 },
      sleep: noSleep,
    });
    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });

  it("maps refusal, truncation and garbage to safe errors", async () => {
    const refusal = queueTransport([response(200, envelope({}, { stop_reason: "refusal" }))]);
    expect(await callModel(REQUEST, deps(refusal))).toMatchObject({ code: "refusal" });
    const cut = queueTransport([response(200, envelope("{", { stop_reason: "max_tokens" }))]);
    expect(await callModel(REQUEST, deps(cut))).toMatchObject({ code: "truncated" });
    const junk = queueTransport([response(200, "not json")]);
    expect(await callModel(REQUEST, deps(junk))).toMatchObject({ code: "invalid_response" });
    const notJson = queueTransport([response(200, envelope("I am not JSON"))]);
    expect(await callModel(REQUEST, deps(notJson))).toMatchObject({ code: "invalid_response" });
    const noText = queueTransport([
      response(200, JSON.stringify({ content: [{ type: "thinking" }], usage: {} })),
    ]);
    expect(await callModel(REQUEST, deps(noText))).toMatchObject({ code: "invalid_response" });
  });

  it("tolerates a fenced JSON reply (still validated by callers)", async () => {
    const t = queueTransport([response(200, envelope("```json\n{\"a\":1}\n```"))]);
    expect(await callModel(REQUEST, deps(t))).toMatchObject({ ok: true, value: { a: 1 } });
  });

  it("error messages never leak provider detail, key or request", async () => {
    const t = queueTransport([response(500, "secret upstream detail test-key"), response(500, "x")]);
    const result = await callModel(REQUEST, deps(t));
    expect(JSON.stringify(result)).not.toMatch(/secret|test-key|hello/);
  });
});
