"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { verifyAdminPasskey } from "@/lib/actions/auth.actions";

export const PasskeyModal = () => {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [passkey, setPasskey] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const closeModal = () => {
    setOpen(false);
    router.push("/");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      closeModal();
    } else {
      setOpen(true);
    }
  };

  const validatePasskey = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending || !passkey) return;

    setError("");
    startTransition(async () => {
      try {
        const result = await verifyAdminPasskey(passkey);

        if (result.ok) {
          setOpen(false);
          router.push("/admin");
          router.refresh();
        } else {
          setError(result.error);
          setPasskey("");
        }
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="shad-alert-dialog">
        <form onSubmit={validatePasskey} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-start justify-between">
              Admin Access Verification
              <button
                type="button"
                aria-label="Close"
                onClick={closeModal}
                className="cursor-pointer"
              >
                <Image
                  src="/assets/icons/close.svg"
                  alt=""
                  width={20}
                  height={20}
                />
              </button>
            </AlertDialogTitle>
            <AlertDialogDescription>
              To access the admin page, please enter the passkey.
            </AlertDialogDescription>
            <Link href="/login/staff" className="text-14-regular text-green-500">
              Have a staff account? Sign in with email
            </Link>
          </AlertDialogHeader>
          <div>
            <InputOTP
              maxLength={6}
              value={passkey}
              onChange={(value) => setPasskey(value)}
              disabled={isPending}
              autoFocus
            >
              <InputOTPGroup className="shad-otp">
                <InputOTPSlot className="shad-otp-slot" index={0} />
                <InputOTPSlot className="shad-otp-slot" index={1} />
                <InputOTPSlot className="shad-otp-slot" index={2} />
                <InputOTPSlot className="shad-otp-slot" index={3} />
                <InputOTPSlot className="shad-otp-slot" index={4} />
                <InputOTPSlot className="shad-otp-slot" index={5} />
              </InputOTPGroup>
            </InputOTP>

            {error && (
              <p
                role="alert"
                className="shad-error text-14-regular mt-4 flex justify-center"
              >
                {error}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <Button
              type="submit"
              disabled={isPending || !passkey}
              aria-busy={isPending}
              className="shad-primary-btn w-full"
            >
              {isPending ? "Verifying..." : "Enter Admin Passkey"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
};
