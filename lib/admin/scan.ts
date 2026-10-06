// Server-only read helpers for the admin console: filtered / date-ranged
// appointment reads with offset paging, capped cursor scans, and waitlist
// counts. Read-only; the write paths stay in the appointment/doctor actions.
import { Query } from "node-appwrite";

import { WAITLIST_COLLECTION_ID } from "@/constants";
import { getClients, isNotFound } from "@/lib/appwrite/client";
import { getEnv } from "@/lib/env";
import type { Appointment } from "@/types/appwrite.types";

import type { AppointmentSort } from "./filters";

export type AppointmentReadFilter = {
  status?: Status;
  doctorId?: string;
  primaryPhysician?: string;
  /** Inclusive lower bound on `schedule` (ISO). */
  fromIso?: string;
  /** Exclusive upper bound on `schedule` (ISO). */
  toIso?: string;
  sort?: AppointmentSort;
};

const SCAN_PAGE = 100;

const buildQueries = (filter: AppointmentReadFilter): string[] => {
  const queries: string[] = [];
  if (filter.status) queries.push(Query.equal("status", [filter.status]));
  if (filter.doctorId) queries.push(Query.equal("doctorId", [filter.doctorId]));
  if (filter.primaryPhysician) {
    queries.push(Query.equal("primaryPhysician", [filter.primaryPhysician]));
  }
  if (filter.fromIso) {
    queries.push(Query.greaterThanEqual("schedule", filter.fromIso));
  }
  if (filter.toIso) queries.push(Query.lessThan("schedule", filter.toIso));

  switch (filter.sort) {
    case "schedule_asc":
      queries.push(Query.orderAsc("schedule"));
      break;
    case "schedule_desc":
      queries.push(Query.orderDesc("schedule"));
      break;
    default:
      queries.push(Query.orderDesc("$createdAt"));
  }
  return queries;
};

const db = () => {
  const { DATABASE_ID, APPOINTMENT_COLLECTION_ID } = getEnv();
  return {
    databases: getClients().databases,
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
  };
};

/** One offset page plus the matching total (structured filters only). */
export const queryAppointmentsPage = async (
  filter: AppointmentReadFilter,
  { limit, offset }: { limit: number; offset: number }
) => {
  const { databases, DATABASE_ID, APPOINTMENT_COLLECTION_ID } = db();
  return databases.listDocuments<Appointment>(
    DATABASE_ID,
    APPOINTMENT_COLLECTION_ID,
    [...buildQueries(filter), Query.limit(limit), Query.offset(offset)]
  );
};

// Columns the analytics scan needs. Selecting them avoids pulling the expanded
// patient relationship for thousands of rows. Older Appwrite servers reject
// `select`; we retry without it.
const ANALYTICS_FIELDS = [
  "$id",
  "$createdAt",
  "status",
  "schedule",
  "doctorId",
  "primaryPhysician",
];

export type ScanResult = { documents: Appointment[]; truncated: boolean };

/**
 * Cursor-paged scan of up to `cap` matching appointments. `truncated` is true
 * when at least one more matching document exists beyond the cap.
 */
export const scanAppointments = async (
  filter: AppointmentReadFilter,
  { cap, lean = false }: { cap: number; lean?: boolean }
): Promise<ScanResult> => {
  const { databases, DATABASE_ID, APPOINTMENT_COLLECTION_ID } = db();
  const base = buildQueries(filter);
  let useSelect = lean;
  const documents: Appointment[] = [];
  let cursor: string | undefined;
  let truncated = false;

  for (;;) {
    const room = cap - documents.length;
    // At the cap: probe for one more document to know whether we truncated.
    const want = room > 0 ? Math.min(SCAN_PAGE, room) : 1;
    const queries = [...base, Query.limit(want)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    if (useSelect) queries.push(Query.select(ANALYTICS_FIELDS));

    let page;
    try {
      page = await databases.listDocuments<Appointment>(
        DATABASE_ID,
        APPOINTMENT_COLLECTION_ID,
        queries
      );
    } catch (error) {
      if (useSelect && (error as { code?: number } | null)?.code === 400) {
        useSelect = false;
        continue;
      }
      throw error;
    }

    if (room === 0) {
      truncated = page.documents.length > 0;
      break;
    }
    documents.push(...page.documents);
    if (page.documents.length < want) break;
    cursor = page.documents[page.documents.length - 1].$id;
  }

  return { documents, truncated };
};

/** Waitlist entries with the given status for one doctor (0 if the collection is missing). */
export const countWaitlist = async (
  doctorId: string,
  status: "waiting" | "offered"
): Promise<number> => {
  const { DATABASE_ID } = getEnv();
  try {
    const result = await getClients().databases.listDocuments(
      DATABASE_ID,
      WAITLIST_COLLECTION_ID,
      [
        Query.equal("doctorId", [doctorId]),
        Query.equal("status", [status]),
        Query.limit(1),
      ]
    );
    return result.total;
  } catch (error) {
    if (isNotFound(error)) return 0;
    throw error;
  }
};

/** Patient fields safe to hand to the admin UI; never medical or ID data. */
export type SlimPatient = {
  $id: string;
  name: string;
  email: string;
  phone: string;
};

export const slimPatient = (patient: unknown): SlimPatient | null => {
  if (!patient || typeof patient !== "object") return null;
  const p = patient as Record<string, unknown>;
  return {
    $id: String(p.$id ?? ""),
    name: typeof p.name === "string" ? p.name : "",
    email: typeof p.email === "string" ? p.email : "",
    phone: typeof p.phone === "string" ? p.phone : "",
  };
};
