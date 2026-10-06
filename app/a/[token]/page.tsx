import type { Metadata } from "next";
import Link from "next/link";

import { CancelForm } from "@/components/notify/CancelForm";
import { ConfirmButton } from "@/components/notify/ConfirmButton";
import { Button } from "@/components/ui/button";
import { formatWhen } from "@/lib/notifications/format";
import { resolveLink } from "@/lib/notifications/link-service";
import { portalBookPath, portalReschedulePath } from "@/lib/notifications/links";

// The token is a bearer credential: never cache, index or leak via referrer.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your appointment | PKPCare",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const Shell = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto flex min-h-screen max-w-[480px] flex-col justify-center gap-6 px-5 py-10">
    {children}
  </main>
);

const Notice = ({ title, message }: { title: string; message: string }) => (
  <Shell>
    <h1 className="header">{title}</h1>
    <p role="status" className="text-dark-700">
      {message}
    </p>
    <Button variant="outline" className="shad-primary-btn min-h-12" asChild>
      <Link href="/">Back to home</Link>
    </Button>
  </Shell>
);

const Page = async ({ params }: { params: { token: string } }) => {
  const view = await resolveLink(params.token);

  if (view.kind === "invalid") {
    return (
      <Notice
        title={view.reason === "expired" ? "This link has expired" : "Link unavailable"}
        message={
          view.reason === "expired"
            ? "Please sign in to manage your appointment."
            : "This link is invalid or no longer applies."
        }
      />
    );
  }

  if (view.kind === "waitlist") {
    const { offer } = view;
    return (
      <Shell>
        <h1 className="header">A slot opened up</h1>
        <dl className="flex flex-col gap-1">
          <dt className="sr-only">Doctor</dt>
          <dd className="text-18-bold">Dr. {offer.doctorName.replace(/^dr\.?\s+/i, "")}</dd>
          <dt className="sr-only">Time</dt>
          <dd>{formatWhen(offer.start, offer.timezone)}</dd>
        </dl>
        <p className="text-14-regular text-dark-600">
          It is held for you for a short time; after that it is offered to the
          next person.
        </p>
        <Button className="shad-primary-btn min-h-12" asChild>
          <Link href={portalBookPath(offer.userId, offer.doctorId, offer.start)}>
            Book this slot
          </Link>
        </Button>
      </Shell>
    );
  }

  const { appointment, can } = view;
  const cancelled = appointment.status === "cancelled";
  const past = !can.cancel && !can.reschedule && !cancelled;

  return (
    <Shell>
      <h1 className="header">Your appointment</h1>
      <section aria-label="Appointment summary">
        <dl className="flex flex-col gap-1">
          <dt className="sr-only">Doctor</dt>
          <dd className="text-18-bold">
            Dr. {appointment.doctorName.replace(/^dr\.?\s+/i, "")}
          </dd>
          <dt className="sr-only">Time</dt>
          <dd>{formatWhen(appointment.start, appointment.timezone)}</dd>
          <dt className="sr-only">Status</dt>
          <dd className="text-14-regular text-dark-600">
            {cancelled
              ? "Cancelled"
              : appointment.confirmed
                ? "Attendance confirmed"
                : appointment.status === "pending"
                  ? "Awaiting confirmation by the clinic"
                  : "Scheduled"}
            {appointment.visitType === "video" ? " - video visit" : ""}
          </dd>
        </dl>
      </section>

      {cancelled && <p role="status">This appointment has been cancelled.</p>}
      {past && <p role="status">This appointment has already started.</p>}

      {can.confirm && <ConfirmButton token={params.token} />}
      {appointment.confirmed && !cancelled && (
        <p role="status" className="text-green-500">
          Your attendance is confirmed.
        </p>
      )}

      {can.reschedule && (
        <Button variant="outline" className="shad-gray-btn min-h-12" asChild>
          <Link href={portalReschedulePath(appointment.userId, appointment.id)}>
            Reschedule
          </Link>
        </Button>
      )}
      {can.cancel && <CancelForm token={params.token} />}
    </Shell>
  );
};

export default Page;
