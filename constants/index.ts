export const GenderOptions = ["Male", "Female", "Other"];

export const PatientFormDefaultValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  birthDate: new Date(Date.now()),
  gender: "Male" as Gender,
  address: "",
  occupation: "",
  emergencyContactName: "",
  emergencyContactNumber: "",
  primaryPhysician: "",
  insuranceProvider: "",
  insurancePolicyNumber: "",
  allergies: "",
  currentMedication: "",
  familyMedicalHistory: "",
  pastMedicalHistory: "",
  identificationType: "Birth Certificate",
  identificationNumber: "",
  identificationDocument: [],
  treatmentConsent: false,
  disclosureConsent: false,
  privacyConsent: false,
};

export const IdentificationTypes = [
  "Birth Certificate",
  "Driver's License",
  "Medical Insurance Card/Policy",
  "Military ID Card",
  "National Identity Card",
  "Passport",
  "Resident Alien Card (Green Card)",
  "Social Security Card",
  "State ID Card",
  "Student ID Card",
  "Voter ID Card",
];

export const Doctors = [
  {
    image: "/assets/images/dr-green.png",
    name: "John Green",
  },
  {
    image: "/assets/images/dr-cameron.png",
    name: "Leila Cameron",
  },
  {
    image: "/assets/images/dr-livingston.png",
    name: "David Livingston",
  },
  {
    image: "/assets/images/dr-peter.png",
    name: "Evan Peter",
  },
  {
    image: "/assets/images/dr-powell.png",
    name: "Jane Powell",
  },
  {
    image: "/assets/images/dr-remirez.png",
    name: "Alex Ramirez",
  },
  {
    image: "/assets/images/dr-lee.png",
    name: "Jasmine Lee",
  },
  {
    image: "/assets/images/dr-cruz.png",
    name: "Alyana Cruz",
  },
  {
    image: "/assets/images/dr-sharma.png",
    name: "Hardik Sharma",
  },
];

export const StatusIcon = {
  scheduled: "/assets/icons/check.svg",
  pending: "/assets/icons/pending.svg",
  cancelled: "/assets/icons/cancelled.svg",
};

// Appointment slot length; two non-cancelled appointments for the same doctor
// closer than this are considered a double booking.
export const APPOINTMENT_SLOT_MINUTES = 30;

// Tolerance when rejecting past appointment times (client/server clock skew).
export const APPOINTMENT_CLOCK_SKEW_MINUTES = 5;

// ---------------------------------------------------------------------------
// Scheduling (see docs/scheduling.md)
// ---------------------------------------------------------------------------

// Fixed collection ids, created by `scripts/appwrite-setup.mjs`. The patients
// and appointments collections keep using the env-configured ids.
export const DOCTORS_COLLECTION_ID = "doctors";
export const SLOTS_COLLECTION_ID = "slots";
export const WAITLIST_COLLECTION_ID = "waitlist";

// Fallback slot length for doctors that have none configured.
export const DEFAULT_SLOT_MINUTES = 30;
export const DEFAULT_TIMEZONE = "UTC";

// Bookings must start at least this far in the future...
export const BOOKING_MIN_LEAD_MINUTES = 60;
// ...and no further out than this.
export const BOOKING_MAX_HORIZON_DAYS = 90;

// getAvailability() refuses windows wider than this.
export const AVAILABILITY_MAX_WINDOW_DAYS = 14;

// A slot document whose appointment never materialised (crashed between the
// two writes) is only reaped once it is older than this, so an in-flight
// booking is never mistaken for an orphan.
export const ORPHAN_SLOT_GRACE_MINUTES = 2;

export const MAX_ACTIVE_WAITLIST_ENTRIES = 10;
export const MAX_TIME_OFF_ENTRIES = 100;

export const VISIT_TYPES = ["in_person", "video"] as const;

export const DEFAULT_WEEKLY_HOURS = {
  mon: [["09:00", "17:00"]],
  tue: [["09:00", "17:00"]],
  wed: [["09:00", "17:00"]],
  thu: [["09:00", "17:00"]],
  fri: [["09:00", "17:00"]],
  sat: [],
  sun: [],
} as const;
