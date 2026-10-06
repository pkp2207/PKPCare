// Server only. Appwrite helpers for the auth flows.
import { Account, Client } from "node-appwrite";

import { getEnv } from "@/lib/env";

// Session-less (no API key) Account for guest-scope calls: createEmailToken,
// createSession, createEmailPasswordSession. With `sessionSecret` it acts as that
// user (MFA challenge, account.get, deleteSession). A fresh Client every call:
// Client is mutable, never share one between requests.
export function getPublicAccount(sessionSecret?: string): Account {
  const { ENDPOINT, PROJECT_ID } = getEnv();
  const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID);
  if (sessionSecret) client.setSession(sessionSecret);
  return new Account(client);
}
