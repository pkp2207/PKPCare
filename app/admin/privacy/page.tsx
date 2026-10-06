import { PrivacyRequests } from "@/components/admin/PrivacyRequests";
import { ErrorState } from "@/components/ErrorState";
import { listDeletionRequestsWithNames } from "@/lib/actions/admin.actions";
import { requireStaffPage } from "@/lib/auth/guards";

export const metadata = { title: "Privacy requests | PKPCare admin" };

export default async function PrivacyPage() {
  await requireStaffPage("admin");
  const result = await listDeletionRequestsWithNames();

  if (!result.ok) {
    return (
      <ErrorState
        title="Couldn't load privacy requests"
        message={result.error}
        href="/admin/privacy"
        linkLabel="Try again"
      />
    );
  }

  return (
    <>
      <section className="space-y-2">
        <h1 className="header">Privacy requests</h1>
        <p className="text-dark-700">
          Account deletion requests from patients. Approval permanently erases
          personal data; review legal retention needs before approving.
        </p>
      </section>
      <PrivacyRequests requests={result.data} />
    </>
  );
}
