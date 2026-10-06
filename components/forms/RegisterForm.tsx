"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormError } from "@/components/FormError";
import { ConsentStep } from "@/components/portal/register/ConsentStep";
import { InsuranceStep } from "@/components/portal/register/InsuranceStep";
import { MedicalStep } from "@/components/portal/register/MedicalStep";
import { PersonalStep } from "@/components/portal/register/PersonalStep";
import { ReviewStep } from "@/components/portal/register/ReviewStep";
import { WizardProgress } from "@/components/portal/register/WizardProgress";
import { Form } from "@/components/ui/form";
import { Doctors, PatientFormDefaultValues } from "@/constants";
import { registerPatient } from "@/lib/actions/patient.actions";
import { PatientFormValidation } from "@/lib/validation";

import "react-datepicker/dist/react-datepicker.css";
import "react-phone-number-input/style.css";
import { validateIdentificationFile } from "../FileUploader";
import {
  clearDraft,
  getSessionStore,
  loadDraft,
  saveDraft,
} from "../portal/draft";
import { BTN_PRIMARY, BTN_SECONDARY } from "../portal/styles";
import {
  FIELD_LABELS,
  REVIEW_STEP_INDEX,
  validateStep,
  WIZARD_STEPS,
} from "../portal/wizard";
import SubmitButton from "../SubmitButton";
import { Button } from "../ui/button";

type Values = z.infer<typeof PatientFormValidation>;
type DoctorOption = { name: string; image: string; specialty?: string };

const RegisterForm = ({
  user,
  doctors,
}: {
  user: User;
  /** From listDoctors(); the static list is the fallback. */
  doctors?: DoctorOption[];
}) => {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [restored, setRestored] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const form = useForm<Values>({
    resolver: zodResolver(PatientFormValidation),
    defaultValues: {
      ...PatientFormDefaultValues,
      name: user.name,
      email: user.email,
      phone: user.phone,
    },
  });

  // Restore a saved draft (non-sensitive fields only, see portal/draft.ts).
  useEffect(() => {
    const draft = loadDraft(getSessionStore(), user.$id);
    if (!draft) return;
    form.reset({ ...form.getValues(), ...draft.values } as Values);
    setStep(Math.min(draft.step, WIZARD_STEPS.length - 2));
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave (debounced) + clear a field's error as soon as it is edited.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = form.watch((values, { name }) => {
      if (name) {
        form.clearErrors(name);
        setStepErrors((current) => {
          if (!(name in current)) return current;
          const { [name]: _removed, ...rest } = current;
          return rest;
        });
      }
      clearTimeout(timer);
      timer = setTimeout(
        () => saveDraft(getSessionStore(), user.$id, values, stepRef.current),
        400
      );
    });
    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [form, user.$id]);

  // Move focus to the step heading whenever the step changes (not on first paint).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const showErrors = (errors: Record<string, string>) => {
    Object.entries(errors).forEach(([field, message]) =>
      form.setError(field as keyof Values, { type: "manual", message })
    );
    setStepErrors(errors);
    setTimeout(() => summaryRef.current?.focus(), 0);
  };

  const goNext = () => {
    const current = WIZARD_STEPS[step];
    const result = validateStep(current.id, form.getValues());
    if (!result.ok) {
      showErrors(result.errors);
      return;
    }
    setStepErrors({});
    setError(null);
    setStep((s) => Math.min(s + 1, REVIEW_STEP_INDEX));
  };

  const goBack = () => {
    setStepErrors({});
    setStep((s) => Math.max(s - 1, 0));
  };

  const startOver = () => {
    clearDraft(getSessionStore(), user.$id);
    form.reset({
      ...PatientFormDefaultValues,
      name: user.name,
      email: user.email,
      phone: user.phone,
    } as Values);
    setStep(0);
    setRestored(false);
  };

  const submit = async (values: Values) => {
    setError(null);

    const all = validateStep("review", values);
    if (!all.ok) {
      const index = WIZARD_STEPS.findIndex(
        (s) => s.id !== "review" && s.fields.some((f) => f in all.errors)
      );
      setStep(Math.max(index, 0));
      showErrors(all.errors);
      return;
    }

    // Transport shape unchanged: FormData with `blobFile` + `fileName`.
    let formData: FormData | undefined;
    const file = values.identificationDocument?.[0];
    if (file) {
      const fileError = validateIdentificationFile(file);
      if (fileError) {
        setError(fileError);
        return;
      }
      formData = new FormData();
      formData.append("blobFile", new Blob([file], { type: file.type }));
      formData.append("fileName", file.name);
    }

    setIsLoading(true);
    try {
      const result = await registerPatient({
        userId: user.$id,
        name: values.name,
        email: values.email,
        phone: values.phone,
        birthDate: new Date(values.birthDate),
        gender: values.gender,
        address: values.address,
        occupation: values.occupation,
        emergencyContactName: values.emergencyContactName,
        emergencyContactNumber: values.emergencyContactNumber,
        primaryPhysician: values.primaryPhysician,
        insuranceProvider: values.insuranceProvider,
        insurancePolicyNumber: values.insurancePolicyNumber,
        allergies: values.allergies,
        currentMedication: values.currentMedication,
        familyMedicalHistory: values.familyMedicalHistory,
        pastMedicalHistory: values.pastMedicalHistory,
        identificationType: values.identificationType,
        identificationNumber: values.identificationNumber,
        identificationDocument: formData,
        privacyConsent: values.privacyConsent,
        treatmentConsent: values.treatmentConsent,
        disclosureConsent: values.disclosureConsent,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      clearDraft(getSessionStore(), user.$id);
      router.push(`/patients/${user.$id}/new-appointment`);
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const current = WIZARD_STEPS[step];
  const isReview = step === REVIEW_STEP_INDEX;
  const errorEntries = Object.entries(stepErrors);
  const doctorOptions = doctors ?? Doctors;
  const document = form.watch("identificationDocument");
  const file = Array.isArray(document) && document[0] ? (document[0] as File) : null;

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (isReview) submit(form.getValues());
          else goNext();
        }}
        className="flex-1 space-y-8"
      >
        <section className="space-y-3">
          <h1 className="header">Welcome 👋</h1>
          <p className="text-dark-700">Let us know more about yourself.</p>
        </section>

        <WizardProgress current={step} />

        {restored && (
          <div
            role="status"
            className="text-14-regular flex flex-wrap items-center justify-between gap-3 rounded-md border border-dark-500 bg-dark-400 p-3 text-dark-700"
          >
            <span>
              We restored your earlier answers for this visit. Health details, ID numbers and
              consents are never saved, so please fill those in again.
            </span>
            <Button type="button" className={BTN_SECONDARY} onClick={startOver}>
              Start over
            </Button>
          </div>
        )}

        <section aria-labelledby="step-heading" className="space-y-6">
          <div className="space-y-1">
            <h2
              id="step-heading"
              ref={headingRef}
              tabIndex={-1}
              className="sub-header focus-visible:outline-none"
            >
              {current.title}
            </h2>
            <p className="text-14-regular text-dark-700">{current.description}</p>
          </div>

          <div
            ref={summaryRef}
            tabIndex={-1}
            role={errorEntries.length ? "alert" : undefined}
            className="focus-visible:outline-none"
          >
            {errorEntries.length > 0 && (
              <div className="rounded-md border border-red-500 bg-red-600 p-4">
                <p className="text-14-medium text-white">
                  Please fix {errorEntries.length === 1 ? "1 problem" : `${errorEntries.length} problems`}{" "}
                  before continuing:
                </p>
                <ul className="text-14-regular mt-2 list-disc pl-5 text-white">
                  {errorEntries.map(([field, message]) => (
                    <li key={field}>
                      {FIELD_LABELS[field] ?? field}: {message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {current.id === "personal" && <PersonalStep control={form.control} />}
          {current.id === "medical" && (
            <MedicalStep control={form.control} doctors={doctorOptions} />
          )}
          {current.id === "insurance" && (
            <InsuranceStep
              control={form.control}
              file={file}
              onApplyPrefill={(fields) => {
                Object.entries(fields).forEach(([key, value]) =>
                  form.setValue(key as keyof Values, value as never, { shouldDirty: true })
                );
              }}
            />
          )}
          {current.id === "consent" && <ConsentStep control={form.control} />}
          {current.id === "review" && (
            <ReviewStep
              values={form.getValues() as Record<string, unknown>}
              onEdit={(index) => {
                setStepErrors({});
                setStep(index);
              }}
            />
          )}
        </section>

        <div aria-live="polite">
          <FormError message={error} />
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          {step > 0 ? (
            <Button type="button" className={BTN_SECONDARY} onClick={goBack} disabled={isLoading}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {isReview ? (
            <SubmitButton
              isLoading={isLoading}
              loadingText="Submitting..."
              className={`${BTN_PRIMARY} sm:min-w-56`}
            >
              Submit and continue
            </SubmitButton>
          ) : (
            <Button type="submit" className={`${BTN_PRIMARY} sm:min-w-56`}>
              Next: {WIZARD_STEPS[step + 1].title}
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
};

export default RegisterForm;
