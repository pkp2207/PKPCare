import { Models } from "node-appwrite";

export interface Patient extends Models.Document {
  userId: string;
  name: string;
  email: string;
  phone: string;
  birthDate: Date;
  gender: Gender;
  address: string;
  occupation: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  primaryPhysician: string;
  insuranceProvider: string;
  insurancePolicyNumber: string;
  allergies: string | undefined;
  currentMedication: string | undefined;
  familyMedicalHistory: string | undefined;
  pastMedicalHistory: string | undefined;
  identificationType: string | undefined;
  identificationNumber: string | undefined;
  // Appwrite stores the uploaded file as two string fields, not a FormData object.
  identificationDocumentId: string | undefined;
  identificationDocumentUrl: string | undefined;
  privacyConsent: boolean;
  treatmentConsent: boolean;
  disclosureConsent: boolean;
}

export type CancelledBy = "patient" | "staff" | "system";

export interface Appointment extends Models.Document {
  patient: Patient;
  schedule: Date;
  status: Status;
  primaryPhysician: string;
  reason: string;
  note: string;
  userId: string;
  cancellationReason: string | null;
  // Added by the scheduling data model; absent on legacy appointments.
  doctorId?: string | null;
  slotId?: string | null;
  visitType?: VisitType | null;
  reminderSentAt?: string | null;
  cancelledBy?: CancelledBy | null;
}

// Raw `doctors` document. weeklyHours/timeOff are JSON strings in storage; use
// `toDoctorSchedule` (lib/scheduling) to get the parsed form.
export interface Doctor extends Models.Document {
  name: string;
  specialty: string;
  image: string;
  email?: string | null;
  staffUserId?: string | null;
  active: boolean;
  slotMinutes: number;
  timezone: string;
  weeklyHours: string;
  timeOff: string;
}

export type SlotStatus = "booked" | "blocked";

export interface Slot extends Models.Document {
  doctorId: string;
  start: string;
  end: string;
  appointmentId?: string | null;
  status: SlotStatus;
}

export type WaitlistStatus = "waiting" | "offered" | "fulfilled" | "expired";

export interface WaitlistEntry extends Models.Document {
  userId: string;
  patientId: string;
  doctorId: string;
  earliest: string;
  latest: string;
  status: WaitlistStatus;
  createdAt: string;
  offeredStart?: string | null;
  offeredAt?: string | null;
}
