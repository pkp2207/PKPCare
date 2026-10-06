/* eslint-disable no-unused-vars */

declare type SearchParamProps = {
  params: { [key: string]: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

declare type Gender = "Male" | "Female" | "Other";
declare type Status = "pending" | "scheduled" | "cancelled";

declare interface CreateUserParams {
  name: string;
  email: string;
  phone: string;
}

declare interface User extends CreateUserParams {
  $id: string;
}

declare interface RegisterUserParams extends CreateUserParams {
  userId: string;
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
  // FormData is the transport format from the form; the repository converts it
  // to identificationDocumentId + identificationDocumentUrl before storage.
  identificationDocument: FormData | undefined;
  privacyConsent: boolean;
  treatmentConsent: boolean;
  disclosureConsent: boolean;
}

declare type VisitType = "in_person" | "video";

// Legacy shape: `primaryPhysician` (doctor name) + `schedule`. New shape:
// `doctorId` + `slotStart` (atomic booking, see docs/scheduling.md). At least
// one of the two pairs is required; the new pair wins when both are present.
declare type CreateAppointmentParams = {
  userId: string;
  patient: string;
  primaryPhysician?: string;
  reason: string;
  schedule?: Date;
  note: string | undefined;
  doctorId?: string;
  slotStart?: Date | string;
  visitType?: VisitType;
};

declare type CancelMyAppointmentParams = {
  appointmentId: string;
  userId: string;
  reason: string;
};

declare type RescheduleAppointmentParams = {
  appointmentId: string;
  userId: string;
  newStart: Date | string;
};

declare type AvailabilityParams = {
  doctorId: string;
  from: Date | string;
  to: Date | string;
};

declare type AvailabilitySlot = { start: string; end: string };

// Public doctor projection: never includes email / staffUserId.
declare type PublicDoctor = {
  id: string;
  name: string;
  specialty: string;
  image: string;
  slotMinutes: number;
  timezone: string;
  // True when served from the static fallback list (doctors collection not set up).
  legacy?: boolean;
};

declare type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
declare type WeeklyHours = Partial<Record<WeekdayKey, [string, string][]>>;
declare type TimeOffEntry = { start: string; end: string; reason?: string };

declare type UpsertDoctorParams = {
  id?: string;
  name: string;
  specialty: string;
  image: string;
  email?: string | null;
  staffUserId?: string | null;
  active?: boolean;
  slotMinutes?: number;
  timezone?: string;
  weeklyHours?: WeeklyHours;
  timeOff?: TimeOffEntry[];
};

declare type JoinWaitlistParams = {
  userId: string;
  patientId: string;
  doctorId: string;
  earliest: Date | string;
  latest: Date | string;
};

declare type LeaveWaitlistParams = { entryId: string; userId: string };

// Server actions never throw to the client; every action resolves to this.
declare type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

declare type UpdateAppointmentParams = {
  appointmentId: string;
  userId: string;
  // Only these fields are read by the server; status is derived from `type`.
  appointment: {
    primaryPhysician: string;
    schedule: Date;
    status?: Status;
    cancellationReason?: string | null;
  };
  type: "schedule" | "cancel" | (string & {});
};

declare type RecentAppointmentList = {
  totalCount: number;
  scheduledCount: number;
  pendingCount: number;
  cancelledCount: number;
  documents: import("@/types/appwrite.types").Appointment[];
  page: number;
  pageSize: number;
  totalPages: number;
};
