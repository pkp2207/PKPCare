// Registration draft autosave.
//
// WHY sessionStorage and only these fields:
//  - A half-finished form is lost on refresh, back navigation or a flaky
//    connection, so we keep a draft. sessionStorage is scoped to one tab and is
//    cleared when the tab closes, so nothing survives on a shared computer.
//    localStorage is never used (it persists indefinitely and is shared by all
//    tabs).
//  - Any script on our origin can read web storage, so the draft holds ONLY
//    low-sensitivity contact / preference fields. It NEVER contains: the ID
//    document (file), identification number, insurance policy number, date of
//    birth, allergies / medications / medical history (health data), or the
//    consent ticks (consent must be given deliberately each time).
//  - The allow-list below is the single gate (`sanitizeDraft`); the draft is
//    re-sanitised when read, so a tampered or older-version entry cannot
//    smuggle other fields back into the form.
//  - A draft expires after DRAFT_TTL_MS and is keyed to the userId.
//  - It is cleared on successful registration and on sign-out.

export const DRAFT_VERSION = 1;
export const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
export const DRAFT_KEY_PREFIX = "pkpcare:register-draft:";

/** The only fields that may be persisted. */
export const DRAFT_SAFE_FIELDS = [
  "name",
  "email",
  "phone",
  "gender",
  "address",
  "occupation",
  "emergencyContactName",
  "emergencyContactNumber",
  "primaryPhysician",
  "insuranceProvider",
  "identificationType",
] as const;

/** Documented for tests / reviewers: must never appear in a stored draft. */
export const DRAFT_NEVER_STORED = [
  "birthDate",
  "allergies",
  "currentMedication",
  "familyMedicalHistory",
  "pastMedicalHistory",
  "insurancePolicyNumber",
  "identificationNumber",
  "identificationDocument",
  "treatmentConsent",
  "disclosureConsent",
  "privacyConsent",
] as const;

const MAX_FIELD_LENGTH = 500;

export type DraftValues = Partial<Record<(typeof DRAFT_SAFE_FIELDS)[number], string>>;

export type Draft = { values: DraftValues; step: number };

/** Keeps only allow-listed, string-valued, length-bounded fields. */
export const sanitizeDraft = (values: Record<string, unknown> | null | undefined): DraftValues => {
  const out: DraftValues = {};
  if (!values || typeof values !== "object") return out;
  for (const field of DRAFT_SAFE_FIELDS) {
    const value = values[field];
    if (typeof value === "string" && value.length > 0) {
      out[field] = value.slice(0, MAX_FIELD_LENGTH);
    }
  }
  return out;
};

export const draftKey = (userId: string) => `${DRAFT_KEY_PREFIX}${userId}`;

export const serializeDraft = (
  userId: string,
  values: Record<string, unknown>,
  step: number,
  now: number = Date.now()
): string =>
  JSON.stringify({
    v: DRAFT_VERSION,
    userId,
    savedAt: now,
    step: Number.isInteger(step) && step >= 0 ? step : 0,
    values: sanitizeDraft(values),
  });

/** Parses a stored draft; null if missing, foreign, expired, or malformed. */
export const parseDraft = (
  raw: string | null | undefined,
  userId: string,
  now: number = Date.now()
): Draft | null => {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return null;
    if (data.v !== DRAFT_VERSION || data.userId !== userId) return null;
    if (typeof data.savedAt !== "number" || now - data.savedAt > DRAFT_TTL_MS) return null;
    if (data.savedAt > now + 60_000) return null;

    const values = sanitizeDraft(data.values as Record<string, unknown>);
    if (Object.keys(values).length === 0) return null;
    const step =
      typeof data.step === "number" && Number.isInteger(data.step) && data.step >= 0
        ? data.step
        : 0;
    return { values, step };
  } catch {
    return null;
  }
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** All storage access is best effort: private mode / quota errors are ignored. */
export const saveDraft = (
  storage: StorageLike | null | undefined,
  userId: string,
  values: Record<string, unknown>,
  step: number,
  now?: number
): void => {
  if (!storage) return;
  try {
    const payload = serializeDraft(userId, values, step, now);
    storage.setItem(draftKey(userId), payload);
  } catch {
    // ignore
  }
};

export const loadDraft = (
  storage: StorageLike | null | undefined,
  userId: string,
  now?: number
): Draft | null => {
  if (!storage) return null;
  try {
    const draft = parseDraft(storage.getItem(draftKey(userId)), userId, now);
    if (!draft) storage.removeItem(draftKey(userId));
    return draft;
  } catch {
    return null;
  }
};

export const clearDraft = (storage: StorageLike | null | undefined, userId: string): void => {
  if (!storage) return;
  try {
    storage.removeItem(draftKey(userId));
  } catch {
    // ignore
  }
};

/** Removes every registration draft (used on sign-out). */
export const clearAllDrafts = (storage: (StorageLike & Pick<Storage, "length" | "key">) | null | undefined): void => {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // ignore
  }
};

/** sessionStorage if available (browser), else null. Never localStorage. */
export const getSessionStore = (): Storage | null => {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
};
