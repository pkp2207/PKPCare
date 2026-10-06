import { createHmac } from "node:crypto";

/** A session-style token (payload "." HMAC(payloadPart) with NO link context). */
export const createStaffSessionToken = (secret: string, payloadPart?: string) => {
  const part =
    payloadPart ??
    Buffer.from(JSON.stringify({ exp: 9999999999, kind: "staff", sub: "u1", role: "admin" })).toString("base64url");
  return `${part}.${createHmac("sha256", secret).update(part).digest("base64url")}`;
};
