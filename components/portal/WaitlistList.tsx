"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { leaveWaitlist } from "@/lib/actions/waitlist.actions";

import { ConfirmDialog } from "./ConfirmDialog";
import { formatDayShort, formatSlotLong } from "./slots";
import { BTN_PRIMARY, BTN_SECONDARY } from "./styles";

export type WaitlistItem = {
  $id: string;
  doctorId: string;
  earliest: string;
  latest: string;
  status: "waiting" | "offered" | "fulfilled" | "expired";
  offeredStart?: string | null;
};

export const WaitlistList = ({
  userId,
  entries,
  doctors,
}: {
  userId: string;
  entries: WaitlistItem[];
  doctors: PublicDoctor[];
}) => {
  const router = useRouter();
  const [notice, setNotice] = useState("");

  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="waitlist-heading" className="space-y-4">
      <h2 id="waitlist-heading" className="sub-header">
        Waitlist
      </h2>
      <p role="status" aria-live="polite" className="text-14-regular text-green-500">
        {notice}
      </p>
      <ul className="space-y-4">
        {entries.map((entry) => {
          const doctor = doctors.find((d) => d.id === entry.doctorId);
          const tz = doctor?.timezone ?? "UTC";
          const name = doctor ? `Dr. ${doctor.name}` : "your doctor";
          return (
            <li
              key={entry.$id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dark-500 bg-dark-400 p-4 sm:p-6"
            >
              <div className="space-y-1">
                <h3 className="text-16-semibold text-white">{name}</h3>
                <p className="text-14-regular text-dark-700">
                  Any time between {formatDayShort(entry.earliest, tz)} and{" "}
                  {formatDayShort(entry.latest, tz)}
                </p>
                <p className="text-14-medium text-white">
                  {entry.status === "offered" && entry.offeredStart
                    ? `A time was offered: ${formatSlotLong(entry.offeredStart, tz)}`
                    : "Waiting for an opening"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {entry.status === "offered" && (
                  <Button asChild className={BTN_PRIMARY}>
                    <Link href={`/patients/${encodeURIComponent(userId)}/new-appointment?doctor=${encodeURIComponent(entry.doctorId)}`}>
                      Book it
                    </Link>
                  </Button>
                )}
                <ConfirmDialog
                  trigger={
                    <Button
                      type="button"
                      className={BTN_SECONDARY}
                      aria-label={`Leave waitlist for ${name}`}
                    >
                      Leave waitlist
                    </Button>
                  }
                  title="Leave the waitlist?"
                  description={`You will no longer be offered openings with ${name}.`}
                  confirmLabel="Leave waitlist"
                  cancelLabel="Stay on waitlist"
                  destructive
                  onConfirm={async () => {
                    const result = await leaveWaitlist({ entryId: entry.$id, userId });
                    if (!result.ok) return result.error;
                    setNotice(`You left the waitlist for ${name}.`);
                    router.refresh();
                    return null;
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
