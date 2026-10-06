"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthField } from "@/components/auth/AuthField";
import { OtpCodeField } from "@/components/auth/OtpCodeField";
import { FormError } from "@/components/FormError";
import SubmitButton from "@/components/SubmitButton";
import { Button } from "@/components/ui/button";
import { requestPatientOtp, verifyPatientOtp } from "@/lib/actions/auth.actions";
import { safeNextPath } from "@/lib/auth/redirect";

type Step = "email" | "code";

export const PatientLoginForm = ({ next }: { next?: string }) => {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const sendCode = async (): Promise<boolean> => {
    setError(null);
    setNotice(null);
    setIsLoading(true);
    try {
      const result = await requestPatientOtp(email);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setNotice(
        "If an account exists for that email, we have sent a 6-digit code."
      );
      return true;
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const onEmailSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading || !email.trim()) return;
    if (await sendCode()) setStep("code");
  };

  const onCodeSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
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
      router.replace(
        safeNextPath(next, `/patients/${result.data.userId}/new-appointment`)
      );
      router.refresh();
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (step === "email") {
    return (
      <form onSubmit={onEmailSubmit} className="space-y-6" noValidate>
        <section className="mb-12 space-y-4">
          <h1 className="header">Welcome back 👋</h1>
          <p className="text-dark-700">
            Enter your email and we will send you a one-time code.
          </p>
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
          required
        />

        <div aria-live="polite">
          <FormError message={error} />
        </div>

        <SubmitButton isLoading={isLoading}>Send code</SubmitButton>
      </form>
    );
  }

  return (
    <form onSubmit={onCodeSubmit} className="space-y-6" noValidate>
      <section className="mb-12 space-y-4">
        <h1 className="header">Check your email</h1>
        <p className="text-dark-700">
          Enter the 6-digit code we sent to {email}.
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
        {notice && !error && (
          <p className="text-14-regular text-dark-700">{notice}</p>
        )}
        <FormError message={error} />
      </div>

      <SubmitButton isLoading={isLoading}>Sign in</SubmitButton>

      <div className="flex justify-between gap-4">
        <Button
          type="button"
          variant="link"
          className="px-0 text-green-500"
          disabled={isLoading}
          onClick={() => {
            setCode("");
            sendCode();
          }}
        >
          Resend code
        </Button>
        <Button
          type="button"
          variant="link"
          className="px-0 text-green-500"
          disabled={isLoading}
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
            setNotice(null);
          }}
        >
          Use a different email
        </Button>
      </div>
    </form>
  );
};
