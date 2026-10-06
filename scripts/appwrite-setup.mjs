#!/usr/bin/env node
// Idempotent Appwrite schema setup for PKPCare.
//
//   node --env-file=.env scripts/appwrite-setup.mjs [--dry-run] [--seed-doctors] [--timezone=<IANA>]
//
// Reads EVERY *.json file in scripts/schema/ (each is one collection object, an
// array of them, or { "collections": [...] }) and creates whatever is missing:
// collections, attributes, indexes. Existing things are never modified or
// deleted. Format (see docs/scheduling.md):
//
//   {
//     "id": "doctors",                    // fixed collection id
//     "idFromEnv": "APPOINTMENT_COLLECTION_ID", // alternative to "id": read it from env
//     "name": "Doctors",
//     "existing": false,                  // true: never create the collection, only add
//                                         //       missing attributes/indexes to it
//     "documentSecurity": false,
//     "permissions": [],                  // [] = server API key only
//     "attributes": [{ "key", "type": "string|integer|float|boolean|datetime|enum|email",
//                      "size", "required", "default", "array", "min", "max", "elements" }],
//     "indexes": [{ "key", "type": "key|unique|fulltext", "attributes": [], "orders": [] }]
//   }
//
// Env: NEXT_PUBLIC_ENDPOINT, PROJECT_ID, API_KEY, DATABASE_ID (+ any idFromEnv).
// --dry-run prints the plan and makes no network calls (env not required).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(here, "schema");
const constantsFile = path.join(here, "..", "constants", "index.ts");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const seedDoctors = argv.includes("--seed-doctors");
const timezoneArg = argv.find((a) => a.startsWith("--timezone="));
const seedTimezone = timezoneArg ? timezoneArg.split("=")[1] : "UTC";

const log = (msg) => console.log(msg);
let errors = 0;
const fail = (msg, error) => {
  errors += 1;
  console.error(`  ERROR ${msg}${error?.message ? `: ${error.message}` : ""}`);
};

// ---------------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------------

const ATTRIBUTE_TYPES = ["string", "integer", "float", "boolean", "datetime", "enum", "email"];
const INDEX_TYPES = ["key", "unique", "fulltext"];

const loadSchemas = () => {
  const files = readdirSync(schemaDir).filter((f) => f.endsWith(".json")).sort();
  const collections = [];
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path.join(schemaDir, file), "utf8"));
    } catch (error) {
      fail(`${file}: invalid JSON`, error);
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : parsed.collections ?? [parsed];
    for (const collection of list) {
      const problem = validateCollection(collection);
      if (problem) fail(`${file}: ${problem}`);
      else collections.push({ ...collection, _file: file });
    }
  }
  return collections;
};

const validateCollection = (c) => {
  if (!c || typeof c !== "object") return "collection must be an object";
  if (!c.id && !c.idFromEnv) return 'needs "id" or "idFromEnv"';
  if (!c.name) return 'needs "name"';
  for (const a of c.attributes ?? []) {
    if (!a.key || !ATTRIBUTE_TYPES.includes(a.type)) return `bad attribute ${JSON.stringify(a)}`;
    if (a.type === "string" && !a.size) return `string attribute ${a.key} needs "size"`;
    if (a.type === "enum" && !a.elements?.length) return `enum attribute ${a.key} needs "elements"`;
    if (a.required && a.default !== undefined) return `attribute ${a.key}: required attributes cannot have a default`;
  }
  for (const i of c.indexes ?? []) {
    if (!i.key || !INDEX_TYPES.includes(i.type) || !i.attributes?.length) return `bad index ${JSON.stringify(i)}`;
  }
  return null;
};

const collectionId = (c) => (c.id ? c.id : process.env[c.idFromEnv] || `<env:${c.idFromEnv}>`);

// ---------------------------------------------------------------------------
// Doctor seed data (parsed from constants/index.ts, which is TypeScript)
// ---------------------------------------------------------------------------

const slugify = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);

const DEFAULT_HOURS = {
  mon: [["09:00", "17:00"]],
  tue: [["09:00", "17:00"]],
  wed: [["09:00", "17:00"]],
  thu: [["09:00", "17:00"]],
  fri: [["09:00", "17:00"]],
  sat: [],
  sun: [],
};

const readConstantDoctors = () => {
  const source = readFileSync(constantsFile, "utf8");
  const block = /export const Doctors = \[([\s\S]*?)\n\];/.exec(source);
  if (!block) throw new Error("Could not find `Doctors` in constants/index.ts");
  const doctors = [];
  for (const [, body] of block[1].matchAll(/\{([^{}]*)\}/g)) {
    const name = /name:\s*"([^"]+)"/.exec(body)?.[1];
    const image = /image:\s*"([^"]+)"/.exec(body)?.[1];
    if (name && image) doctors.push({ name, image });
  }
  return doctors;
};

const doctorDocument = ({ name, image }) => ({
  name,
  specialty: "General Medicine",
  image,
  active: true,
  slotMinutes: 30,
  timezone: seedTimezone,
  weeklyHours: JSON.stringify(DEFAULT_HOURS),
  timeOff: "[]",
});

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

const describeAttribute = (a) =>
  `${a.key} (${a.type}${a.size ? `[${a.size}]` : ""}${a.required ? ", required" : ""}${
    a.default !== undefined ? `, default=${JSON.stringify(a.default)}` : ""
  })`;

const printPlan = (collections) => {
  log("DRY RUN - no network calls. Each step is skipped at run time if it already exists.\n");
  for (const c of collections) {
    log(`Collection ${collectionId(c)} "${c.name}" [${c._file}]`);
    log(
      c.existing
        ? "  - must already exist (never created by this script)"
        : `  - create if missing (documentSecurity=${c.documentSecurity ?? false}, permissions=${JSON.stringify(c.permissions ?? [])})`
    );
    for (const a of c.attributes ?? []) log(`  - ensure attribute ${describeAttribute(a)}`);
    for (const i of c.indexes ?? [])
      log(`  - ensure index ${i.key} ${i.type} (${i.attributes.join(", ")})`);
  }
  if (seedDoctors) {
    log("\nSeed doctors (skipped per doctor if the id already exists):");
    for (const d of readConstantDoctors()) log(`  - ${slugify(d.name)}: ${d.name}`);
    log(`  default hours Mon-Fri 09:00-17:00, 30 min slots, timezone ${seedTimezone}`);
  }
};

// ---------------------------------------------------------------------------
// Live run
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const code = (e) => e?.code;

const createAttribute = (databases, db, coll, a) => {
  const req = Boolean(a.required);
  const def = a.default;
  const arr = a.array ? true : undefined;
  switch (a.type) {
    case "string":
      return databases.createStringAttribute(db, coll, a.key, a.size, req, def, arr);
    case "integer":
      return databases.createIntegerAttribute(db, coll, a.key, req, a.min, a.max, def, arr);
    case "float":
      return databases.createFloatAttribute(db, coll, a.key, req, a.min, a.max, def, arr);
    case "boolean":
      return databases.createBooleanAttribute(db, coll, a.key, req, def, arr);
    case "datetime":
      return databases.createDatetimeAttribute(db, coll, a.key, req, def, arr);
    case "enum":
      return databases.createEnumAttribute(db, coll, a.key, a.elements, req, def, arr);
    case "email":
      return databases.createEmailAttribute(db, coll, a.key, req, def, arr);
    default:
      throw new Error(`Unsupported attribute type ${a.type}`);
  }
};

// Indexes can only be built on attributes that finished processing.
const waitForAttributes = async (databases, db, coll, keys, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { attributes } = await databases.listAttributes(db, coll);
    const wanted = attributes.filter((a) => keys.includes(a.key));
    const failed = wanted.find((a) => a.status === "failed");
    if (failed) throw new Error(`attribute ${failed.key} failed to build`);
    if (wanted.length === keys.length && wanted.every((a) => a.status === "available")) return;
    await sleep(1000);
  }
  throw new Error("timed out waiting for attributes to become available");
};

const ensureCollection = async (databases, db, c) => {
  const id = collectionId(c);
  if (id.startsWith("<env:")) {
    fail(`${c._file}: env ${c.idFromEnv} is not set`);
    return false;
  }
  log(`\nCollection ${id} "${c.name}" [${c._file}]`);
  try {
    await databases.getCollection(db, id);
    log("  = exists");
  } catch (error) {
    if (code(error) !== 404) {
      fail(`getCollection ${id}`, error);
      return false;
    }
    if (c.existing) {
      fail(`collection ${id} does not exist and is marked "existing" - create it first (app must have registered patients/appointments)`);
      return false;
    }
    try {
      await databases.createCollection(db, id, c.name, c.permissions ?? [], c.documentSecurity ?? false, true);
      log("  + created collection");
    } catch (createError) {
      fail(`createCollection ${id}`, createError);
      return false;
    }
  }

  // Attributes
  let existingAttrs;
  try {
    existingAttrs = (await databases.listAttributes(db, id)).attributes;
  } catch (error) {
    fail(`listAttributes ${id}`, error);
    return false;
  }
  const existingKeys = new Set(existingAttrs.map((a) => a.key));
  const created = [];
  for (const a of c.attributes ?? []) {
    if (existingKeys.has(a.key)) {
      const have = existingAttrs.find((x) => x.key === a.key);
      const haveType = have?.format === "enum" ? "enum" : have?.type;
      if (haveType && haveType !== a.type && !(a.type === "email" && have?.type === "string")) {
        log(`  ! attribute ${a.key} exists as ${haveType}, schema says ${a.type} (left unchanged)`);
      } else {
        log(`  = attribute ${a.key}`);
      }
      continue;
    }
    try {
      await createAttribute(databases, db, id, a);
      created.push(a.key);
      log(`  + attribute ${describeAttribute(a)}`);
    } catch (error) {
      if (code(error) === 409) log(`  = attribute ${a.key}`);
      else fail(`createAttribute ${id}.${a.key}`, error);
    }
  }

  // Indexes
  let existingIndexes;
  try {
    existingIndexes = new Set((await databases.listIndexes(db, id)).indexes.map((i) => i.key));
  } catch (error) {
    fail(`listIndexes ${id}`, error);
    return true;
  }
  const pending = (c.indexes ?? []).filter((i) => !existingIndexes.has(i.key));
  for (const i of c.indexes ?? []) if (existingIndexes.has(i.key)) log(`  = index ${i.key}`);
  if (pending.length > 0 && created.length > 0) {
    try {
      await waitForAttributes(databases, db, id, created);
    } catch (error) {
      fail(`waiting for attributes of ${id}`, error);
    }
  }
  for (const i of pending) {
    try {
      await databases.createIndex(db, id, i.key, i.type, i.attributes, i.orders);
      log(`  + index ${i.key} ${i.type} (${i.attributes.join(", ")})`);
    } catch (error) {
      if (code(error) === 409) log(`  = index ${i.key}`);
      else fail(`createIndex ${id}.${i.key} (does every attribute exist and is its size indexable?)`, error);
    }
  }
  return true;
};

const seed = async (databases, db) => {
  log("\nSeeding doctors");
  for (const d of readConstantDoctors()) {
    const id = slugify(d.name);
    try {
      await databases.getDocument(db, "doctors", id);
      log(`  = ${id}`);
      continue;
    } catch (error) {
      if (code(error) !== 404) {
        fail(`getDocument doctors/${id}`, error);
        continue;
      }
    }
    try {
      await databases.createDocument(db, "doctors", id, doctorDocument(d));
      log(`  + ${id} (${d.name})`);
    } catch (error) {
      fail(`createDocument doctors/${id}`, error);
    }
  }
};

const main = async () => {
  const collections = loadSchemas();
  if (errors > 0) process.exit(1);

  if (dryRun) {
    printPlan(collections);
    return;
  }

  const required = ["NEXT_PUBLIC_ENDPOINT", "PROJECT_ID", "API_KEY", "DATABASE_ID"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing env: ${missing.join(", ")}. Run: node --env-file=.env scripts/appwrite-setup.mjs`);
    process.exit(1);
  }

  const { Client, Databases } = await import("node-appwrite");
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_ENDPOINT)
    .setProject(process.env.PROJECT_ID)
    .setKey(process.env.API_KEY);
  const databases = new Databases(client);
  const db = process.env.DATABASE_ID;

  for (const c of collections) await ensureCollection(databases, db, c);
  if (seedDoctors) await seed(databases, db);

  log(errors > 0 ? `\nDone with ${errors} error(s).` : "\nDone.");
  if (errors > 0) process.exit(1);
};

main().catch((error) => {
  console.error("Setup failed:", error?.message ?? error);
  process.exit(1);
});
