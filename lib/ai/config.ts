// AI feature configuration. Server only (reads secrets from the environment).
//
// AI is OFF by default. It is enabled only when BOTH `AI_ENABLED=true` and a
// non-empty `ANTHROPIC_API_KEY` are present. Nothing here is evaluated at import
// time so `next build` works without any AI configuration.

/** Default model id (confirmed from the Claude API model table on 2026-10-06). */
export const DEFAULT_AI_MODEL = "claude-opus-5-5";

export const DEFAULT_AI_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 30_000;

const DEFAULT_BASE_URL = "https://api.anthropic.com";

export const AI_NOT_ENABLED_MESSAGE = "AI assistance is not enabled";

export type AiConfig = {
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
};

type Env = Record<string, string | undefined>;

const clean = (value: string | undefined) => (value ?? "").trim();

/** True only for the exact string "true" (case-insensitive). Fails closed. */
export const isAiFlagOn = (env: Env = process.env): boolean =>
  clean(env.AI_ENABLED).toLowerCase() === "true";

/** Feature flag AND credentials present. The only gate every AI path uses. */
export const isAiEnabled = (env: Env = process.env): boolean =>
  isAiFlagOn(env) && clean(env.ANTHROPIC_API_KEY).length > 0;

const parseTimeout = (raw: string | undefined): number => {
  const parsed = Number.parseInt(clean(raw), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_AI_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, parsed));
};

// Model ids are plain tokens; refuse anything else rather than send it on.
const parseModel = (raw: string | undefined): string => {
  const value = clean(raw);
  return /^[a-z0-9][a-z0-9._:-]{2,99}$/i.test(value) ? value : DEFAULT_AI_MODEL;
};

// Only an https base URL (optional proxy / gateway) is accepted.
const parseBaseUrl = (raw: string | undefined): string => {
  const value = clean(raw).replace(/\/+$/, "");
  return /^https:\/\/[^\s/]+(\/[^\s]*)?$/i.test(value) ? value : DEFAULT_BASE_URL;
};

/** Returns null when AI is not enabled. */
export const getAiConfig = (env: Env = process.env): AiConfig | null => {
  if (!isAiEnabled(env)) return null;
  return {
    model: parseModel(env.AI_MODEL),
    apiKey: clean(env.ANTHROPIC_API_KEY),
    baseUrl: parseBaseUrl(env.ANTHROPIC_BASE_URL),
    timeoutMs: parseTimeout(env.AI_TIMEOUT_MS),
  };
};

/**
 * Optional local emergency number (for example "112" or "911"), shown in the
 * red-flag message. Sanitised to digits and a few separators; no number is
 * baked into the code.
 */
export const getEmergencyNumber = (env: Env = process.env): string | undefined => {
  const value = clean(env.EMERGENCY_NUMBER);
  if (!/^[0-9+][0-9 +-]{1,19}$/.test(value)) return undefined;
  return value;
};
