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

declare type CreateAppointmentParams = {
  userId: string;
  patient: string;
  primaryPhysician: string;
  reason: string;
  schedule: Date;
  note: string | undefined;
};

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
