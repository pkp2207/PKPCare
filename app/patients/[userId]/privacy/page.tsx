import type { Metadata } from "next";
import Link from "next/link";

import { ErrorState } from "@/components/ErrorState";
import { PortalHeader } from "@/components/portal/PortalHeader";
import {
  ConsentList,
  DeleteAccountRequest,
  DownloadDataButton,
} from "@/components/portal/PrivacyActions";
import { getMyConsents } from "@/lib/actions/compliance.actions";
import { isPatientAuthEnforced } from "@/lib/auth/patient";
import { CURRENT_POLICY_VERSION } from "@/lib/compliance/consent";

export const metadata: Metadata = { title: "Privacy and data | PKPCare" };
export const dynamic = "force-dynamic";

const Privacy = async ({ params: { userId } }: SearchParamProps) => {
  const consents = await getMyConsents(userId);

  if (!consents.ok) {
    return (
      <ErrorState
        title="Couldn't load your privacy settings"
        message={consents.error}
        href={`/patients/${userId}/privacy`}
        linkLabel="Try again"
      />
    );
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-[5%] py-6 sm:px-6">
      <PortalHeader userId={userId} enforced={isPatientAuthEnforced()} current="privacy" />

      <main id="main" className="space-y-12 py-8">
        <div className="space-y-2">
          <h1 className="header">Privacy and data</h1>
          <p className="text-dark-700">
            You are in control of your information. Current policy version:{" "}
            {CURRENT_POLICY_VERSION}.{" "}
            <Link href="/privacy" className="text-green-500 underline underline-offset-2">
              Read the privacy notice
            </Link>
          </p>
        </div>

        <section aria-labelledby="consents-heading" className="space-y-4">
          <h2 id="consents-heading" className="sub-header">
            Your consents
          </h2>
          <ConsentList userId={userId} consents={consents.data} />
        </section>

        <section aria-labelledby="export-heading" className="space-y-4">
          <h2 id="export-heading" className="sub-header">
            Download my data
          </h2>
          <p className="text-14-regular text-dark-700">
            Get a copy of your profile, appointments and consent history as a JSON file.
          </p>
          <DownloadDataButton userId={userId} />
        </section>

        <section aria-labelledby="delete-heading" className="space-y-4">
          <h2 id="delete-heading" className="sub-header">
            Delete my account
          </h2>
          <p className="text-14-regular text-dark-700">
            You can ask the clinic to erase your account and personal data. A member of staff reviews
            every request.
          </p>
          <DeleteAccountRequest userId={userId} />
        </section>
      </main>
    </div>
  );
};

export default Privacy;
