"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminDoctor, StaffMember } from "@/lib/actions/admin.actions";
import { setDoctorActive } from "@/lib/actions/doctor.actions";
import { cn } from "@/lib/utils";

import { DoctorForm } from "./DoctorForm";
import { ui } from "./ui";
import {
  fromWeeklyHours,
  summarizeDay,
  WEEK_ORDER,
  WEEKDAY_LABELS,
} from "./weekly-hours";

export function DoctorsManager({
  doctors,
  doctorStaff,
}: {
  doctors: AdminDoctor[];
  doctorStaff: StaffMember[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  // Resolve from props so time-off edits show up after router.refresh().
  const editing: AdminDoctor | "new" | null =
    editingId === "new"
      ? "new"
      : (doctors.find((d) => d.id === editingId) ?? null);
  const setEditing = (value: AdminDoctor | "new" | null) =>
    setEditingId(value === null ? null : value === "new" ? "new" : value.id);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (doctor: AdminDoctor) =>
    startTransition(async () => {
      setError(null);
      const result = await setDoctorActive({ doctorId: doctor.id, active: !doctor.active });
      if (!result.ok) setError(result.error);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className={ui.btnPrimary} onClick={() => setEditing("new")}>
          Add doctor
        </button>
      </div>
      {error && <p role="alert" className={ui.error}>{error}</p>}

      {doctors.length === 0 ? (
        <p className="text-dark-700">
          No doctors yet. Run the setup script with --seed-doctors or add one here.
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {doctors.map((doctor) => {
            const model = fromWeeklyHours(doctor.weeklyHours);
            return (
              <li key={doctor.id} className={ui.card}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-18-bold">{doctor.name}</h2>
                    <p className="text-14-regular text-dark-700">
                      {doctor.specialty} &middot; {doctor.slotMinutes} min &middot; {doctor.timezone}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-12-semibold rounded-full px-3 py-1",
                      doctor.active ? "bg-green-600 text-green-500" : "bg-red-600 text-red-500"
                    )}
                  >
                    {doctor.active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="text-12-regular mt-2 text-dark-700">
                  {doctor.staffUserId ? "Linked to a staff login" : "No staff login linked"}
                  {doctor.email ? ` - ${doctor.email}` : ""}
                </p>
                <dl className="text-14-regular mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {WEEK_ORDER.map((day) => (
                    <div key={day} className="contents">
                      <dt className="text-dark-700">{WEEKDAY_LABELS[day].slice(0, 3)}</dt>
                      <dd>{summarizeDay(model[day])}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => setEditing(doctor)}>
                    Edit<span className="sr-only"> {doctor.name}</span>
                  </button>
                  <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} disabled={pending} onClick={() => toggle(doctor)}>
                    {doctor.active ? "Deactivate" : "Activate"}
                    <span className="sr-only"> {doctor.name}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className={cn(ui.dialog, "sm:max-w-3xl")}>
          <DialogHeader>
            <DialogTitle className="text-white">
              {editing === "new" ? "Add doctor" : `Edit ${editing?.name ?? ""}`}
            </DialogTitle>
            <DialogDescription>
              Working hours use the doctor&apos;s local time. Changes apply to new bookings immediately.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <DoctorForm
              key={editing === "new" ? "new" : editing.id}
              doctor={editing === "new" ? null : editing}
              doctorStaff={doctorStaff}
              mode="admin"
              onSaved={() => editing === "new" && setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
