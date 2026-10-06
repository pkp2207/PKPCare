"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

import { FormError } from "@/components/FormError";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelMyAppointment,
  rescheduleAppointment,
} from "@/lib/actions/appointment.actions";
import { getVisitLink } from "@/lib/actions/telehealth.actions";

import type { DashboardAppointment } from "./appointments";
import { videoLinkState } from "./appointments";
import { ConfirmDialog } from "./ConfirmDialog";
import { SlotPicker } from "./SlotPicker";
import { formatSlotLong, isSlotTakenError } from "./slots";
import { BTN_PRIMARY, BTN_SECONDARY } from "./styles";

type Doctor = Pick<PublicDoctor, "id" | "name" | "timezone" | "legacy">;

const toLocalInputValue = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

export const CancelAppointment = ({
  appointment,
  userId,
  label,
  onDone,
}: {
  appointment: DashboardAppointment;
  userId: string;
  /** Used in the accessible name, e.g. "Dr. Green on Oct 7". */
  label: string;
  onDone: (message: string) => void;
}) => {
  const [reason, setReason] = useState("");

  return (
    <ConfirmDialog
      trigger={
        <Button type="button" className={BTN_SECONDARY} aria-label={`Cancel appointment: ${label}`}>
          Cancel
        </Button>
      }
      title="Cancel this appointment?"
      description={`${label}. Cancelling frees this time for other patients. Please tell us why so we can improve.`}
      confirmLabel="Yes, cancel appointment"
      cancelLabel="Keep appointment"
      destructive
      confirmDisabled={reason.trim().length < 2}
      onOpenChange={(open) => {
        if (!open) setReason("");
      }}
      onConfirm={async () => {
        const result = await cancelMyAppointment({
          appointmentId: appointment.$id,
          userId,
          reason: reason.trim(),
        });
        if (!result.ok) return result.error;
        onDone(`Your appointment (${label}) was cancelled.`);
        return null;
      }}
    >
      <div className="space-y-2">
        <label htmlFor={`cancel-reason-${appointment.$id}`} className="shad-input-label">
          Reason for cancelling
        </label>
        <Textarea
          id={`cancel-reason-${appointment.$id}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          placeholder="Something came up"
          className="border-dark-500 bg-dark-400 text-white"
        />
      </div>
    </ConfirmDialog>
  );
};

export const RescheduleAppointment = ({
  appointment,
  doctor,
  userId,
  label,
  onDone,
}: {
  appointment: DashboardAppointment;
  /** null when the doctor can no longer be found (inactive / removed). */
  doctor: Doctor | null;
  userId: string;
  label: string;
  onDone: (message: string) => void;
}) => {
  const [slot, setSlot] = useState<string | null>(null);
  const [legacyValue, setLegacyValue] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const currentIso = new Date(appointment.schedule).toISOString();
  const legacy = !!doctor?.legacy;

  const trigger = (
    <Button type="button" className={BTN_SECONDARY} aria-label={`Reschedule appointment: ${label}`}>
      Reschedule
    </Button>
  );

  if (!doctor) {
    return (
      <ConfirmDialog
        trigger={trigger}
        title="Reschedule"
        description="We could not find this doctor's calendar online. Please contact the clinic to change this appointment."
        confirmLabel="OK"
        cancelLabel="Close"
        confirmDisabled
        onConfirm={async () => null}
      />
    );
  }

  const chosenIso = legacy
    ? legacyValue
      ? new Date(legacyValue).toISOString()
      : null
    : slot;

  return (
    <ConfirmDialog
      wide
      trigger={trigger}
      title="Choose a new time"
      description={`${label}. Your current time stays booked until you confirm a new one.`}
      confirmLabel="Confirm new time"
      cancelLabel="Keep current time"
      confirmDisabled={!chosenIso}
      onOpenChange={(open) => {
        if (!open) {
          setSlot(null);
          setLegacyValue("");
          setHint(null);
        }
      }}
      onConfirm={async () => {
        if (!chosenIso) return "Choose a new time first.";
        const result = await rescheduleAppointment({
          appointmentId: appointment.$id,
          userId,
          newStart: chosenIso,
        });
        if (!result.ok) {
          if (!legacy && isSlotTakenError(result.error)) {
            setSlot(null);
            setRefreshKey((key) => key + 1);
            return "That time was just taken. We have refreshed the list - please choose another time.";
          }
          return result.error;
        }
        onDone(`Your appointment was moved to ${formatSlotLong(chosenIso, doctor.timezone)}.`);
        return null;
      }}
    >
      {legacy ? (
        <div className="space-y-2">
          <label htmlFor={`resched-${appointment.$id}`} className="shad-input-label">
            New date and time (your local time)
          </label>
          <input
            id={`resched-${appointment.$id}`}
            type="datetime-local"
            value={legacyValue}
            min={toLocalInputValue(new Date())}
            onChange={(event) => setLegacyValue(event.target.value)}
            className="h-11 w-full rounded-md border border-dark-500 bg-dark-400 px-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          />
        </div>
      ) : (
        <SlotPicker
          doctor={doctor}
          value={slot}
          onChange={(start) => {
            setSlot(start);
            setHint(null);
          }}
          refreshKey={refreshKey}
          excludeStart={currentIso}
        />
      )}
      {hint && <p className="text-14-regular text-blue-500">{hint}</p>}
    </ConfirmDialog>
  );
};

/**
 * "Join video visit": asks I1's getVisitLink for the link when clicked, so a
 * failure (not configured, too early, not allowed) is explained instead of
 * breaking the page.
 */
export const JoinVideoButton = ({
  appointmentId,
  timeZone,
}: {
  appointmentId: string;
  timeZone: string;
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const join = async () => {
    setMessage(null);
    setIsLoading(true);
    try {
      const state = videoLinkState(await getVisitLink(appointmentId));
      if (state.kind === "open") {
        window.open(state.url, "_blank", "noopener,noreferrer");
      } else if (state.kind === "early") {
        setMessage(`Your video visit opens at ${formatSlotLong(state.opensAt, timeZone)}.`);
      } else {
        setMessage(state.message);
      }
    } catch (err) {
      Sentry.captureException(err);
      setMessage("Your video visit link is not available right now. Please try again shortly.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        className={BTN_PRIMARY}
        onClick={join}
        disabled={isLoading}
        aria-busy={isLoading}
      >
        {isLoading ? "Opening..." : "Join video visit"}
      </Button>
      <div aria-live="polite">
        <FormError message={message} />
      </div>
    </div>
  );
};
