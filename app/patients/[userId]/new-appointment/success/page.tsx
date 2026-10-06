import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Doctors } from "@/constants";
import { getAppointment } from "@/lib/actions/appointment.actions";
import { formatDateTime } from "@/lib/utils";

const RequestSuccess = async ({
  searchParams,
  params: { userId },
}: SearchParamProps) => {
  const appointmentId = (searchParams?.appointmentId as string) || "";
  if (!appointmentId) notFound();

  const result = await getAppointment(appointmentId, userId);

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

  const doctor = Doctors.find(
    (doctor) => doctor.name === appointment.primaryPhysician
  );

  return (
    <div className=" flex h-screen max-h-screen px-[5%]">
      <div className="success-img">
        <Link href="/">
          <Image
            src="/assets/icons/logo-full-pkp.png"
            height={200}
            width={200}
            alt="PKPCare"
            className="w-fit"
          />
        </Link>

        <section className="flex flex-col items-center">
          <Image
            src="/assets/gifs/success.gif"
            height={300}
            width={280}
            alt="success"
          />
          <h2 className="header mb-6 max-w-[600px] text-center">
            Your <span className="text-green-500">appointment request</span> has
            been successfully submitted!
          </h2>
          <p>We&apos;ll be in touch shortly to confirm.</p>
        </section>

        <section className="request-details">
          <p>Requested appointment details: </p>
          <div className="flex items-center gap-3">
            <Image
              src={doctor?.image ?? "/assets/images/dr-green.png"}
              alt=""
              aria-hidden="true"
              width={100}
              height={100}
              className="size-6"
            />
            <p className="whitespace-nowrap">
              Dr. {doctor?.name ?? appointment.primaryPhysician}
            </p>
          </div>
          <div className="flex gap-2">
            <Image
              src="/assets/icons/calendar.svg"
              height={24}
              width={24}
              alt=""
              aria-hidden="true"
            />
            <p> {formatDateTime(appointment.schedule).dateTime}</p>
          </div>
        </section>

        <Button variant="outline" className="shad-primary-btn" asChild>
          <Link href={`/patients/${userId}/new-appointment`}>
            New Appointment
          </Link>
        </Button>

        <p className="copyright">© 2024 PKPCare</p>
      </div>
    </div>
  );
};

export default RequestSuccess;
