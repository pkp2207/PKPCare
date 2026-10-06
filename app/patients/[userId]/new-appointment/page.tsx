import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ErrorState } from "@/components/ErrorState";
import { BookingForm } from "@/components/portal/BookingForm";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { listDoctors } from "@/lib/actions/doctor.actions";
import { getPatient } from "@/lib/actions/patient.actions";
import { isPatientAuthEnforced } from "@/lib/auth/patient";

export const metadata: Metadata = { title: "New appointment | PKPCare" };
export const dynamic = "force-dynamic";

const Appointment = async ({
  params: { userId },
  searchParams,
}: SearchParamProps) => {
  const enforced = isPatientAuthEnforced();
  const [result, doctorsResult] = await Promise.all([
    getPatient(userId),
    listDoctors(),
  ]);

  if (!result.ok) {
    return (
      <ErrorState
        title="Couldn't load your profile"
        message={result.error}
        href={`/patients/${userId}/new-appointment`}
        linkLabel="Try again"
      />
    );
  }

  // Not registered yet: finish registration first.
  if (!result.data) redirect(`/patients/${userId}/register`);

  const patient = result.data;
  const doctor = searchParams?.doctor;

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-[5%] py-6 sm:px-6">
      <PortalHeader userId={userId} enforced={enforced} current="new-appointment" />

      <main id="main" className="py-8">
        <BookingForm
          patientId={patient.$id}
          userId={userId}
          doctors={doctorsResult.ok ? doctorsResult.data : undefined}
          defaultDoctorName={patient.primaryPhysician}
          initialDoctorId={typeof doctor === "string" ? doctor : null}
        />
      </main>
    </div>
  );
};

export default Appointment;
