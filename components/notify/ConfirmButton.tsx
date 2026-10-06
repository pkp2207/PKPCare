"use client";

import { useState, useTransition } from "react";

import { FormError } from "@/components/FormError";
import { Button } from "@/components/ui/button";
import { confirmAttendance } from "@/lib/actions/notification.actions";

export const ConfirmButton = ({ token }: { token: string }) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p role="status" className="text-16-semibold text-green-500">
        Thank you, your attendance is confirmed.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        className="shad-primary-btn min-h-12 w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await confirmAttendance(token);
            if (result.ok) setDone(true);
            else setError(result.error);
          })
        }
      >
        {pending ? "Confirming..." : "Confirm I will attend"}
      </Button>
      <FormError message={error} />
    </div>
  );
};
