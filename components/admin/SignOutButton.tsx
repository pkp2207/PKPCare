"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { logoutStaff } from "@/lib/actions/auth.actions";

import { ui } from "./ui";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className={`${ui.btnSecondary} ${ui.btnSm}`}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await logoutStaff();
        } finally {
          router.push("/login/staff");
          router.refresh();
        }
      }}
    >
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
