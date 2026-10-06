import type { Metadata } from "next";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";

import { ErrorState } from "@/components/ErrorState";
import RegisterForm from "@/components/forms/RegisterForm";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { listDoctors } from "@/lib/actions/doctor.actions";
import { getPatient, getUser } from "@/lib/actions/patient.actions";
import { isPatientAuthEnforced } from "@/lib/auth/patient";

export const metadata: Metadata = { title: "Register | PKPCare" };
export const dynamic = "force-dynamic";

const Register = async ({ params: { userId } }: SearchParamProps) => {
  const [userResult, patientResult, doctorsResult] = await Promise.all([
    getUser(userId),
    getPatient(userId),
    listDoctors(),
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

  // Already registered: go to the dashboard instead of asking again.
  if (patientResult.data) redirect(`/patients/${userId}`);

  const user = userResult.data;

  return (
    <div className="flex min-h-screen">
      <div className="remove-scrollbar container">
        <div className="sub-container max-w-[860px] flex-1 flex-col py-10">
          <PortalHeader
            userId={userId}
            enforced={isPatientAuthEnforced()}
            minimal
          />

          <main id="main" className="py-8">
            <RegisterForm
              user={user}
              doctors={doctorsResult.ok ? doctorsResult.data : undefined}
            />
          </main>

          <p className="copyright py-12">© 2024 PKPCare</p>
        </div>
      </div>

      <Image
        src="/assets/images/register-img.png"
        height={1000}
        width={1000}
        alt=""
        aria-hidden="true"
        className="side-img max-w-[390px]"
      />
    </div>
  );
};

export default Register;
