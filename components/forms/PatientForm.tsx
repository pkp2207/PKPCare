"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { OtpVerifyStep } from "@/components/auth/OtpVerifyStep";
import { Form } from "@/components/ui/form";
import { startPatientRegistration } from "@/lib/actions/onboarding.actions";
import { createUser, getPatient } from "@/lib/actions/patient.actions";
import { UserFormValidation } from "@/lib/validation";

import "react-phone-number-input/style.css";
import CustomFormField, { FormFieldType } from "../CustomFormField";
import { FormError } from "../FormError";
import SubmitButton from "../SubmitButton";

type Values = z.infer<typeof UserFormValidation>;

/**
 * `enforced` mirrors PATIENT_AUTH_ENFORCED (decided on the server by the page).
 *  - off: createUser -> /patients/[id]/register (today's anonymous flow).
 *  - on:  startPatientRegistration -> emailed code -> verifyPatientOtp -> register
 *         (or the dashboard if the patient is already registered). No user id is
 *         ever returned before the code is verified.
 */
export const PatientForm = ({ enforced = false }: { enforced?: boolean }) => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<Values | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(UserFormValidation),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
    },
  });

  const onSubmit = async (values: Values) => {
    setError(null);
    setIsLoading(true);

    try {
      if (enforced) {
        const result = await startPatientRegistration({
          name: values.name,
          email: values.email,
          phone: values.phone,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPending(values);
        return;
      }

      const result = await createUser({
        name: values.name,
        email: values.email,
        phone: values.phone,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.push(`/patients/${result.data.$id}/register`);
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const afterVerified = async (userId: string) => {
    // The session cookie is set now, so the ownership check passes.
    const patient = await getPatient(userId);
    const base = `/patients/${encodeURIComponent(userId)}`;
    router.push(patient.ok && patient.data ? base : `${base}/register`);
    router.refresh();
  };

  if (enforced && pending) {
    return (
      <OtpVerifyStep
        email={pending.email}
        onVerified={afterVerified}
        onBack={() => setPending(null)}
        onResend={async () => {
          const result = await startPatientRegistration(pending);
          return result.ok ? null : result.error;
        }}
      />
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 space-y-6">
        <section className="mb-12 space-y-4">
          <h1 className="header">Hi there 👋</h1>
          <p className="text-dark-700">
            {enforced
              ? "Enter your details and we will email you a one-time code to confirm it is you."
              : "Get started with appointments."}
          </p>
        </section>

        <CustomFormField
          fieldType={FormFieldType.INPUT}
          control={form.control}
          name="name"
          label="Full name"
          placeholder="Param Pathak"
          iconSrc="/assets/icons/user.svg"
          autoComplete="name"
        />

        <CustomFormField
          fieldType={FormFieldType.INPUT}
          control={form.control}
          name="email"
          label="Email"
          placeholder="pkp@gmail.com"
          iconSrc="/assets/icons/email.svg"
          inputType="email"
          autoComplete="email"
        />

        <CustomFormField
          fieldType={FormFieldType.PHONE_INPUT}
          control={form.control}
          name="phone"
          label="Phone number"
          placeholder="(555) 123-4567"
        />

        <FormError message={error} />

        <SubmitButton isLoading={isLoading}>
          {enforced ? "Send me a code" : "Get Started"}
        </SubmitButton>

        {enforced && (
          <p className="text-14-regular text-dark-700">
            Already registered?{" "}
            <Link href="/login" className="text-green-500 underline underline-offset-2">
              Sign in
            </Link>
          </p>
        )}
      </form>
    </Form>
  );
};
