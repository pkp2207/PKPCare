// Edge-safe signed session tokens (Web Crypto HMAC-SHA256).
// Works in Next.js middleware (Edge runtime), Node server code and server actions.
// Token format: base64url(JSON {exp}) + "." + base64url(HMAC-SHA256(payloadPart)).

export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hmacSign(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(signature);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

// Constant-time string comparison (does not short-circuit on first mismatch).
export function safeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  return bytesEqual(aBytes, bBytes);
}

export async function createSessionToken(
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({ exp })));
  const signature = bytesToBase64Url(await hmacSign(secret, payload));
  return `${payload}.${signature}`;
}

// Never throws: any malformed input yields false.
export async function verifySessionToken(
  token: string | undefined,
  secret: string
): Promise<boolean> {
  try {
    if (!token || !secret) return false;

    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [payload, signature] = parts;
    if (!payload || !signature) return false;

    const expected = await hmacSign(secret, payload);
    if (!bytesEqual(expected, base64UrlToBytes(signature))) return false;

    const { exp } = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payload))
    );
    if (typeof exp !== "number" || !Number.isFinite(exp)) return false;

    return exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
