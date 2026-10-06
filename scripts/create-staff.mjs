#!/usr/bin/env node
// Create a staff account: an Appwrite user carrying a label equal to its role.
//
//   node --env-file=.env scripts/create-staff.mjs --email a@b.c --name "X" --role admin
//
// Options:
//   --email <addr>       required
//   --name <text>        required
//   --role <role>        required: admin | frontdesk | doctor
//   --password <text>    optional (min 12 chars); default: random strong password,
//                        printed ONCE to stdout
//   --promote            if the user already exists, set its role label instead of failing
//   --dry-run            validate and print the plan; no network calls, no env needed
//   --help
//
// Env (same as the app): NEXT_PUBLIC_ENDPOINT, PROJECT_ID, API_KEY. The API key
// needs users.read and users.write scopes.

import { randomBytes, randomInt } from "node:crypto";
import { parseArgs } from "node:util";

const ROLES = ["admin", "frontdesk", "doctor"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function usage(code) {
  console.error(
    'Usage: node --env-file=.env scripts/create-staff.mjs --email a@b.c --name "Full Name" --role admin|frontdesk|doctor [--password <pw>] [--promote] [--dry-run]'
  );
  process.exit(code);
}

function generatePassword(length = 24) {
  const sets = [
    "abcdefghijkmnopqrstuvwxyz",
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "23456789",
    "!@#$%^&*-_=+",
  ];
  const all = sets.join("");
  const chars = sets.map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  // Fisher-Yates shuffle with a CSPRNG.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

let args;
try {
  args = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      password: { type: "string" },
      promote: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  }).values;
} catch (error) {
  console.error(error.message);
  usage(2);
}

if (args.help) usage(0);

const email = (args.email ?? "").trim().toLowerCase();
const name = (args.name ?? "").trim();
const role = (args.role ?? "").trim().toLowerCase();
const dryRun = args["dry-run"];

const problems = [];
if (!EMAIL_RE.test(email)) problems.push("--email must be a valid email address");
if (name.length < 2 || name.length > 128) problems.push("--name must be 2-128 characters");
if (!ROLES.includes(role)) problems.push(`--role must be one of: ${ROLES.join(", ")}`);
if (args.password !== undefined && args.password.length < 12) {
  problems.push("--password must be at least 12 characters");
}
if (problems.length) {
  for (const p of problems) console.error(`error: ${p}`);
  usage(2);
}

const generated = args.password === undefined;
const password = args.password ?? generatePassword();

if (dryRun) {
  console.log("[dry-run] no changes made. Would:");
  console.log(`  1. look up an Appwrite user with email ${email}`);
  console.log(`  2. create user (name "${name}", email ${email}, ${generated ? "random generated" : "supplied"} password)`);
  console.log(`  3. set labels ["${role}"] on the user`);
  if (args.promote) console.log("  (--promote: an existing user would get the label instead of an error)");
  process.exit(0);
}

const endpoint = process.env.NEXT_PUBLIC_ENDPOINT;
const projectId = process.env.PROJECT_ID;
const apiKey = process.env.API_KEY;
const missing = [
  ["NEXT_PUBLIC_ENDPOINT", endpoint],
  ["PROJECT_ID", projectId],
  ["API_KEY", apiKey],
]
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`error: missing env vars: ${missing.join(", ")} (run with --env-file=.env)`);
  process.exit(2);
}

const { Client, ID, Query, Users } = await import("node-appwrite");
const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const users = new Users(client);

try {
  const existing = await users.list([Query.equal("email", [email]), Query.limit(1)]);
  const found = existing.users[0];

  if (found) {
    if (!args.promote) {
      console.error(`error: a user with email ${email} already exists (id ${found.$id}). Use --promote to set its role label.`);
      process.exit(1);
    }
    const labels = Array.from(new Set([...(found.labels ?? []).filter((l) => !ROLES.includes(l)), role]));
    await users.updateLabels(found.$id, labels);
    console.log(`Updated existing user ${found.$id} (${email}): labels = ${JSON.stringify(labels)}`);
    console.log("Password unchanged.");
    process.exit(0);
  }

  const user = await users.create(ID.unique(), email, undefined, password, name);
  await users.updateLabels(user.$id, [role]);

  console.log(`Created staff user ${user.$id}`);
  console.log(`  email: ${email}`);
  console.log(`  name:  ${name}`);
  console.log(`  role:  ${role}`);
  if (generated) {
    console.log("");
    console.log("Generated password (shown ONCE, store it in a password manager):");
    console.log(password);
  }
} catch (error) {
  console.error(`error: Appwrite request failed: ${error?.message ?? error}`);
  process.exit(1);
}
