import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ErrorState } from "@/components/ErrorState";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { formatSlotLong, timeZoneOffsetLabel } from "@/components/portal/slots";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/portal/styles";
import { Button } from "@/components/ui/button";
import { getAppointment } from "@/lib/actions/appointment.actions";
import { listDoctors } from "@/lib/actions/doctor.actions";
import { isPatientAuthEnforced } from "@/lib/auth/patient";

export const dynamic = "force-dynamic";

const RequestSuccess = async ({
  searchParams,
  params: { userId },
}: SearchParamProps) => {
  const appointmentId = (searchParams?.appointmentId as string) || "";
  if (!appointmentId) notFound();

  const [result, doctorsResult] = await Promise.all([
    getAppointment(appointmentId, userId),
    listDoctors(),
  ]);

  if (!result.ok) {
    return (
      <ErrorState
        title="Couldn't load your appointment"
        message={result.error}
        href={`/patients/${userId}/new-appointment`}
        linkLabel="Book an appointment"
      />
    );
  }

  const appointment = result.data;
  const doctors = doctorsResult.ok ? doctorsResult.data : [];
  const doctor =
    doctors.find((d) => d.id === appointment.doctorId) ??
    doctors.find((d) => d.name === appointment.primaryPhysician);
  const tz = doctor && !doctor.legacy ? doctor.timezone : "UTC";
  const iso = new Date(appointment.schedule).toISOString();
  const base = `/patients/${encodeURIComponent(userId)}`;

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-[5%] py-6 sm:px-6">
      <PortalHeader
        userId={userId}
        enforced={isPatientAuthEnforced()}
        current="new-appointment"
      />

      <main id="main" className="flex flex-col items-center gap-8 py-10 text-center">
        <Image
          src="/assets/gifs/success.gif"
          height={300}
          width={280}
          alt=""
          aria-hidden="true"
          unoptimized
          className="motion-reduce:hidden"
        />
        <h1 className="header max-w-[600px]" tabIndex={-1}>
          Your <span className="text-green-500">appointment request</span> has been
          submitted
        </h1>
        <p role="status">We&apos;ll be in touch shortly to confirm.</p>

        <section
          aria-label="Requested appointment details"
          className="request-details text-left"
        >
          <div className="flex items-center gap-3">
            <Image
              src={doctor?.image ?? "/assets/images/dr-green.png"}
              alt=""
              aria-hidden="true"
              width={100}
              height={100}
              className="size-6"
            />
            <p>Dr. {doctor?.name ?? appointment.primaryPhysician}</p>
          </div>
          <div className="flex gap-2">
            <Image
              src="/assets/icons/calendar.svg"
              height={24}
              width={24}
              alt=""
              aria-hidden="true"
            />
            <p>
              {formatSlotLong(iso, tz)} ({timeZoneOffsetLabel(tz, iso)})
              {appointment.visitType === "video" ? " - video visit" : ""}
            </p>
          </div>
        </section>

        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild className={BTN_PRIMARY}>
            <Link href={base}>My appointments</Link>
          </Button>
          <Button asChild className={BTN_SECONDARY}>
            <Link href={`${base}/new-appointment`}>New appointment</Link>
          </Button>
        </div>
      </main>
    </div>
  );
};

export default RequestSuccess;
