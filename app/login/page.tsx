import type { Metadata } from "next";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { PatientLoginForm } from "@/components/auth/PatientLoginForm";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Sign in | PKPCare" };

// Redirect target is validated below (safeNextPath), never trusted raw.
const LoginPage = ({ searchParams }: SearchParamProps) => {
  // Open-redirect guard: only same-origin relative paths survive.
  const next = safeNextPath(searchParams?.next, "");

  return (
    <AuthLayout footerLink={{ href: "/login/staff", label: "Staff" }}>
      <PatientLoginForm next={next || undefined} />
    </AuthLayout>
  );
};

export default LoginPage;
