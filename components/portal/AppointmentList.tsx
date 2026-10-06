"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { StatusBadge } from "@/components/StatusBadge";

import {
  CancelAppointment,
  JoinVideoButton,
  RescheduleAppointment,
} from "./AppointmentActions";
import {
  canModifyAppointment,
  type DashboardAppointment,
  findDoctorFor,
  isVideoVisit,
} from "./appointments";
import { browserTimeZone, formatSlotLong, timeZoneOffsetLabel } from "./slots";

type Doctor = PublicDoctor;

const Card = ({
  appointment,
  doctors,
  userId,
  zone,
  editable,
  onDone,
}: {
  appointment: DashboardAppointment;
  doctors: Doctor[];
  userId: string;
  zone: string | null;
  editable: boolean;
  onDone: (message: string) => void;
}) => {
  const doctor = findDoctorFor(appointment, doctors);
  // Legacy appointments have no schedule timezone: show the patient's own.
  const tz = doctor && !doctor.legacy ? doctor.timezone : (zone ?? "UTC");
  const iso = new Date(appointment.schedule).toISOString();
  const when = `${formatSlotLong(iso, tz)} (${timeZoneOffsetLabel(tz, iso)})`;
  const name = `Dr. ${doctor?.name ?? appointment.primaryPhysician}`;
  const label = `${name}, ${when}`;
  const video = isVideoVisit(appointment);
  const modifiable = editable && canModifyAppointment(appointment);

  return (
    <li className="space-y-4 rounded-xl border border-dark-500 bg-dark-400 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-16-semibold text-white">{name}</h3>
          {doctor && <p className="text-14-regular text-dark-700">{doctor.specialty}</p>}
          <p className="text-14-medium text-white">
            <time dateTime={iso}>{when}</time>
          </p>
          <p className="text-14-regular text-dark-700">
            {video ? "Video visit" : "In person"}
            {appointment.reason ? ` - ${appointment.reason}` : ""}
          </p>
          {appointment.status === "cancelled" && appointment.cancellationReason && (
            <p className="text-14-regular text-dark-700">
              Cancellation reason: {appointment.cancellationReason}
            </p>
          )}
        </div>
        <StatusBadge status={appointment.status} />
      </div>

      {modifiable && (
        <div className="flex flex-wrap items-start gap-2">
          {video && appointment.status === "scheduled" && (
            <JoinVideoButton appointmentId={appointment.$id} timeZone={tz} />
          )}
          <RescheduleAppointment
            appointment={appointment}
            doctor={doctor}
            userId={userId}
            label={label}
            onDone={onDone}
          />
          <CancelAppointment
            appointment={appointment}
            userId={userId}
            label={label}
            onDone={onDone}
          />
        </div>
      )}
    </li>
  );
};

const Section = ({
  title,
  empty,
  items,
  ...rest
}: {
  title: string;
  empty: string;
  items: DashboardAppointment[];
  doctors: Doctor[];
  userId: string;
  zone: string | null;
  editable: boolean;
  onDone: (message: string) => void;
}) => (
  <section aria-labelledby={`${title.replace(/\s/g, "-")}-heading`} className="space-y-4">
    <h2 id={`${title.replace(/\s/g, "-")}-heading`} className="sub-header">
      {title}
    </h2>
    {items.length === 0 ? (
      <p className="text-14-regular text-dark-700">{empty}</p>
    ) : (
      <ul className="space-y-4">
        {items.map((appointment) => (
          <Card key={appointment.$id} appointment={appointment} {...rest} />
        ))}
      </ul>
    )}
  </section>
);

export const AppointmentList = ({
  userId,
  upcoming,
  past,
  doctors,
}: {
  userId: string;
  upcoming: DashboardAppointment[];
  past: DashboardAppointment[];
  doctors: PublicDoctor[];
}) => {
  const router = useRouter();
  const [zone, setZone] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => setZone(browserTimeZone()), []);

  const onDone = (message: string) => {
    setNotice(message);
    router.refresh();
    // The acted-on row may disappear; move focus to the confirmation.
    setTimeout(() => noticeRef.current?.focus(), 50);
  };

  return (
    <div className="space-y-10">
      <div
        ref={noticeRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
      >
        {notice && (
          <p className="text-14-regular rounded-md border border-green-500 bg-green-600 p-3 text-white">
            {notice}
          </p>
        )}
      </div>
      <Section
        title="Upcoming appointments"
        empty="You have no upcoming appointments."
        items={upcoming}
        doctors={doctors}
        userId={userId}
        zone={zone}
        editable
        onDone={onDone}
      />
      <Section
        title="Past and cancelled"
        empty="Nothing here yet."
        items={past}
        doctors={doctors}
        userId={userId}
        zone={zone}
        editable={false}
        onDone={onDone}
      />
    </div>
  );
};
