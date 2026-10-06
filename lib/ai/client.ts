// Minimal Anthropic Messages API client over `fetch` (no SDK dependency).
// Server only. The model has NO tools: requests carry no `tools`, the output is
// constrained with a JSON schema (`output_config.format`) and the caller must
// still validate the parsed value (model output is untrusted).
//
// Request shape confirmed against the Claude API reference on 2026-10-06:
//   POST {base}/v1/messages
//   headers: x-api-key, anthropic-version: 2023-06-01, content-type: application/json
//   body: { model, max_tokens, system, messages:[{role:"user",content:[...]}],
//           output_config:{ effort?, format:{type:"json_schema", schema} } }
// Sampling parameters (temperature/top_p/top_k) are intentionally omitted: they are
// rejected by current models. Vision input is a base64 `image` content block.
import { z } from "zod";

import { AI_NOT_ENABLED_MESSAGE, getAiConfig, type AiConfig } from "./config";

export type AiFeature = "triage" | "id_extract" | "visit_summary";

export type AiErrorCode =
  | "disabled"
  | "rate_limited"
  | "timeout"
  | "network"
  | "auth"
  | "bad_request"
  | "upstream"
  | "refusal"
  | "truncated"
  | "invalid_response";

export type AiContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp"; data: string };
    };

export type AiRequest = {
  feature: AiFeature;
  system: string;
  content: AiContentBlock[];
  /** JSON schema for the response (additionalProperties:false objects only). */
  schema: Record<string, unknown>;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
};

export type AiUsage = { inputTokens: number; outputTokens: number };

export type AiSuccess = {
  ok: true;
  /** Parsed JSON value. UNTRUSTED: validate with zod before use. */
  value: unknown;
  model: string;
  usage: AiUsage;
  latencyMs: number;
};

export type AiFailure = {
  ok: false;
  code: AiErrorCode;
  /** Safe to show to a user; never contains provider detail. */
  error: string;
  model: string;
  usage: AiUsage;
  latencyMs: number;
};

export type AiResult = AiSuccess | AiFailure;

/** What the client needs from a transport (global `fetch` satisfies it). */
export type TransportResponse = {
  status: number;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
};

export type AiTransport = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<TransportResponse>;

export type AiClientDeps = {
  transport?: AiTransport;
  config?: AiConfig | null;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

const ANTHROPIC_VERSION = "2023-06-01";
const RETRY_BASE_MS = 400;
const RETRY_JITTER_MS = 400;
const RETRY_AFTER_CAP_MS = 2_000;

const defaultTransport: AiTransport = (url, init) => fetch(url, init);
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// `effort` is accepted by current Opus / Sonnet / Fable / Mythos models only
// (it errors on e.g. Haiku 4.5), so it is sent only for those families.
export const supportsEffort = (model: string): boolean =>
  /^claude-(?:opus-(?:5|4-[5-9])|sonnet-(?:5|4-6)|fable|mythos)/i.test(model);

const ResponseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).max(50),
  stop_reason: z.string().nullable().optional(),
  model: z.string().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

const USER_MESSAGES: Record<AiErrorCode, string> = {
  disabled: AI_NOT_ENABLED_MESSAGE,
  rate_limited: "Too many AI requests. Please try again in a few minutes.",
  timeout: "AI assistance took too long. Please try again.",
  network: "AI assistance is temporarily unavailable.",
  auth: "AI assistance is temporarily unavailable.",
  bad_request: "AI assistance is temporarily unavailable.",
  upstream: "AI assistance is temporarily unavailable.",
  refusal: "AI assistance could not help with this request.",
  truncated: "AI assistance returned an incomplete answer.",
  invalid_response: "AI assistance returned an unusable answer.",
};

export const aiUserMessage = (code: AiErrorCode): string => USER_MESSAGES[code];

const ZERO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0 };

const failure = (
  code: AiErrorCode,
  model: string,
  started: number,
  now: () => number,
  usage: AiUsage = ZERO_USAGE,
): AiFailure => ({
  ok: false,
  code,
  error: USER_MESSAGES[code],
  model,
  usage,
  latencyMs: Math.max(0, now() - started),
});

// Log a single, content-free line. Never log prompts, outputs, keys or bodies.
const logFailure = (feature: AiFeature, code: AiErrorCode, status?: number) => {
  console.error(
    `[ai] request failed feature=${feature} code=${code}${status ? ` status=${status}` : ""}`,
  );
};

export const buildRequestBody = (request: AiRequest, config: AiConfig): string => {
  const outputConfig: Record<string, unknown> = {
    format: { type: "json_schema", schema: request.schema },
  };
  const effort = request.effort ?? "low";
  if (supportsEffort(config.model)) outputConfig.effort = effort;

  return JSON.stringify({
    model: config.model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: [{ role: "user", content: request.content }],
    output_config: outputConfig,
  });
};

const retryable = (status: number) => status === 429 || status === 529 || status >= 500;

const parseRetryAfterMs = (response: TransportResponse): number | null => {
  const raw = response.headers?.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(RETRY_AFTER_CAP_MS, seconds * 1000);
};

// Pull a JSON value out of the model's text. Structured outputs should return
// bare JSON; code fences are tolerated because the result is validated anyway.
const parseJsonText = (text: string): unknown => {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced ? fenced[1] : trimmed);
};

/**
 * Calls the model once, with at most ONE retry (429 / 5xx / network error), a
 * single overall deadline (`timeoutMs`, default 15 s) and a hard output cap.
 * Never throws.
 */
export const callModel = async (
  request: AiRequest,
  deps: AiClientDeps = {},
): Promise<AiResult> => {
  const now = deps.now ?? Date.now;
  const started = now();
  const config = deps.config === undefined ? getAiConfig() : deps.config;

  if (!config) return failure("disabled", "", started, now);

  const transport = deps.transport ?? defaultTransport;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const deadline = started + config.timeoutMs;
  const body = buildRequestBody(request, config);
  const url = `${config.baseUrl}/v1/messages`;
  const headers = {
    "content-type": "application/json",
    "x-api-key": config.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };

  const fail = (code: AiErrorCode, status?: number, usage?: AiUsage) => {
    logFailure(request.feature, code, status);
    return failure(code, config.model, started, now, usage);
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = deadline - now();
    if (remaining <= 0) return fail("timeout");

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, remaining);

    let response: TransportResponse;
    let text: string;
    try {
      response = await transport(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      text = await response.text();
    } catch {
      clearTimeout(timer);
      if (timedOut) return fail("timeout");
      if (attempt === 0) {
        await sleep(Math.min(RETRY_BASE_MS + random() * RETRY_JITTER_MS, Math.max(0, deadline - now())));
        continue;
      }
      return fail("network");
    }
    clearTimeout(timer);

    if (retryable(response.status)) {
      if (attempt === 0) {
        const wait = parseRetryAfterMs(response) ?? RETRY_BASE_MS + random() * RETRY_JITTER_MS;
        if (now() + wait >= deadline) return fail(response.status === 429 ? "rate_limited" : "upstream", response.status);
        await sleep(wait);
        continue;
      }
      return fail(response.status === 429 ? "rate_limited" : "upstream", response.status);
    }
    if (response.status === 401 || response.status === 403) return fail("auth", response.status);
    if (response.status < 200 || response.status >= 300) return fail("bad_request", response.status);

    let envelope: z.infer<typeof ResponseSchema>;
    try {
      const parsed = ResponseSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return fail("invalid_response");
      envelope = parsed.data;
    } catch {
      return fail("invalid_response");
    }

    const usage: AiUsage = {
      inputTokens: Math.max(0, Math.floor(envelope.usage?.input_tokens ?? 0)),
      outputTokens: Math.max(0, Math.floor(envelope.usage?.output_tokens ?? 0)),
    };

    if (envelope.stop_reason === "refusal") return fail("refusal", undefined, usage);
    if (envelope.stop_reason === "max_tokens") return fail("truncated", undefined, usage);

    const textBlocks = envelope.content.filter((b) => b.type === "text" && typeof b.text === "string");
    if (textBlocks.length === 0) return fail("invalid_response", undefined, usage);
    const joined = textBlocks.map((b) => b.text as string).join("");

    let value: unknown;
    try {
      value = parseJsonText(joined);
    } catch {
      return fail("invalid_response", undefined, usage);
    }

    return {
      ok: true,
      value,
      model: typeof envelope.model === "string" ? envelope.model.slice(0, 100) : config.model,
      usage,
      latencyMs: Math.max(0, now() - started),
    };
  }

  return fail("upstream");
};
