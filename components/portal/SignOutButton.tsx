"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { logoutPatient } from "@/lib/actions/auth.actions";

import { clearAllDrafts, getSessionStore } from "./draft";
import { BTN_SECONDARY } from "./styles";

export const SignOutButton = ({ className }: { className?: string }) => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const signOut = async () => {
    setIsLoading(true);
    try {
      await logoutPatient();
      // A registration draft must not outlive the session on a shared device.
      clearAllDrafts(getSessionStore());
      router.replace("/login");
      router.refresh();
    } catch (err) {
      Sentry.captureException(err);
      setIsLoading(false);
    }
  };

  return (
    <Button
      type="button"
      className={className ?? BTN_SECONDARY}
      onClick={signOut}
      disabled={isLoading}
    >
      {isLoading ? "Signing out..." : "Sign out"}
    </Button>
  );
};
