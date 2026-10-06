import { StaffManager } from "@/components/admin/StaffManager";
import { ErrorState } from "@/components/ErrorState";
import { listStaff } from "@/lib/actions/admin.actions";
import { requireStaffPage } from "@/lib/auth/guards";

export const metadata = { title: "Staff | PKPCare admin" };

export default async function StaffPage() {
  const session = await requireStaffPage("admin");
  const result = await listStaff();

  if (!result.ok) {
    return (
      <ErrorState
        title="Couldn't load staff"
        message={result.error}
        href="/admin/staff"
        linkLabel="Try again"
      />
    );
  }

  return (
    <>
      <section className="space-y-2">
        <h1 className="header">Staff</h1>
        <p className="text-dark-700">
          Accounts that can sign in to this console. Patients are not listed here.
        </p>
      </section>
      <StaffManager staff={result.data} currentUserId={session.userId} />
    </>
  );
}
