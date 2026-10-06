import type { AiOutcome } from "./audit";
import type { AiErrorCode, AiUsage } from "./client";

/** What a feature runner returns: the action result plus non-PHI audit facts. */
export type AiRun<T> = {
  result: ActionResult<T>;
  outcome: AiOutcome;
  model?: string;
  latencyMs?: number;
  usage?: AiUsage;
  errorCode?: AiErrorCode;
};
