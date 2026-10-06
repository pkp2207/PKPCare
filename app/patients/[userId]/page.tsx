import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ErrorState } from "@/components/ErrorState";
import { AppointmentList } from "@/components/portal/AppointmentList";
import { splitAppointments } from "@/components/portal/appointments";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/portal/styles";
import { WaitlistList } from "@/components/portal/WaitlistList";
import { Button } from "@/components/ui/button";
import { listMyAppointments } from "@/lib/actions/appointment.actions";
import { listDoctors } from "@/lib/actions/doctor.actions";
import { getPatient } from "@/lib/actions/patient.actions";
import { listMyWaitlist } from "@/lib/actions/waitlist.actions";
import { isPatientAuthEnforced } from "@/lib/auth/patient";

export const metadata: Metadata = { title: "My appointments | PKPCare" };
// Reads the PATIENT_AUTH_ENFORCED flag and per-user data on every request.
export const dynamic = "force-dynamic";

const Dashboard = async ({ params: { userId } }: SearchParamProps) => {
  const enforced = isPatientAuthEnforced();
  const patientResult = await getPatient(userId);

  if (!patientResult.ok) {
    return (
      <ErrorState
        title="Couldn't load your profile"
        message={patientResult.error}
        href={enforced ? "/login" : `/patients/${userId}`}
        linkLabel={enforced ? "Sign in" : "Try again"}
      />
    );
  }
  // Not registered yet: finish registration first.
  if (!patientResult.data) redirect(`/patients/${userId}/register`);
  const patient = patientResult.data;

  const [appointmentsResult, waitlistResult, doctorsResult] = await Promise.all([
    listMyAppointments(userId),
    listMyWaitlist(userId),
    listDoctors(),
  ]);

  const doctors = doctorsResult.ok ? doctorsResult.data : [];
  const { upcoming, past } = splitAppointments(
    appointmentsResult.ok ? appointmentsResult.data : []
  );
  const base = `/patients/${encodeURIComponent(userId)}`;

  return (
    <div className="mx-auto min-h-screen w-full max-w-4xl px-[5%] py-6 sm:px-6">
      <PortalHeader userId={userId} enforced={enforced} current="dashboard" />

      <main id="main" className="space-y-10 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <h1 className="header">Hi, {patient.name.split(" ")[0]}</h1>
            <p className="text-dark-700">Manage your appointments in one place.</p>
          </div>
          <Button asChild className={BTN_PRIMARY}>
            <Link href={`${base}/new-appointment`}>New appointment</Link>
          </Button>
        </div>

        {!appointmentsResult.ok && (
          <p role="alert" className="shad-error text-14-regular">
            We couldn&apos;t load your appointments: {appointmentsResult.error}
          </p>
        )}

        <AppointmentList userId={userId} upcoming={upcoming} past={past} doctors={doctors} />

        {waitlistResult.ok && (
          <WaitlistList userId={userId} entries={waitlistResult.data} doctors={doctors} />
        )}

        <section aria-labelledby="privacy-heading" className="space-y-3 border-t border-dark-500 pt-8">
          <h2 id="privacy-heading" className="sub-header">
            Your privacy
          </h2>
          <p className="text-14-regular text-dark-700">
            See which consents you have given, download a copy of your data, or ask us to delete
            your account.
          </p>
          <Button asChild className={BTN_SECONDARY}>
            <Link href={`${base}/privacy`}>Privacy and data</Link>
          </Button>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
