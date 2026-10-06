"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

import { FormError } from "@/components/FormError";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY } from "./styles";

/**
 * Accessible confirmation dialog built on Radix Dialog (focus trap, Escape to
 * close, focus returns to the trigger, aria-labelledby/-describedby wired to the
 * title/description). `onConfirm` returns an error message to keep the dialog
 * open and show it, or null on success (dialog closes).
 *
 * Does not use the `shad-dialog` class: its `button` rule removes focus rings.
 */
export const ConfirmDialog = ({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Keep as is",
  destructive = false,
  confirmDisabled = false,
  onConfirm,
  onOpenChange,
  children,
  wide = false,
}: {
  /** The element that opens the dialog (rendered as the trigger child). */
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => Promise<string | null>;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  wide?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (next: boolean) => {
    if (isLoading) return; // don't dismiss mid-request
    setOpen(next);
    if (!next) setError(null);
    onOpenChange?.(next);
  };

  const confirm = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const message = await onConfirm();
      if (message) {
        setError(message);
        return;
      }
      setIsLoading(false);
      setOpen(false);
      onOpenChange?.(false);
    } catch (err) {
      Sentry.captureException(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className={cn(
          "max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto border-dark-500 bg-dark-400 text-white motion-reduce:!animate-none",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg"
        )}
      >
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-18-bold">{title}</DialogTitle>
          <DialogDescription className="text-14-regular !text-dark-700">
            {description}
          </DialogDescription>
        </DialogHeader>

        {children}

        <div aria-live="polite">
          <FormError message={error} />
        </div>

        <DialogFooter className="gap-2 sm:gap-2 sm:space-x-0">
          <DialogClose asChild>
            <Button type="button" className={BTN_SECONDARY} disabled={isLoading}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            type="button"
            className={destructive ? BTN_DANGER : BTN_PRIMARY}
            onClick={confirm}
            disabled={isLoading || confirmDisabled}
            aria-busy={isLoading}
          >
            {isLoading ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
