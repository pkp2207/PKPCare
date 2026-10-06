import Image from "next/image";
import { notFound, redirect } from "next/navigation";

import { ErrorState } from "@/components/ErrorState";
import RegisterForm from "@/components/forms/RegisterForm";
import { getPatient, getUser } from "@/lib/actions/patient.actions";

const Register = async ({ params: { userId } }: SearchParamProps) => {
  const [userResult, patientResult] = await Promise.all([
    getUser(userId),
    getPatient(userId),
  ]);

  if (!userResult.ok) notFound();

  if (!patientResult.ok) {
    return (
      <ErrorState
        title="Couldn't load your profile"
        message={patientResult.error}
        href={`/patients/${userId}/register`}
        linkLabel="Try again"
      />
    );
  }

  // Already registered: skip straight to booking.
  if (patientResult.data) redirect(`/patients/${userId}/new-appointment`);

  const user = userResult.data;

  return (
    <div className="flex h-screen max-h-screen">
      <section className="remove-scrollbar container">
        <div className="sub-container max-w-[860px] flex-1 flex-col py-10">
          <Image
            src="/assets/icons/logo-full-pkp.png"
            height={200}
            width={200}
            alt="PKPCare"
            className="mb-12 w-fit"
          />

          <RegisterForm user={user} />

          <p className="copyright py-12">© 2024 PKPCare</p>
        </div>
      </section>

      <Image
        src="/assets/images/register-img.png"
        height={1000}
        width={1000}
        alt="Patient registration illustration"
        className="side-img max-w-[390px]"
      />
    </div>
  );
};

export default Register;
