"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as Sentry from "@sentry/nextjs";
import Image from "next/image";
import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { BookingForm } from "@/components/portal/BookingForm";
import { SelectItem } from "@/components/ui/select";
import { Doctors } from "@/constants";
import { updateAppointment } from "@/lib/actions/appointment.actions";
import { listDoctors } from "@/lib/actions/doctor.actions";
import { getAppointmentSchema } from "@/lib/validation";
import { Appointment } from "@/types/appwrite.types";

import "react-datepicker/dist/react-datepicker.css";

import CustomFormField, { FormFieldType } from "../CustomFormField";
import { FormError } from "../FormError";
import SubmitButton from "../SubmitButton";
import { Form } from "../ui/form";

/** Now rounded up to the next 30-minute mark (always strictly in the future). */
const getDefaultSchedule = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() + (30 - (date.getMinutes() % 30)), 0, 0);
  return date;
};

type AppointmentFormProps = {
  userId: string;
  patientId: string;
  type: "create" | "schedule" | "cancel";
  appointment?: Appointment;
  setOpen?: Dispatch<SetStateAction<boolean>>;
};

/**
 * Props are unchanged (the admin AppointmentModal depends on them). Patients
 * booking (`type="create"`) get the slot-based BookingForm; staff scheduling and
 * cancelling keep the original form below.
 */
export const AppointmentForm = (props: AppointmentFormProps) => {
  if (props.type === "create") {
    return <BookingForm userId={props.userId} patientId={props.patientId} />;
  }
  return <StaffAppointmentForm {...props} />;
};

const StaffAppointmentForm = ({
  userId,
  type,
  appointment,
  setOpen,
}: AppointmentFormProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fixed for the lifetime of the form so the picker's bounds don't drift.
  const [minDate] = useState(() => new Date());
  // Real doctors from the doctors collection; the static list is the fallback
  // (collection not set up yet, or the request failed).
  const [doctorOptions, setDoctorOptions] = useState<
    { name: string; image: string }[]
  >(Doctors);

  useEffect(() => {
    let cancelled = false;
    listDoctors()
      .then((result) => {
        if (!cancelled && result.ok && result.data.length > 0) {
          setDoctorOptions(
            result.data.map(({ name, image }) => ({ name, image }))
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const AppointmentFormValidation = getAppointmentSchema(type);

  const form = useForm<z.infer<typeof AppointmentFormValidation>>({
    resolver: zodResolver(AppointmentFormValidation),
    defaultValues: {
      primaryPhysician: appointment?.primaryPhysician ?? "",
      schedule: appointment
        ? new Date(appointment.schedule)
        : getDefaultSchedule(),
      reason: appointment?.reason ?? "",
      note: appointment?.note || "",
      cancellationReason: appointment?.cancellationReason || "",
    },
  });

  const onSubmit = async (
    values: z.infer<typeof AppointmentFormValidation>
  ) => {
    setError(null);
    setIsLoading(true);

    try {
      if (!appointment?.$id) {
        setError("We couldn't find this appointment. Please refresh the page.");
        return;
      }

      // The server derives the resulting status from `type`.
      const result = await updateAppointment({
        userId,
        appointmentId: appointment.$id,
        appointment: {
          primaryPhysician: values.primaryPhysician,
          schedule: new Date(values.schedule),
          cancellationReason: values.cancellationReason,
        },
        type,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setOpen?.(false);
      form.reset();
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  let buttonLabel;
  switch (type) {
    case "cancel":
      buttonLabel = "Cancel Appointment";
      break;
    case "schedule":
      buttonLabel = "Schedule Appointment";
      break;
    default:
      buttonLabel = "Schedule Appointment";
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 space-y-6">
        {type !== "cancel" && (
          <>
            <CustomFormField
              fieldType={FormFieldType.SELECT}
              control={form.control}
              name="primaryPhysician"
              label="Doctor"
              placeholder="Select a doctor"
            >
              {doctorOptions.map((doctor, i) => (
                <SelectItem key={doctor.name + i} value={doctor.name}>
                  <div className="flex cursor-pointer items-center gap-2">
                    <Image
                      src={doctor.image}
                      width={32}
                      height={32}
                      alt=""
                      className="rounded-full border border-dark-500"
                    />
                    <p>{doctor.name}</p>
                  </div>
                </SelectItem>
              ))}
            </CustomFormField>

            <CustomFormField
              fieldType={FormFieldType.DATE_PICKER}
              control={form.control}
              name="schedule"
              label="Expected appointment date"
              showTimeSelect
              minDate={minDate}
              dateFormat="MM/dd/yyyy  -  h:mm aa"
            />

            <div className="flex flex-col gap-6">
              <CustomFormField
                fieldType={FormFieldType.TEXTAREA}
                control={form.control}
                name="reason"
                label="Appointment reason"
                placeholder="Annual monthly check-up"
                disabled={type === "schedule"}
              />

              <CustomFormField
                fieldType={FormFieldType.TEXTAREA}
                control={form.control}
                name="note"
                label="Comments/notes"
                placeholder="Prefer afternoon appointments, if possible"
                disabled={type === "schedule"}
              />
            </div>
          </>
        )}

        {type === "cancel" && (
          <CustomFormField
            fieldType={FormFieldType.TEXTAREA}
            control={form.control}
            name="cancellationReason"
            label="Reason for cancellation"
            placeholder="Urgent meeting came up"
          />
        )}

        <FormError message={error} />

        <SubmitButton
          isLoading={isLoading}
          className={`${type === "cancel" ? "shad-danger-btn" : "shad-primary-btn"} w-full`}
        >
          {buttonLabel}
        </SubmitButton>
      </form>
    </Form>
  );
};
