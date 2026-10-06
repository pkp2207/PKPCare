"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  exportMyData,
  requestAccountDeletion,
  withdrawConsent,
} from "@/lib/actions/compliance.actions";

import { ConfirmDialog } from "./ConfirmDialog";
import { consentCopyFor } from "./consent-copy";
import { BTN_PRIMARY, BTN_SECONDARY } from "./styles";

export type ConsentRow = {
  purpose: "treatment" | "disclosure" | "privacy";
  granted: boolean;
  policyVersion: string | null;
  updatedAt: string | null;
};

const dateText = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

export const ConsentList = ({ userId, consents }: { userId: string; consents: ConsentRow[] }) => {
  const router = useRouter();
  const [notice, setNotice] = useState("");

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="text-14-regular text-green-500">
        {notice}
      </p>
      <ul className="space-y-4">
        {consents.map((consent) => {
          const copy = consentCopyFor(consent.purpose);
          const title = copy?.title ?? consent.purpose;
          return (
            <li
              key={consent.purpose}
              className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-dark-500 bg-dark-400 p-4 sm:p-6"
            >
              <div className="max-w-xl space-y-1">
                <h3 className="text-16-semibold text-white">{title}</h3>
                <p className="text-14-medium text-white">
                  {consent.granted ? "Given" : "Not given / withdrawn"}
                  {dateText(consent.updatedAt) && (
                    <span className="font-normal text-dark-700">
                      {" "}
                      - updated {dateText(consent.updatedAt)}
                      {consent.policyVersion ? ` (policy ${consent.policyVersion})` : ""}
                    </span>
                  )}
                </p>
                {copy && <p className="text-14-regular text-dark-700">{copy.statement}</p>}
              </div>
              {consent.granted && (
                <ConfirmDialog
                  trigger={
                    <Button
                      type="button"
                      className={BTN_SECONDARY}
                      aria-label={`Withdraw consent: ${title}`}
                    >
                      Withdraw
                    </Button>
                  }
                  title={`Withdraw: ${title}?`}
                  description={copy?.withdrawalEffect ?? "This consent will be withdrawn."}
                  confirmLabel="Yes, withdraw consent"
                  cancelLabel="Keep my consent"
                  destructive
                  onConfirm={async () => {
                    const result = await withdrawConsent({ userId, purpose: consent.purpose });
                    if (!result.ok) return result.error;
                    setNotice(`Consent withdrawn: ${title}.`);
                    router.refresh();
                    return null;
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-14-regular text-dark-700">
        Withdrawing a consent does not undo earlier processing. To give a consent again, please
        contact the clinic.
      </p>
    </div>
  );
};

export const DownloadDataButton = ({ userId }: { userId: string }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const download = async () => {
    setMessage(null);
    setIsLoading(true);
    try {
      const result = await exportMyData(userId);
      if (!result.ok) {
        setMessage({ text: result.error, error: true });
        return;
      }
      // Built in the browser from the response; nothing is stored anywhere.
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pkpcare-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage({
        text: "Your file was downloaded. It contains health information, so keep it somewhere safe.",
        error: false,
      });
    } catch (err) {
      Sentry.captureException(err);
      setMessage({ text: "Something went wrong. Please try again.", error: true });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        type="button"
        className={BTN_PRIMARY}
        onClick={download}
        disabled={isLoading}
        aria-busy={isLoading}
      >
        {isLoading ? "Preparing..." : "Download my data"}
      </Button>
      <p
        role={message?.error ? "alert" : "status"}
        aria-live="polite"
        className={message?.error ? "shad-error text-14-regular" : "text-14-regular text-green-500"}
      >
        {message?.text}
      </p>
    </div>
  );
};

export const DeleteAccountRequest = ({ userId }: { userId: string }) => {
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p role="status" className="text-14-regular text-green-500">
        Your request was received. Nothing has been deleted yet: the clinic will review it, because
        some records may have to be kept by law, and will contact you.
      </p>
    );
  }

  return (
    <ConfirmDialog
      trigger={
        <Button type="button" className={BTN_SECONDARY}>
          Request account deletion
        </Button>
      }
      title="Request deletion of your account?"
      description="This sends a request to the clinic. Nothing is deleted immediately. If approved, your profile, uploaded ID and personal details are erased. Some records (for example anonymised appointment statistics and audit records) may be kept where the law requires."
      confirmLabel="Send deletion request"
      cancelLabel="Not now"
      destructive
      confirmDisabled={!understood}
      onOpenChange={(open) => {
        if (!open) {
          setReason("");
          setUnderstood(false);
        }
      }}
      onConfirm={async () => {
        const result = await requestAccountDeletion({
          userId,
          reason: reason.trim() || undefined,
        });
        if (!result.ok) return result.error;
        setSent(true);
        return null;
      }}
    >
      <div className="space-y-2">
        <label htmlFor="deletion-reason" className="shad-input-label">
          Reason (optional)
        </label>
        <Textarea
          id="deletion-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          className="border-dark-500 bg-dark-400 text-white"
        />
      </div>
      <div className="flex min-h-11 items-start gap-3">
        <input
          id="deletion-confirm"
          type="checkbox"
          checked={understood}
          onChange={(event) => setUnderstood(event.target.checked)}
          className="mt-1 size-6 accent-green-500"
        />
        <label htmlFor="deletion-confirm" className="text-14-regular text-white">
          I understand that approved deletion cannot be undone.
        </label>
      </div>
    </ConfirmDialog>
  );
};
