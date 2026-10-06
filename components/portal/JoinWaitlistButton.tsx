"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

import { FormError } from "@/components/FormError";
import { Button } from "@/components/ui/button";
import { joinWaitlist } from "@/lib/actions/waitlist.actions";

import { RadioGrid } from "./RadioGrid";
import { BTN_PRIMARY } from "./styles";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = [
  { value: "14", label: "2 weeks" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
];

/**
 * "Join waitlist" for a doctor with no open times. The patient picks how far
 * ahead they could accept an opening; the entry is visible (and can be left) on
 * their appointments page.
 */
export const JoinWaitlistButton = ({
  userId,
  patientId,
  doctor,
}: {
  userId: string;
  patientId: string;
  doctor: Pick<PublicDoctor, "id" | "name">;
}) => {
  const [days, setDays] = useState("30");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  const join = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const now = Date.now();
      const result = await joinWaitlist({
        userId,
        patientId,
        doctorId: doctor.id,
        earliest: new Date(now),
        latest: new Date(now + Number(days) * DAY_MS),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setJoined(true);
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (joined) {
    return (
      <p role="status" className="text-14-regular text-green-500">
        You are on the waitlist for {doctor.name}. If a time opens up it will appear on your
        appointments page.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-14-regular text-dark-700">
        Join the waitlist and we will offer you a time if one opens up. How far ahead could you
        come in?
      </p>
      <RadioGrid
        label="Waitlist window"
        className="flex flex-wrap gap-2"
        options={WINDOWS}
        value={days}
        onChange={setDays}
        disabled={isLoading}
      />
      <div aria-live="polite">
        <FormError message={error} />
      </div>
      <Button
        type="button"
        className={BTN_PRIMARY}
        onClick={join}
        disabled={isLoading}
        aria-busy={isLoading}
      >
        {isLoading ? "Joining..." : `Join waitlist for ${doctor.name}`}
      </Button>
    </div>
  );
};
