import { createHmac, timingSafeEqual } from "node:crypto";

import type { HeadersLike } from "./types";

export const hmacSha256Hex = (secret: string, data: string): string =>
  createHmac("sha256", secret).update(data, "utf8").digest("hex");

/** Constant-time comparison of two hex strings (false on length mismatch). */
export const safeEqualHex = (a: string, b: string): boolean => {
  if (!/^[0-9a-fA-F]+$/.test(a) || !/^[0-9a-fA-F]+$/.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

export const getHeader = (headers: HeadersLike, name: string): string | undefined => {
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = key ? record[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
};
