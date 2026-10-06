"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { OtpCodeField } from "@/components/auth/OtpCodeField";
import { FormError } from "@/components/FormError";
import SubmitButton from "@/components/SubmitButton";
import { verifyStaffLogin, verifyStaffMfa } from "@/lib/actions/auth.actions";
import { safeNextPath } from "@/lib/auth/redirect";

type Step = "password" | "mfa";

export const StaffLoginForm = ({
  next,
  forbidden,
  showLegacyLink,
}: {
  next?: string;
  forbidden?: boolean;
  showLegacyLink?: boolean;
}) => {
  const router = useRouter();
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(
    forbidden ? "Your account does not have access to that page." : null
  );
  const [isLoading, setIsLoading] = useState(false);

  const finish = () => {
    router.replace(safeNextPath(next, "/admin"));
    router.refresh();
  };

  const onPasswordSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading || !email.trim() || !password) return;

    setError(null);
    setIsLoading(true);
    try {
      const result = await verifyStaffLogin(email, password);
      if (!result.ok) {
        setError(result.error);
        setPassword("");
        return;
      }
      setPassword("");
      if (result.data.mfaRequired) {
        setStep("mfa");
      } else {
        finish();
      }
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const onMfaSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading || code.length !== 6) return;

    setError(null);
    setIsLoading(true);
    try {
      const result = await verifyStaffMfa(code);
      if (!result.ok) {
        setError(result.error);
        setCode("");
        return;
      }
      finish();
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (step === "mfa") {
    return (
      <form onSubmit={onMfaSubmit} className="space-y-6" noValidate>
        <section className="mb-12 space-y-4">
          <h1 className="header">Two-step verification</h1>
          <p className="text-dark-700">
            Enter the 6-digit code from your authenticator app.
          </p>
        </section>

        <OtpCodeField
          id="staff-mfa-code"
          label="Authenticator code"
          value={code}
          onChange={setCode}
          disabled={isLoading}
        />

        <div aria-live="polite">
          <FormError message={error} />
        </div>

        <SubmitButton isLoading={isLoading}>Verify</SubmitButton>
      </form>
    );
  }

  return (
    <form onSubmit={onPasswordSubmit} className="space-y-6" noValidate>
      <section className="mb-12 space-y-4">
        <h1 className="header">Staff sign in</h1>
        <p className="text-dark-700">Use your PKPCare staff account.</p>
      </section>

      <AuthField
        id="staff-email"
        label="Email"
        type="email"
        name="email"
        autoComplete="username"
        iconSrc="/assets/icons/email.svg"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isLoading}
        invalid={!!error}
        required
      />

      <AuthField
        id="staff-password"
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={isLoading}
        invalid={!!error}
        required
      />

      <div aria-live="polite">
        <FormError message={error} />
      </div>

      <SubmitButton isLoading={isLoading}>Sign in</SubmitButton>

      {showLegacyLink && (
        <p className="text-14-regular text-dark-600">
          <Link href="/?admin=true" className="text-green-500">
            Use the shared admin passkey instead
          </Link>
        </p>
      )}
    </form>
  );
};
