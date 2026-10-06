// OperationOutcome builders. Messages are fixed strings: never include
// stack traces, internal error text, ids from the request or PHI.
import {
  FHIR_CONTENT_TYPE,
  type FhirIssueCode,
  type FhirResource,
  type OperationOutcome,
} from "./types";

export const operationOutcome = (
  code: FhirIssueCode,
  text: string,
  severity: "fatal" | "error" | "warning" | "information" = "error",
): OperationOutcome => ({
  resourceType: "OperationOutcome",
  issue: [{ severity, code, details: { text } }],
});

export const baseHeaders = (): Record<string, string> => ({
  "Content-Type": FHIR_CONTENT_TYPE,
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
});

export const fhirResponse = (
  body: FhirResource | OperationOutcome,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...baseHeaders(), ...extraHeaders },
  });

export const errorResponse = (
  status: number,
  code: FhirIssueCode,
  text: string,
  extraHeaders: Record<string, string> = {},
): Response => fhirResponse(operationOutcome(code, text), status, extraHeaders);

export const notEnabled = () =>
  errorResponse(404, "not-found", "The FHIR API is not enabled.");

export const methodNotAllowed = () =>
  errorResponse(405, "not-supported", "Only GET is supported.", {
    Allow: "GET",
  });

export const unauthorized = () =>
  errorResponse(401, "login", "Authentication required.", {
    "WWW-Authenticate": 'Bearer realm="fhir"',
  });

export const forbidden = (text = "Insufficient scope.") =>
  errorResponse(403, "forbidden", text);

export const notFound = (text = "Resource not found.") =>
  errorResponse(404, "not-found", text);

export const badRequest = (
  text: string,
  code: FhirIssueCode = "invalid",
) => errorResponse(400, code, text);

export const tooManyRequests = (retryAfterSeconds: number) =>
  errorResponse(429, "throttled", "Rate limit exceeded.", {
    "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });

export const serverError = () =>
  errorResponse(500, "exception", "The server could not process the request.");
