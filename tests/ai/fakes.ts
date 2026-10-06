import type { AiTransport, TransportResponse } from "@/lib/ai/client";
import type { AiConfig } from "@/lib/ai/config";

export const TEST_CONFIG: AiConfig = {
  model: "claude-opus-5-5",
  apiKey: "test-key",
  baseUrl: "https://api.example.test",
  timeoutMs: 1000,
};

export const envelope = (
  value: unknown,
  over: Record<string, unknown> = {},
): string =>
  JSON.stringify({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    usage: { input_tokens: 120, output_tokens: 30 },
    ...over,
  });

export const response = (
  status: number,
  body: string,
  headers: Record<string, string> = {},
): TransportResponse => ({
  status,
  text: async () => body,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
});

/** Transport that replays queued responses (or thrown errors) and records calls. */
export const queueTransport = (
  queue: (TransportResponse | Error)[],
): AiTransport & { calls: { url: string; body: any; headers: Record<string, string> }[] } => {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const fn = (async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const next = queue.shift();
    if (!next) throw new Error("no more queued responses");
    if (next instanceof Error) throw next;
    return next;
  }) as AiTransport & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};

export const okTransport = (value: unknown) =>
  queueTransport([response(200, envelope(value))]);

/** Transport that never answers until aborted. */
export const hangingTransport = (): AiTransport =>
  (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });

export const noSleep = async () => undefined;
