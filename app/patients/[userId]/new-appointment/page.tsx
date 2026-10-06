import Image from "next/image";
import { redirect } from "next/navigation";

import { ErrorState } from "@/components/ErrorState";
import { AppointmentForm } from "@/components/forms/AppointmentForm";
import { getPatient } from "@/lib/actions/patient.actions";

const Appointment = async ({ params: { userId } }: SearchParamProps) => {
  const result = await getPatient(userId);

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

  return (
    <div className="flex h-screen max-h-screen">
      <section className="remove-scrollbar container my-auto">
        <div className="sub-container max-w-[860px] flex-1 justify-between">
          <Image
            src="/assets/icons/logo-full-pkp.png"
            height={200}
            width={200}
            alt="PKPCare"
            className="mb-12"
          />

          <AppointmentForm
            patientId={patient.$id}
            userId={userId}
            type="create"
          />

          <p className="copyright mt-10 py-12">© 2024 PKPCare</p>
        </div>
      </section>

      <Image
        src="/assets/images/appointment-img.png"
        height={1500}
        width={1500}
        alt="Doctor reviewing an appointment"
        className="side-img max-w-[390px] bg-bottom"
      />
    </div>
  );
};

export default Appointment;
