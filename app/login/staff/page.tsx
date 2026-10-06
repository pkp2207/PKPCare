import type { Metadata } from "next";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { StaffLoginForm } from "@/components/auth/StaffLoginForm";
import { isLegacyPasskeyAllowed } from "@/lib/auth/config";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Staff sign in | PKPCare" };

// Reads env per request (legacy passkey flag).
export const dynamic = "force-dynamic";

const StaffLoginPage = ({ searchParams }: SearchParamProps) => {
  const next = safeNextPath(searchParams?.next, "");

  return (
    <AuthLayout footerLink={{ href: "/login", label: "Patient sign in" }}>
      <StaffLoginForm
        next={next || undefined}
        forbidden={searchParams?.reason === "forbidden"}
        showLegacyLink={isLegacyPasskeyAllowed()}
      />
    </AuthLayout>
  );
};

export default StaffLoginPage;
