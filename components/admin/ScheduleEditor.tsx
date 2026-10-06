"use client";

import type { AdminDoctor } from "@/lib/actions/admin.actions";

import { DoctorForm } from "./DoctorForm";
import { ui } from "./ui";

/** Doctor-role self-service: own hours, slot length, timezone and time off. */
export function ScheduleEditor({ doctor }: { doctor: AdminDoctor }) {
  return (
    <section aria-labelledby="hours-heading" className={ui.card}>
      <h2 id="hours-heading" className="sub-header mb-4">
        My working hours
      </h2>
      <DoctorForm doctor={doctor} mode="self" />
    </section>
  );
}
