"use client";

import { useState, useTransition } from "react";

import { FormError } from "@/components/FormError";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cancelViaLink } from "@/lib/actions/notification.actions";

export const CancelForm = ({ token }: { token: string }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p role="status" className="text-16-semibold">
        Your appointment has been cancelled.
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="shad-gray-btn min-h-12 w-full"
        onClick={() => setOpen(true)}
      >
        Cancel appointment
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await cancelViaLink({ token, reason });
          if (result.ok) setDone(true);
          else setError(result.error);
        });
      }}
    >
      <label htmlFor="cancel-reason" className="shad-input-label">
        Reason for cancelling
      </label>
      <Textarea
        id="cancel-reason"
        className="shad-textArea"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        minLength={2}
        maxLength={500}
        required
        aria-describedby="cancel-reason-hint"
      />
      <p id="cancel-reason-hint" className="text-14-regular text-dark-600">
        Please do not include medical details.
      </p>
      <FormError message={error} />
      <div className="flex gap-3">
        <Button
          type="submit"
          className="shad-danger-btn min-h-12 flex-1"
          disabled={pending || reason.trim().length < 2}
        >
          {pending ? "Cancelling..." : "Confirm cancellation"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="shad-gray-btn min-h-12"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Keep it
        </Button>
      </div>
    </form>
  );
};
