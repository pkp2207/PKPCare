"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  type AdminDoctor,
  bulkUpdateAppointments,
  type ConflictingAppointment,
  listConflictingAppointments,
} from "@/lib/actions/admin.actions";
import { addTimeOff, upsertDoctor } from "@/lib/actions/doctor.actions";

import { LocalTime } from "./LocalTime";
import { ui } from "./ui";

export function TimeOffManager({ doctor }: { doctor: AdminDoctor }) {
  const router = useRouter();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictingAppointment[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [cancelReason, setCancelReason] = useState("Doctor unavailable");
  const [pending, startTransition] = useTransition();

  const add = () =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      setConflicts([]);
      const s = new Date(start);
      const e = new Date(end);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) {
        setError("Choose a start and an end after it.");
        return;
      }
      const result = await addTimeOff({
        doctorId: doctor.id,
        start: s.toISOString(),
        end: e.toISOString(),
        reason: reason.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStart("");
      setEnd("");
      setReason("");
      const count = result.data.conflictingAppointments;
      setNotice(
        count === 0
          ? "Time off added. No bookings are affected."
          : `Time off added. ${count} existing booking${count === 1 ? "" : "s"} overlap and were NOT cancelled.`
      );
      if (count > 0) {
        const list = await listConflictingAppointments({
          doctorId: doctor.id,
          start: s.toISOString(),
          end: e.toISOString(),
        });
        if (list.ok) {
          setConflicts(list.data);
          setPicked(Object.fromEntries(list.data.map((c) => [c.id, true])));
        }
      }
      router.refresh();
    });

  const remove = (index: number) =>
    startTransition(async () => {
      setError(null);
      const remaining = doctor.timeOff.filter((_, i) => i !== index);
      const result = await upsertDoctor({
        id: doctor.id,
        name: doctor.name,
        specialty: doctor.specialty,
        image: doctor.image,
        email: doctor.email,
        staffUserId: doctor.staffUserId,
        timeOff: remaining,
      });
      if (!result.ok) setError(result.error);
      else setNotice("Time off removed.");
      router.refresh();
    });

  const cancelPicked = () =>
    startTransition(async () => {
      const ids = conflicts.filter((c) => picked[c.id]).map((c) => c.id);
      const result = await bulkUpdateAppointments({
        ids,
        action: "cancel",
        reason: cancelReason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { succeeded, failed, skipped } = result.data;
      setNotice(`Cancelled ${succeeded}, skipped ${skipped}, failed ${failed}.`);
      setConflicts(conflicts.filter((c) => !ids.includes(c.id) || !result.data.results.find((r) => r.id === c.id && r.status !== "failed")));
      router.refresh();
    });

  return (
    <section aria-labelledby={`timeoff-${doctor.id}`} className="space-y-4">
      <h3 id={`timeoff-${doctor.id}`} className="text-16-semibold">
        Time off
      </h3>

      {doctor.timeOff.length === 0 ? (
        <p className={ui.hint}>No upcoming or recent time off.</p>
      ) : (
        <ul className="space-y-2">
          {doctor.timeOff.map((entry, index) => (
            <li key={`${entry.start}-${index}`} className="text-14-regular flex flex-wrap items-center gap-3">
              <span>
                <LocalTime iso={entry.start} /> to <LocalTime iso={entry.end} />
                {entry.reason ? ` - ${entry.reason}` : ""}
              </span>
              <button
                type="button"
                disabled={pending}
                className={`${ui.btnGhost} ${ui.btnSm} text-red-500`}
                onClick={() => remove(index)}
              >
                Remove<span className="sr-only"> time off starting {entry.start}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label className={ui.label} htmlFor={`to-s-${doctor.id}`}>Start</label>
          <input id={`to-s-${doctor.id}`} type="datetime-local" className={ui.input} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className={ui.label} htmlFor={`to-e-${doctor.id}`}>End</label>
          <input id={`to-e-${doctor.id}`} type="datetime-local" className={ui.input} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className={ui.label} htmlFor={`to-r-${doctor.id}`}>Reason (optional)</label>
          <input id={`to-r-${doctor.id}`} className={ui.input} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <p className={ui.hint}>Entered in your browser&apos;s timezone.</p>
      <button type="button" className={ui.btnSecondary} disabled={pending || !start || !end} onClick={add}>
        Add time off
      </button>

      <div role="status" aria-live="polite">
        {notice && <p className="text-14-regular text-green-500">{notice}</p>}
      </div>
      {error && <p role="alert" className={ui.error}>{error}</p>}

      {conflicts.length > 0 && (
        <div className={ui.card}>
          <h4 className="text-14-medium">Bookings overlapping this time off</h4>
          <ul className="mt-2 space-y-1">
            {conflicts.map((c) => (
              <li key={c.id} className="text-14-regular flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`c-${c.id}`}
                  className="size-4 accent-green-500"
                  checked={picked[c.id] ?? false}
                  onChange={(e) => setPicked({ ...picked, [c.id]: e.target.checked })}
                />
                <label htmlFor={`c-${c.id}`}>
                  {c.patientName ?? "Unknown patient"} - <LocalTime iso={c.schedule} /> ({c.status})
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-1">
            <label className={ui.label} htmlFor={`cr-${doctor.id}`}>Cancellation reason (sent to patients)</label>
            <input id={`cr-${doctor.id}`} className={ui.input} maxLength={500} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <button
            type="button"
            className={`${ui.btnDanger} mt-3`}
            disabled={pending || !conflicts.some((c) => picked[c.id]) || cancelReason.trim().length < 2}
            onClick={cancelPicked}
          >
            Cancel selected bookings
          </button>
        </div>
      )}
    </section>
  );
}
