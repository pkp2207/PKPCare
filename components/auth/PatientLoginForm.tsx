"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { OtpVerifyStep } from "@/components/auth/OtpVerifyStep";
import { FormError } from "@/components/FormError";
import SubmitButton from "@/components/SubmitButton";
import { requestPatientOtp } from "@/lib/actions/auth.actions";
import { safeNextPath } from "@/lib/auth/redirect";

type Step = "email" | "code";

export const PatientLoginForm = ({ next }: { next?: string }) => {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Returns an error message, or null when the code was (apparently) sent.
  const sendCode = async (): Promise<string | null> => {
    const result = await requestPatientOtp(email);
    return result.ok ? null : result.error;
  };

  const onEmailSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading || !email.trim()) return;
    setError(null);
    setIsLoading(true);
    try {
      const message = await sendCode();
      if (message) setError(message);
      else setStep("code");
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (step === "code") {
    return (
      <OtpVerifyStep
        email={email}
        initialNotice="If an account exists for that email, we have sent a 6-digit code."
        onResend={sendCode}
        onBack={() => setStep("email")}
        onVerified={(userId) => {
          // Land on the dashboard unless a safe `next` was requested.
          router.replace(safeNextPath(next, `/patients/${encodeURIComponent(userId)}`));
          router.refresh();
        }}
      />
    );
  }

  return (
    <form onSubmit={onEmailSubmit} className="space-y-6" noValidate>
      <section className="mb-12 space-y-4">
        <h1 className="header">Welcome back 👋</h1>
        <p className="text-dark-700">Enter your email and we will send you a one-time code.</p>
      </section>

      <AuthField
        id="patient-email"
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="pkp@gmail.com"
        iconSrc="/assets/icons/email.svg"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isLoading}
        invalid={!!error}
        describedBy={error ? "login-error" : undefined}
        required
      />

      <div aria-live="polite">
        <FormError id="login-error" message={error} />
      </div>

      <SubmitButton isLoading={isLoading}>Send code</SubmitButton>

      <p className="text-14-regular text-dark-700">
        New here?{" "}
        <Link href="/" className="text-green-500 underline underline-offset-2">
          Create your patient profile
        </Link>
      </p>
    </form>
  );
};
