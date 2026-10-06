import { Query } from "node-appwrite";

import { SLOTS_COLLECTION_ID } from "@/constants";
import { getEnv } from "@/lib/env";
import { Slot, SlotStatus } from "@/types/appwrite.types";

import { getClients, isNotFound } from "./client";

export type NewSlotData = {
  /** Deterministic id from `slotId()`; a duplicate yields HTTP 409. */
  id: string;
  doctorId: string;
  start: Date;
  end: Date;
  appointmentId?: string | null;
  status: SlotStatus;
};

/** Throws an Appwrite error with code 409 when the slot is already taken. */
export const createSlot = async ({ id, ...data }: NewSlotData) => {
  const { DATABASE_ID } = getEnv();
  return getClients().databases.createDocument<Slot>(
    DATABASE_ID,
    SLOTS_COLLECTION_ID,
    id,
    {
      doctorId: data.doctorId,
      start: data.start.toISOString(),
      end: data.end.toISOString(),
      appointmentId: data.appointmentId ?? null,
      status: data.status,
    }
  );
};

export const getSlot = async (id: string) => {
  const { DATABASE_ID } = getEnv();
  return getClients().databases.getDocument<Slot>(
    DATABASE_ID,
    SLOTS_COLLECTION_ID,
    id
  );
};

/** Deletes a slot; a slot that is already gone is not an error. */
export const deleteSlot = async (id: string) => {
  const { DATABASE_ID } = getEnv();
  try {
    await getClients().databases.deleteDocument(
      DATABASE_ID,
      SLOTS_COLLECTION_ID,
      id
    );
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
};

const PAGE = 100;
const MAX_PAGES = 20;

/** Slots (booked or blocked) of a doctor starting in [from, to). */
export const listSlots = async (doctorId: string, from: Date, to: Date) => {
  const { DATABASE_ID } = getEnv();
  const slots: Slot[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const queries = [
      Query.equal("doctorId", [doctorId]),
      Query.greaterThanEqual("start", from.toISOString()),
      Query.lessThan("start", to.toISOString()),
      Query.orderAsc("start"),
      Query.limit(PAGE),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const result = await getClients().databases.listDocuments<Slot>(
      DATABASE_ID,
      SLOTS_COLLECTION_ID,
      queries
    );
    slots.push(...result.documents);
    if (result.documents.length < PAGE) break;
    cursor = result.documents[result.documents.length - 1].$id;
  }
  return slots;
};
