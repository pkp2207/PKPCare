import { DoctorsManager } from "@/components/admin/DoctorsManager";
import { ErrorState } from "@/components/ErrorState";
import { listAllDoctors, listStaff } from "@/lib/actions/admin.actions";
import { requireStaffPage } from "@/lib/auth/guards";

export const metadata = { title: "Doctors | PKPCare admin" };

export default async function DoctorsPage() {
  await requireStaffPage("admin");

  const [doctors, staff] = await Promise.all([listAllDoctors(), listStaff()]);
  if (!doctors.ok) {
    return (
      <ErrorState
        title="Couldn't load doctors"
        message={doctors.error}
        href="/admin/doctors"
        linkLabel="Try again"
      />
    );
  }

  return (
    <>
      <section className="space-y-2">
        <h1 className="header">Doctors</h1>
        <p className="text-dark-700">
          Manage who can be booked, their weekly hours and time off.
        </p>
      </section>
      <DoctorsManager
        doctors={doctors.data}
        doctorStaff={staff.ok ? staff.data.filter((s) => s.role === "doctor") : []}
      />
    </>
  );
}
