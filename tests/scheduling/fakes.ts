// In-memory stand-ins for the Appwrite repositories. Wired into the actions
// with vi.mock(path, async () => (await import("./fakes")).xRepo).
import { vi } from "vitest";

type Doc = Record<string, any> & { $id: string; $createdAt: string };

export const db = {
  doctors: new Map<string, Doc>(),
  slots: new Map<string, Doc>(),
  appointments: new Map<string, Doc>(),
  patients: new Map<string, Doc>(),
  waitlist: new Map<string, Doc>(),
  sms: [] as { userId: string; content: string }[],
  counters: { appt: 0, wait: 0, doctor: 0 },
  failNextAppointmentCreate: false,
  failNextAppointmentUpdate: false,
  listCalls: [] as any[],
  countCalls: [] as any[],
};

export const resetDb = () => {
  db.doctors.clear();
  db.slots.clear();
  db.appointments.clear();
  db.patients.clear();
  db.waitlist.clear();
  db.sms.length = 0;
  db.counters = { appt: 0, wait: 0, doctor: 0 };
  db.failNextAppointmentCreate = false;
  db.failNextAppointmentUpdate = false;
  db.listCalls.length = 0;
  db.countCalls.length = 0;
};

const err = (code: number, message = `fake ${code}`) =>
  Object.assign(new Error(message), { code });

const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : (value as string);

const stamp = () => new Date().toISOString();

const ISO_FIELDS = new Set([
  "start",
  "end",
  "schedule",
  "earliest",
  "latest",
]);
const normalise = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, ISO_FIELDS.has(k) ? iso(v) : v])
  );

// ---- doctors ---------------------------------------------------------------
export const doctorRepo = {
  generateDoctorId: () => `gen-doctor-${(db.counters.doctor += 1)}`,
  listDoctors: vi.fn(async ({ activeOnly = false } = {}) =>
    Array.from(db.doctors.values()).filter((d) => !activeOnly || d.active)
  ),
  countDoctors: vi.fn(async () => db.doctors.size),
  getDoctor: vi.fn(async (id: string) => {
    const doc = db.doctors.get(id);
    if (!doc) throw err(404);
    return doc;
  }),
  findDoctorByName: vi.fn(
    async (name: string) =>
      Array.from(db.doctors.values()).find((d) => d.name === name) ?? null
  ),
  findDoctorByStaffUserId: vi.fn(
    async (id: string) =>
      Array.from(db.doctors.values()).find((d) => d.staffUserId === id) ?? null
  ),
  createDoctor: vi.fn(async (id: string, data: Record<string, unknown>) => {
    const doc = { ...data, $id: id, $createdAt: stamp() } as Doc;
    db.doctors.set(id, doc);
    return doc;
  }),
  updateDoctor: vi.fn(async (id: string, data: Record<string, unknown>) => {
    const doc = db.doctors.get(id);
    if (!doc) throw err(404);
    Object.assign(doc, data);
    return doc;
  }),
};

// ---- slots -----------------------------------------------------------------
export const slotRepo = {
  createSlot: vi.fn(async ({ id, ...data }: any) => {
    await Promise.resolve(); // yield so concurrent callers interleave
    if (db.slots.has(id)) throw err(409);
    const doc = {
      ...normalise(data),
      $id: id,
      $createdAt: stamp(),
    } as Doc;
    db.slots.set(id, doc);
    return doc;
  }),
  getSlot: vi.fn(async (id: string) => {
    const doc = db.slots.get(id);
    if (!doc) throw err(404);
    return { ...doc };
  }),
  deleteSlot: vi.fn(async (id: string) => {
    db.slots.delete(id);
  }),
  listSlots: vi.fn(async (doctorId: string, from: Date, to: Date) =>
    Array.from(db.slots.values()).filter(
      (s) =>
        s.doctorId === doctorId &&
        Date.parse(s.start) >= from.getTime() &&
        Date.parse(s.start) < to.getTime()
    )
  ),
};

// ---- appointments ----------------------------------------------------------
export const appointmentRepo = {
  generateAppointmentId: () => `appt${(db.counters.appt += 1)}`,
  createAppointmentDocument: vi.fn(async (data: any, id?: string) => {
    if (db.failNextAppointmentCreate) {
      db.failNextAppointmentCreate = false;
      throw err(500, "boom");
    }
    const $id = id ?? `appt${(db.counters.appt += 1)}`;
    const doc = { ...normalise(data), $id, $createdAt: stamp() } as Doc;
    db.appointments.set($id, doc);
    return doc;
  }),
  getAppointmentDocument: vi.fn(async (id: string) => {
    const doc = db.appointments.get(id);
    if (!doc) throw err(404);
    return { ...doc }; // a copy, like a real fetch
  }),
  updateAppointmentDocument: vi.fn(async (id: string, data: any) => {
    if (db.failNextAppointmentUpdate) {
      db.failNextAppointmentUpdate = false;
      throw err(500, "boom");
    }
    const doc = db.appointments.get(id);
    if (!doc) throw err(404);
    Object.assign(doc, normalise(data));
    return doc;
  }),
  listAppointments: vi.fn(async (args: any) => {
    db.listCalls.push(args);
    const docs = Array.from(db.appointments.values()).filter(
      (a) =>
        (!args.doctorId || a.doctorId === args.doctorId) &&
        (!args.status || a.status === args.status)
    );
    return { total: docs.length, documents: docs };
  }),
  countAppointments: vi.fn(async (status?: string, doctorId?: string) => {
    db.countCalls.push({ status, doctorId });
    return Array.from(db.appointments.values()).filter(
      (a) =>
        (!doctorId || a.doctorId === doctorId) &&
        (!status || a.status === status)
    ).length;
  }),
  listAppointmentsByUser: vi.fn(async (userId: string) =>
    Array.from(db.appointments.values()).filter((a) => a.userId === userId)
  ),
  findConflictingAppointment: vi.fn(async (q: any) => {
    return (
      Array.from(db.appointments.values()).find(
        (a) =>
          a.primaryPhysician === q.primaryPhysician &&
          a.status !== "cancelled" &&
          a.$id !== q.excludeId &&
          Date.parse(a.schedule) > q.after.getTime() &&
          Date.parse(a.schedule) < q.before.getTime()
      ) ?? null
    );
  }),
  listActiveScheduleTimes: vi.fn(
    async (physician: string, from: Date, to: Date) =>
      Array.from(db.appointments.values())
        .filter(
          (a) =>
            a.primaryPhysician === physician &&
            a.status !== "cancelled" &&
            Date.parse(a.schedule) >= from.getTime() &&
            Date.parse(a.schedule) < to.getTime()
        )
        .map((a) => a.schedule as string)
  ),
  sendSms: vi.fn(async (userId: string, content: string) => {
    db.sms.push({ userId, content });
  }),
};

// ---- patients --------------------------------------------------------------
export const patientRepo = {
  getPatientByUserId: vi.fn(async (userId: string) => {
    return Array.from(db.patients.values()).find((p) => p.userId === userId) ?? null;
  }),
  getUser: vi.fn(async (userId: string) => ({ $id: userId })),
  createUser: vi.fn(),
  uploadIdentificationFile: vi.fn(),
  deleteFile: vi.fn(),
  createPatientDocument: vi.fn(async (data: any) => {
    const doc = { ...data, $id: `patient-${data.userId}`, $createdAt: stamp() };
    db.patients.set(doc.$id, doc);
    return doc;
  }),
};

// ---- waitlist --------------------------------------------------------------
export const waitlistRepo = {
  createWaitlistEntry: vi.fn(async (data: any) => {
    const $id = `wait${(db.counters.wait += 1)}`;
    const doc = {
      ...normalise(data),
      status: "waiting",
      createdAt: new Date().toISOString(),
      $id,
      $createdAt: stamp(),
    } as Doc;
    db.waitlist.set($id, doc);
    return doc;
  }),
  getWaitlistEntry: vi.fn(async (id: string) => {
    const doc = db.waitlist.get(id);
    if (!doc) throw err(404);
    return doc;
  }),
  updateWaitlistEntry: vi.fn(async (id: string, data: any) => {
    const doc = db.waitlist.get(id);
    if (!doc) throw err(404);
    Object.assign(doc, data);
    return doc;
  }),
  deleteWaitlistEntry: vi.fn(async (id: string) => {
    db.waitlist.delete(id);
  }),
  listActiveEntriesForUser: vi.fn(async (userId: string) =>
    Array.from(db.waitlist.values()).filter(
      (w) =>
        w.userId === userId && ["waiting", "offered"].includes(w.status)
    )
  ),
  listWaitingForDoctor: vi.fn(async (doctorId: string) =>
    Array.from(db.waitlist.values()).filter(
      (w) => w.doctorId === doctorId && w.status === "waiting"
    )
  ),
};

// ---- fixtures --------------------------------------------------------------
export const addDoctor = (overrides: Record<string, unknown> = {}) => {
  const doc = {
    $id: "doc1",
    $createdAt: stamp(),
    name: "Test Doc",
    specialty: "GP",
    image: "/x.png",
    email: "doc@example.com",
    staffUserId: null,
    active: true,
    slotMinutes: 30,
    timezone: "UTC",
    weeklyHours: JSON.stringify({
      mon: [["09:00", "17:00"]],
      tue: [["09:00", "17:00"]],
      wed: [["09:00", "17:00"]],
      thu: [["09:00", "17:00"]],
      fri: [["09:00", "17:00"]],
    }),
    timeOff: "[]",
    ...overrides,
  } as Doc;
  db.doctors.set(doc.$id, doc);
  return doc;
};

export const addPatient = (userId: string) => {
  const doc = {
    $id: `patient-${userId}`,
    $createdAt: stamp(),
    userId,
    name: "Pat",
  } as Doc;
  db.patients.set(doc.$id, doc);
  return doc;
};
