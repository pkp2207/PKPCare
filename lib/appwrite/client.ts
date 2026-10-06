import * as sdk from "node-appwrite";

import { getEnv } from "@/lib/env";

type Clients = {
  databases: sdk.Databases;
  users: sdk.Users;
  messaging: sdk.Messaging;
  storage: sdk.Storage;
};

let clients: Clients | null = null;

// Lazy so importing this module never requires env (e.g. during `next build`).
export const getClients = (): Clients => {
  if (clients) return clients;

  const { ENDPOINT, PROJECT_ID, API_KEY } = getEnv();
  const client = new sdk.Client()
    .setEndpoint(ENDPOINT)
    .setProject(PROJECT_ID)
    .setKey(API_KEY);

  clients = {
    databases: new sdk.Databases(client),
    users: new sdk.Users(client),
    messaging: new sdk.Messaging(client),
    storage: new sdk.Storage(client),
  };
  return clients;
};

/**
 * Maps an error to a message that is safe to show the client. Only well-known
 * Appwrite status codes are surfaced; everything else is generic so internal
 * detail (stack, endpoints, config) never leaks. Log the raw error separately.
 */
export const toUserMessage = (error: unknown, notFound = "Not found") => {
  const code = (error as { code?: number } | null)?.code;
  if (code === 404) return notFound;
  if (code === 409) return "This record already exists";
  return "Something went wrong. Please try again.";
};

const errorCode = (error: unknown) =>
  (error as { code?: number } | null)?.code;

/** HTTP 409: document id / unique index already taken. */
export const isConflict = (error: unknown) => errorCode(error) === 409;

/** HTTP 404: document, collection or database does not exist. */
export const isNotFound = (error: unknown) => errorCode(error) === 404;
