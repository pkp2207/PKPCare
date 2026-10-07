#!/usr/bin/env node
// Checks (and optionally raises) the sizes of the encrypted string attributes in the
// patients collection so ciphertext from lib/compliance/crypto.ts fits.
//
//   node --env-file=.env scripts/check-patient-schema.mjs            # read-only report
//   node --env-file=.env scripts/check-patient-schema.mjs --apply    # raise sizes (never shrinks)
//
// Env: NEXT_PUBLIC_ENDPOINT, PROJECT_ID, API_KEY, DATABASE_ID, PATIENT_COLLECTION_ID.
//
// Ciphertext is `enc:v1:<keyId>:<iv>:<tag>:<ct>` = 56 + ceil(4n/3) characters for an
// n-byte plaintext. Sizing assumes the worst case of 4 UTF-8 bytes per character, so
// non-Latin text (Hindi, Gujarati, emoji) still fits.
//
// Row width: Appwrite rejects a collection whose attributes add up to more than
// ~65535 bytes. ESTIMATE of its rule (a varchar counts size*4+2 bytes above 255 chars;
// strings longer than the varchar limit are stored as TEXT and count ~20 bytes). The
// Appwrite API has the final say: --apply reports any rejection.

const MAX_ROW_BYTES = 65535;
const VARCHAR_LIMIT = 16381;

// Longest allowed plaintext per field, in characters (see lib/validation.ts).
const ENCRYPTED_FIELDS = {
  insurancePolicyNumber: 50,
  identificationNumber: 100,
  allergies: 2000,
  currentMedication: 2000,
  familyMedicalHistory: 2000,
  pastMedicalHistory: 2000,
};

const ciphertextLength = (chars) => 56 + Math.ceil((4 * (chars * 4)) / 3);
// Round up to a tidy size; anything that would be a large varchar goes off-row (TEXT).
const targetSize = (chars) => {
  const needed = ciphertextLength(chars);
  if (needed <= 1000) return Math.ceil(needed / 50) * 50;
  return Math.max(VARCHAR_LIMIT + 1, Math.ceil(needed / 1000) * 1000);
};

const widthOf = (attr) => {
  if (attr.type !== "string") {
    if (attr.type === "integer" || attr.type === "double") return 8;
    if (attr.type === "boolean") return 1;
    if (attr.type === "datetime") return 8;
    return 20; // relationships, enums (varchar) etc.: coarse
  }
  const size = attr.size ?? 0;
  if (size > VARCHAR_LIMIT) return 20;
  return size > 255 ? size * 4 + 2 : size * 4 + 1;
};

const apply = process.argv.includes("--apply");
const { NEXT_PUBLIC_ENDPOINT, PROJECT_ID, API_KEY, DATABASE_ID, PATIENT_COLLECTION_ID } =
  process.env;
for (const [k, v] of Object.entries({
  NEXT_PUBLIC_ENDPOINT,
  PROJECT_ID,
  API_KEY,
  DATABASE_ID,
  PATIENT_COLLECTION_ID,
})) {
  if (!v) {
    console.error(`Missing env var ${k}`);
    process.exit(2);
  }
}

const base = `${NEXT_PUBLIC_ENDPOINT.replace(/\/$/, "")}/databases/${DATABASE_ID}/collections/${PATIENT_COLLECTION_ID}/attributes`;
const headers = {
  "Content-Type": "application/json",
  "X-Appwrite-Project": PROJECT_ID,
  "X-Appwrite-Key": API_KEY,
};

const request = async (method, url, body) => {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`${res.status} ${json.message ?? "request failed"}`);
  return json;
};

const list = async () => (await request("GET", `${base}?queries[0]=${encodeURIComponent('{"method":"limit","values":[100]}')}`)).attributes;

const attributes = await list();
const byKey = new Map(attributes.map((a) => [a.key, a]));

console.log(`patients collection: ${attributes.length} attributes\n`);
console.log("Encrypted fields (current -> needed):");
const plan = [];
let problems = 0;
for (const [key, chars] of Object.entries(ENCRYPTED_FIELDS)) {
  const attr = byKey.get(key);
  const target = targetSize(chars);
  if (!attr) {
    console.log(`  ${key.padEnd(24)} MISSING attribute`);
    problems += 1;
    continue;
  }
  if (attr.type !== "string") {
    console.log(`  ${key.padEnd(24)} type is ${attr.type}, must be string`);
    problems += 1;
    continue;
  }
  const ok = attr.size >= target;
  console.log(
    `  ${key.padEnd(24)} ${String(attr.size).padStart(6)} -> ${String(target).padStart(6)}  ${ok ? "ok" : "NEEDS RAISE"}${attr.array ? "  (array!)" : ""}`,
  );
  if (!ok) plan.push({ attr, target });
}

const currentWidth = attributes.reduce((sum, a) => sum + widthOf(a), 0);
const projected = attributes.reduce((sum, a) => {
  const change = plan.find((p) => p.attr.key === a.key);
  return sum + widthOf(change ? { ...a, size: change.target } : a);
}, 0);
console.log(
  `\nEstimated row width: now ${currentWidth} bytes, after raise ${projected} bytes (limit ~${MAX_ROW_BYTES}).`,
);
const fits = projected <= MAX_ROW_BYTES;
console.log(fits ? "Estimate: fits." : "Estimate: DOES NOT FIT - shorten other string attributes first.");

if (problems > 0) {
  console.log(`\n${problems} problem(s) above must be fixed by hand.`);
  process.exit(1);
}
if (plan.length === 0) {
  console.log("\nAll encrypted fields are large enough. Safe to set FIELD_ENCRYPTION_KEY.");
  process.exit(0);
}
if (!apply) {
  console.log(`\nRead-only run. Re-run with --apply to raise ${plan.length} attribute(s) (sizes only increase).`);
  process.exit(fits ? 0 : 1);
}
if (!fits) {
  console.error("\nRefusing to apply: estimated row width is over the limit.");
  process.exit(1);
}

console.log("\nApplying...");
let failures = 0;
for (const { attr, target } of plan) {
  try {
    await request("PATCH", `${base}/string/${attr.key}`, {
      required: attr.required,
      default: attr.required ? null : (attr.default ?? null),
      size: target,
    });
    // Resizing is asynchronous: wait until the attribute is available again.
    for (let i = 0; i < 60; i += 1) {
      const current = await request("GET", `${base}/${attr.key}`);
      if (current.status === "available") break;
      if (current.status === "failed") throw new Error("attribute entered failed state");
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log(`  raised ${attr.key} to ${target}`);
  } catch (error) {
    failures += 1;
    console.error(`  ERROR ${attr.key}: ${error.message}`);
  }
}
console.log(failures ? `\nDone with ${failures} error(s).` : "\nDone. Safe to set FIELD_ENCRYPTION_KEY.");
process.exit(failures ? 1 : 0);
