"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useRef, useState } from "react";

import { OtpCodeField } from "@/components/auth/OtpCodeField";
import { FormError } from "@/components/FormError";
import SubmitButton from "@/components/SubmitButton";
import { Button } from "@/components/ui/button";
import { verifyPatientOtp } from "@/lib/actions/auth.actions";

const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Code entry step shared by /login and enforced onboarding. `onResend` resends
 * the code and returns an error message (or null). A 30 second cooldown keeps
 * patients clear of the server's "3 codes per 15 minutes" limit.
 */
export const OtpVerifyStep = ({
  email,
  onVerified,
  onResend,
  onBack,
  initialNotice,
}: {
  email: string;
  onVerified: (userId: string) => void | Promise<void>;
  onResend: () => Promise<string | null>;
  onBack: () => void;
  initialNotice?: string;
}) => {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || code.length !== 6) return;
    setError(null);
    setIsLoading(true);
    try {
      const result = await verifyPatientOtp(email, code);
      if (!result.ok) {
        setError(result.error);
        setCode("");
        return;
      }
      await onVerified(result.data.userId);
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    setCode("");
    setIsLoading(true);
    try {
      const message = await onResend();
      if (message) setError(message);
      else {
        setNotice("We sent a new code. It may take a minute to arrive.");
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <section className="mb-12 space-y-4">
        <h1 ref={headingRef} tabIndex={-1} className="header focus-visible:outline-none">
          Check your email
        </h1>
        <p className="text-dark-700">
          If the details are right, we have sent a 6-digit code to {email}.
        </p>
      </section>

      <OtpCodeField
        id="patient-code"
        label="Verification code"
        value={code}
        onChange={setCode}
        disabled={isLoading}
      />

      <div aria-live="polite">
        {notice && !error && <p className="text-14-regular text-dark-700">{notice}</p>}
        <FormError message={error} />
      </div>

      <SubmitButton isLoading={isLoading}>Continue</SubmitButton>

      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="link"
          className="px-0 text-green-500"
          disabled={isLoading || cooldown > 0}
          onClick={resend}
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </Button>
        <Button
          type="button"
          variant="link"
          className="px-0 text-green-500"
          disabled={isLoading}
          onClick={onBack}
        >
          Use a different email
        </Button>
      </div>
    </form>
  );
};
