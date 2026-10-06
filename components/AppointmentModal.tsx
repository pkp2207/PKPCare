"use client";

import { useRouter } from "next/navigation";
import { Dispatch, SetStateAction, useCallback, useState } from "react";

import { ui } from "@/components/admin/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Appointment } from "@/types/appwrite.types";

import { AppointmentForm } from "./forms/AppointmentForm";

import "react-datepicker/dist/react-datepicker.css";

/**
 * Schedule / cancel dialog for one appointment (Radix dialog: focus is trapped
 * and restored, Escape closes). The form shows server errors inline and keeps
 * the dialog open on failure; on success it closes it, and we refresh the
 * server data so the table reflects the change immediately.
 */
export const AppointmentModal = ({
  patientId,
  userId,
  appointment,
  patientName,
  type,
}: {
  patientId: string;
  userId: string;
  appointment?: Appointment;
  patientName?: string;
  type: "schedule" | "cancel";
}) => {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // AppointmentForm only calls setOpen(false) after a successful update.
  const handleOpen: Dispatch<SetStateAction<boolean>> = useCallback(
    (value) => {
      setOpen(value);
      if (value === false) router.refresh();
    },
    [router]
  );

  const name = patientName ?? appointment?.patient?.name;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            ui.btnGhost,
            ui.btnSm,
            "capitalize",
            type === "schedule" ? "text-green-500" : "text-red-500"
          )}
          aria-label={
            name ? `${type} appointment for ${name}` : `${type} appointment`
          }
        >
          {type}
        </button>
      </DialogTrigger>
      <DialogContent className={cn(ui.dialog, "sm:max-w-md")}>
        <DialogHeader className="mb-4 space-y-3">
          <DialogTitle className="capitalize text-white">
            {type} Appointment
          </DialogTitle>
          <DialogDescription>
            {type === "cancel"
              ? "The patient is notified. A reason is required."
              : "Confirm the doctor and time. The patient is notified."}
          </DialogDescription>
        </DialogHeader>

        <AppointmentForm
          userId={userId}
          patientId={patientId}
          type={type}
          appointment={appointment}
          setOpen={handleOpen}
        />
      </DialogContent>
    </Dialog>
  );
};
