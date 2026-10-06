import {
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TIMEZONE,
  DEFAULT_WEEKLY_HOURS,
  Doctors,
} from "@/constants";
import { isNotFound } from "@/lib/appwrite/client";
import * as doctorRepo from "@/lib/appwrite/doctor.repository";
import type { Doctor } from "@/types/appwrite.types";

import { DoctorSchedule, toDoctorSchedule } from "./schedule";

/** Stable id derived from a name; also the id the setup script seeds. */
export const slugifyName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);

const fallbackSchedule = (id: string): DoctorSchedule => ({
  id,
  slotMinutes: DEFAULT_SLOT_MINUTES,
  timezone: DEFAULT_TIMEZONE,
  weeklyHours: JSON.parse(JSON.stringify(DEFAULT_WEEKLY_HOURS)) as WeeklyHours,
  timeOff: [],
});

export type ResolvedDoctor =
  | { source: "db"; name: string; doc: Doctor; schedule: DoctorSchedule }
  | { source: "fallback"; name: string; schedule: DoctorSchedule };

export const fallbackPublicDoctors = (): PublicDoctor[] =>
  Doctors.map((doctor) => ({
    id: slugifyName(doctor.name),
    name: doctor.name,
    specialty: "General Medicine",
    image: doctor.image,
    slotMinutes: DEFAULT_SLOT_MINUTES,
    timezone: DEFAULT_TIMEZONE,
    legacy: true,
  }));

/** True when the doctors collection is missing or has no documents at all. */
export const doctorsNotConfigured = async (): Promise<boolean> =>
  (await doctorRepo.countDoctors()) === 0;

/**
 * Resolve a physician by name against the doctors collection, falling back to
 * the static `Doctors` constant when the collection is missing or empty so the
 * app keeps working before `scripts/appwrite-setup.mjs` has been run.
 * Returns null for an unknown name once doctors are configured.
 */
export const resolveDoctorByName = async (
  name: string
): Promise<ResolvedDoctor | null> => {
  let doc: Doctor | null = null;
  try {
    doc = await doctorRepo.findDoctorByName(name);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    // Collection missing: treated as "not configured" below.
  }
  if (doc) {
    return { source: "db", name: doc.name, doc, schedule: toDoctorSchedule(doc) };
  }

  if (await doctorsNotConfigured()) {
    const match = Doctors.find((d) => d.name === name);
    return match
      ? {
          source: "fallback",
          name: match.name,
          schedule: fallbackSchedule(slugifyName(match.name)),
        }
      : null;
  }
  return null;
};

/** Resolve by id; null if unknown. No constant fallback (ids are DB-backed). */
export const resolveDoctorById = async (
  doctorId: string
): Promise<Extract<ResolvedDoctor, { source: "db" }> | null> => {
  try {
    const doc = await doctorRepo.getDoctor(doctorId);
    return { source: "db", name: doc.name, doc, schedule: toDoctorSchedule(doc) };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
};
