"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { AdminDoctor, StaffMember } from "@/lib/actions/admin.actions";
import { upsertDoctor } from "@/lib/actions/doctor.actions";

import { TimeOffManager } from "./TimeOffManager";
import { ui } from "./ui";
import {
  fromWeeklyHours,
  toWeeklyHours,
  validateModel,
  type WeeklyModel,
} from "./weekly-hours";
import { WeeklyHoursEditor } from "./WeeklyHoursEditor";

/**
 * Create / edit a doctor. `mode="admin"` edits everything; `mode="self"` (the
 * doctor role) shows only hours, slot length and timezone, matching what
 * upsertDoctor accepts from that role.
 */
export function DoctorForm({
  doctor,
  doctorStaff = [],
  mode,
  onSaved,
}: {
  doctor: AdminDoctor | null;
  doctorStaff?: StaffMember[];
  mode: "admin" | "self";
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(doctor?.name ?? "");
  const [specialty, setSpecialty] = useState(doctor?.specialty ?? "General Medicine");
  const [image, setImage] = useState(doctor?.image ?? "/assets/images/dr-green.png");
  const [email, setEmail] = useState(doctor?.email ?? "");
  const [staffUserId, setStaffUserId] = useState(doctor?.staffUserId ?? "");
  const [active, setActive] = useState(doctor?.active ?? true);
  const [slotMinutes, setSlotMinutes] = useState(String(doctor?.slotMinutes ?? 30));
  const [timezone, setTimezone] = useState(doctor?.timezone ?? "UTC");
  const [hours, setHours] = useState<WeeklyModel>(() => fromWeeklyHours(doctor?.weeklyHours));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const hourErrors = useMemo(() => validateModel(hours), [hours]);
  const slotNumber = Number(slotMinutes);
  const slotValid = Number.isInteger(slotNumber) && slotNumber >= 5 && slotNumber <= 240;
  const admin = mode === "admin";

  const save = () =>
    startTransition(async () => {
      setError(null);
      setSaved(false);
      if (hourErrors.length > 0) {
        setError("Fix the highlighted working hours first.");
        return;
      }
      if (!slotValid) {
        setError("Slot length must be a whole number from 5 to 240 minutes.");
        return;
      }
      const result = await upsertDoctor({
        ...(doctor ? { id: doctor.id } : {}),
        name: name.trim(),
        specialty: specialty.trim(),
        image: image.trim(),
        email: email.trim() || null,
        staffUserId: staffUserId || null,
        active,
        slotMinutes: slotNumber,
        timezone: timezone.trim(),
        weeklyHours: toWeeklyHours(hours),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
      onSaved?.();
    });

  return (
    <div className="space-y-6">
      {admin && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="d-name" label="Name">
            <input id="d-name" className={ui.input} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="d-spec" label="Specialty">
            <input id="d-spec" className={ui.input} value={specialty} maxLength={100} onChange={(e) => setSpecialty(e.target.value)} />
          </Field>
          <Field id="d-img" label="Image URL or path">
            <input id="d-img" className={ui.input} value={image} maxLength={500} onChange={(e) => setImage(e.target.value)} />
          </Field>
          <Field id="d-email" label="Email (never shown publicly)">
            <input id="d-email" type="email" className={ui.input} value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="d-staff" label="Linked staff login (doctor role)">
            <select id="d-staff" className={ui.input} value={staffUserId} onChange={(e) => setStaffUserId(e.target.value)}>
              <option value="">Not linked</option>
              {doctorStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.email})
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <label className="text-14-medium flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-4 accent-green-500" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active (bookable)
            </label>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="d-slot" label="Slot length (minutes, 5-240)">
          <input
            id="d-slot"
            type="number"
            min={5}
            max={240}
            className={ui.input}
            value={slotMinutes}
            aria-invalid={!slotValid}
            onChange={(e) => setSlotMinutes(e.target.value)}
          />
        </Field>
        <Field id="d-tz" label="Timezone (IANA, e.g. Asia/Kolkata)">
          <input id="d-tz" className={ui.input} value={timezone} maxLength={64} onChange={(e) => setTimezone(e.target.value)} />
        </Field>
      </div>

      <WeeklyHoursEditor value={hours} onChange={setHours} errors={hourErrors} />

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={ui.btnPrimary} disabled={pending} onClick={save}>
          {pending ? "Saving..." : doctor ? "Save changes" : "Create doctor"}
        </button>
        <div role="status" aria-live="polite">
          {saved && <p className="text-14-regular text-green-500">Saved.</p>}
        </div>
      </div>
      {error && <p role="alert" className={ui.error}>{error}</p>}

      {doctor && <TimeOffManager doctor={doctor} />}
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={ui.label}>
        {label}
      </label>
      {children}
    </div>
  );
}
