// Non-PHI audit record for AI calls. Prompts and outputs are never stored or
// logged; only the feature (in the action name), model id, latency, token
// counts and outcome.
//
// lib/compliance/audit.ts allow-lists meta keys; the AI keys (model, inputTokens,
// outputTokens, outcome) are on that list.
import { recordAudit } from "@/lib/compliance/audit";

import type { AiErrorCode, AiFeature, AiUsage } from "./client";

export type AiOutcome =
  | "ok"
  | "red_flag"
  | "no_suggestion"
  | "fallback_template"
  | "disabled"
  | "invalid_input"
  | "rate_limited"
  | "denied"
  | AiErrorCode;

export type AiAuditInput = {
  feature: AiFeature;
  actorId: string | null;
  actorRole: string;
  outcome: AiOutcome;
  model?: string;
  latencyMs?: number;
  usage?: AiUsage;
  errorCode?: AiErrorCode;
  resourceId?: string;
};

export const buildAiAuditMeta = (input: {
  outcome: AiOutcome;
  model?: string;
  latencyMs?: number;
  usage?: AiUsage;
  errorCode?: AiErrorCode;
}): Record<string, unknown> => {
  const meta: Record<string, unknown> = { outcome: input.outcome };
  if (input.model) meta.model = input.model;
  if (typeof input.latencyMs === "number") meta.durationMs = Math.round(input.latencyMs);
  if (input.usage) {
    meta.inputTokens = input.usage.inputTokens;
    meta.outputTokens = input.usage.outputTokens;
  }
  if (input.errorCode) meta.errorCode = input.errorCode;
  return meta;
};

const AUDIT_OUTCOME = (outcome: AiOutcome): "success" | "denied" | "error" => {
  if (outcome === "rate_limited" || outcome === "denied") return "denied";
  if (
    outcome === "ok" ||
    outcome === "red_flag" ||
    outcome === "no_suggestion" ||
    outcome === "fallback_template" ||
    outcome === "disabled"
  ) {
    return "success";
  }
  return "error";
};

/** Awaitable, never throws (recordAudit swallows its own failures). */
export const auditAi = async (input: AiAuditInput): Promise<void> => {
  try {
    await recordAudit({
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: `ai.${input.feature}`,
      resource: "ai",
      resourceId: input.resourceId,
      outcome: AUDIT_OUTCOME(input.outcome),
      meta: buildAiAuditMeta(input),
    });
  } catch {
    // Auditing must never break the request.
  }
};
