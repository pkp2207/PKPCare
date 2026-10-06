"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as Sentry from "@sentry/nextjs";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type FieldErrors, useForm } from "react-hook-form";

import { SymptomRouter } from "@/components/ai/SymptomRouter";
import CustomFormField, { FormFieldType } from "@/components/CustomFormField";
import { FormError } from "@/components/FormError";
import SubmitButton from "@/components/SubmitButton";
import { Form } from "@/components/ui/form";
import { SelectItem } from "@/components/ui/select";
import { createAppointment } from "@/lib/actions/appointment.actions";
import { listDoctors } from "@/lib/actions/doctor.actions";
import { getDepositCheckout, getPaymentConfig } from "@/lib/actions/payment.actions";

import "react-datepicker/dist/react-datepicker.css";

import {
  BookingFormSchema,
  type BookingFormValues,
  defaultLegacySchedule,
  pickDefaultDoctorId,
} from "./booking";
import { JoinWaitlistButton } from "./JoinWaitlistButton";
import { formatMinorAmount, resolvePostBooking } from "./payment";
import { RadioGrid } from "./RadioGrid";
import { SlotPicker } from "./SlotPicker";
import { isSlotTakenError } from "./slots";
import { BTN_PRIMARY } from "./styles";

type Deposit = { amountMinor: number; currency: string } | null;

const VISIT_OPTIONS = [
  { value: "in_person", label: "In person" },
  { value: "video", label: "Video visit" },
];

/**
 * Patient booking (AppointmentForm type="create" renders this). Doctors with a
 * schedule get the day/time slot picker and atomic booking; doctors served from
 * the static fallback list (`legacy`) keep the free date-time picker.
 */
export const BookingForm = ({
  userId,
  patientId,
  doctors: initialDoctors,
  defaultDoctorName,
  initialDoctorId,
}: {
  userId: string;
  patientId: string;
  /** Pre-loaded by the page; fetched here when omitted. */
  doctors?: PublicDoctor[];
  /** Patient's primary physician (name) to pre-select. */
  defaultDoctorName?: string | null;
  initialDoctorId?: string | null;
}) => {
  const router = useRouter();
  const [doctors, setDoctors] = useState<PublicDoctor[] | null>(initialDoctors ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deposit, setDeposit] = useState<Deposit>(null);
  const [minDate] = useState(() => new Date());
  const slotSectionRef = useRef<HTMLDivElement>(null);

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(BookingFormSchema),
    defaultValues: {
      doctorId: initialDoctors
        ? pickDefaultDoctorId(initialDoctors, {
            initialDoctorId,
            primaryPhysicianName: defaultDoctorName,
          })
        : "",
      legacy: false,
      visitType: "in_person",
      slotStart: undefined,
      legacySchedule: defaultLegacySchedule(),
      reason: "",
      note: "",
    },
  });

  // Doctors: use what the page passed, otherwise load them.
  useEffect(() => {
    if (initialDoctors) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await listDoctors();
        if (cancelled) return;
        if (!result.ok) {
          setLoadError(result.error);
          return;
        }
        setDoctors(result.data);
        const id = pickDefaultDoctorId(result.data, {
          initialDoctorId,
          primaryPhysicianName: defaultDoctorName,
        });
        if (id) form.setValue("doctorId", id);
      } catch (err) {
        Sentry.captureException(err);
        if (!cancelled) setLoadError("We couldn't load the list of doctors.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deposit notice (N1). Failure or "not required" simply shows nothing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getPaymentConfig();
        if (!cancelled && result.ok && result.data.depositRequired) {
          setDeposit({ amountMinor: result.data.amountMinor, currency: result.data.currency });
        }
      } catch {
        // Payments unavailable: treated as no deposit.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const doctorId = form.watch("doctorId");
  const visitType = form.watch("visitType");
  const slotStart = form.watch("slotStart");
  const reason = form.watch("reason");
  const doctor = doctors?.find((d) => d.id === doctorId) ?? null;

  // Changing doctor invalidates the chosen time and switches booking mode.
  const previousDoctor = useRef(doctorId);
  useEffect(() => {
    if (previousDoctor.current !== doctorId) {
      previousDoctor.current = doctorId;
      form.setValue("slotStart", undefined);
      setNotice(null);
      setError(null);
    }
    form.setValue("legacy", !!doctor?.legacy);
  }, [doctorId, doctor?.legacy, form]);

  const onInvalid = (errors: FieldErrors<BookingFormValues>) => {
    if (errors.slotStart) slotSectionRef.current?.focus();
  };

  const onSubmit = async (values: BookingFormValues) => {
    setError(null);
    setNotice(null);
    if (!patientId) {
      setError("We couldn't find your patient record. Please register first.");
      return;
    }
    if (!doctor) {
      setError("Choose a doctor.");
      return;
    }

    setIsLoading(true);
    try {
      const base = {
        userId,
        patient: patientId,
        reason: values.reason.trim(),
        note: values.note?.trim() || undefined,
        visitType: values.visitType,
      };
      const result = await createAppointment(
        doctor.legacy
          ? {
              ...base,
              primaryPhysician: doctor.name,
              schedule: new Date(values.legacySchedule as Date),
            }
          : { ...base, doctorId: doctor.id, slotStart: values.slotStart }
      );

      if (!result.ok) {
        if (!doctor.legacy && isSlotTakenError(result.error)) {
          form.setValue("slotStart", undefined);
          setRefreshKey((key) => key + 1);
          setNotice(
            "That time was just taken by someone else. We have refreshed the list - please choose another time."
          );
          slotSectionRef.current?.focus();
        } else {
          setError(result.error);
        }
        return;
      }

      // Deposit (N1): any failure here means "no deposit", never a failed booking.
      let checkout = null;
      try {
        checkout = await getDepositCheckout(result.data.$id, userId);
      } catch (err) {
        Sentry.captureException(err);
      }
      const destination = resolvePostBooking(userId, result.data.$id, checkout);

      setRedirecting(true);
      if (destination.kind === "checkout") {
        window.location.assign(destination.url);
      } else {
        router.push(destination.href);
      }
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (loadError) {
    return (
      <div role="alert" className="space-y-3">
        <h1 className="header">New Appointment</h1>
        <FormError message={loadError} />
      </div>
    );
  }

  const slotError = form.formState.errors.slotStart?.message;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, onInvalid)}
        className="flex-1 space-y-8"
        noValidate
      >
        <section className="space-y-2">
          <h1 className="header">New Appointment</h1>
          <p className="text-dark-700">Choose a doctor and a time that suits you.</p>
        </section>

        {!doctors ? (
          <p role="status" className="text-14-regular text-dark-700">
            Loading doctors...
          </p>
        ) : (
          <>
            <CustomFormField
              fieldType={FormFieldType.SELECT}
              control={form.control}
              name="doctorId"
              label="Doctor"
              placeholder="Select a doctor"
            >
              {doctors.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  <div className="flex cursor-pointer items-center gap-2">
                    <Image
                      src={d.image}
                      width={32}
                      height={32}
                      alt=""
                      className="rounded-full border border-dark-500"
                    />
                    <span>
                      {d.name}
                      <span className="text-dark-700"> - {d.specialty}</span>
                    </span>
                  </div>
                </SelectItem>
              ))}
            </CustomFormField>

            <div className="space-y-2">
              <p className="shad-input-label">Type of visit</p>
              <RadioGrid
                label="Type of visit"
                className="flex flex-wrap gap-2"
                options={VISIT_OPTIONS}
                value={visitType}
                onChange={(value) => form.setValue("visitType", value as "in_person" | "video")}
                disabled={isLoading}
              />
            </div>

            {doctor && (
              <div
                ref={slotSectionRef}
                tabIndex={-1}
                aria-labelledby="slot-heading"
                className="space-y-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                <h2 id="slot-heading" className="sub-header">
                  {doctor.legacy ? "Preferred date and time" : "Pick a time"}
                </h2>

                <div role="status" aria-live="polite">
                  {notice && <p className="text-14-regular text-blue-500">{notice}</p>}
                </div>

                {doctor.legacy ? (
                  <>
                    <CustomFormField
                      fieldType={FormFieldType.DATE_PICKER}
                      control={form.control}
                      name="legacySchedule"
                      label="Expected appointment date"
                      description="The clinic will confirm this time. Shown in your local time."
                      showTimeSelect
                      minDate={minDate}
                      dateFormat="MM/dd/yyyy  -  h:mm aa"
                    />
                  </>
                ) : (
                  <>
                    <SlotPicker
                      doctor={doctor}
                      value={slotStart ?? null}
                      onChange={(start) =>
                        form.setValue("slotStart", start ?? undefined, {
                          shouldValidate: form.formState.isSubmitted,
                        })
                      }
                      refreshKey={refreshKey}
                      disabled={isLoading}
                      emptyAction={
                        <JoinWaitlistButton userId={userId} patientId={patientId} doctor={doctor} />
                      }
                    />
                    {slotError && (
                      <p role="alert" className="shad-error text-14-regular">
                        {slotError}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="space-y-4">
              <CustomFormField
                fieldType={FormFieldType.TEXTAREA}
                control={form.control}
                name="reason"
                label="Reason for visit"
                placeholder="Annual check-up"
              />
              <SymptomRouter
                reason={reason ?? ""}
                onSelectDoctor={(id) => {
                  if (doctors.some((d) => d.id === id)) {
                    form.setValue("doctorId", id, { shouldValidate: true });
                  }
                }}
              />
              <CustomFormField
                fieldType={FormFieldType.TEXTAREA}
                control={form.control}
                name="note"
                label="Comments or notes (optional)"
                placeholder="Prefer afternoon appointments, if possible"
              />
            </div>
          </>
        )}

        {deposit && (
          <p className="text-14-regular rounded-md border border-dark-500 bg-dark-400 p-4 text-dark-700">
            A deposit of {formatMinorAmount(deposit.amountMinor, deposit.currency)} is needed to
            confirm your appointment. After you submit, you will be taken to a secure payment page.
          </p>
        )}

        <div aria-live="polite">
          <FormError message={error} />
        </div>

        <SubmitButton
          isLoading={isLoading || redirecting}
          loadingText={redirecting ? "Redirecting..." : "Booking..."}
          className={`${BTN_PRIMARY} w-full`}
        >
          Request appointment
        </SubmitButton>
      </form>
    </Form>
  );
};
