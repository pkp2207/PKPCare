import Image from "next/image";
import Link from "next/link";

import { PatientForm } from "@/components/forms/PatientForm";
import { PasskeyModal } from "@/components/PasskeyModal";
import { isPatientAuthEnforced } from "@/lib/auth/patient";

// The PATIENT_AUTH_ENFORCED flag is read per request, not baked in at build time.
export const dynamic = "force-dynamic";

const Home = ({ searchParams }: SearchParamProps) => {
  const isAdmin = searchParams?.admin === "true";

  return (
    <div className="flex h-screen max-h-screen">
      {isAdmin && <PasskeyModal />}

      <main id="main" className="remove-scrollbar container my-auto">
        <div className="sub-container max-w-[496px]">
          <Image
            src="/assets/icons/logo-full-pkp.png"
            height={150}
            width={150}
            alt="PKPCare"
            className="mb-8"
          />

          <PatientForm enforced={isPatientAuthEnforced()} />

          <div className="text-14-regular mt-20 flex justify-between">
            <p className="justify-items-end text-dark-600 xl:text-left">
              © 2024 PKPCare
            </p>
            <div className="flex gap-4">
              <Link href="/privacy" className="text-green-500">
                Privacy
              </Link>
              <Link href="/?admin=true" className="text-green-500">
                Admin
              </Link>
            </div>
          </div>
        </div>
      </main>

      <Image
        src="/assets/images/onboarding-img.png"
        height={1000}
        width={1000}
        alt=""
        aria-hidden="true"
        className="side-img max-w-[50%]"
      />
    </div>
  );
};

export default Home;
