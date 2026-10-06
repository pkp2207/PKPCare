"use client";

import * as Sentry from "@sentry/nextjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FormError } from "@/components/FormError";
import { Button } from "@/components/ui/button";
import { getAvailability } from "@/lib/actions/doctor.actions";

import { RadioGrid } from "./RadioGrid";
import {
  availabilityWindow,
  browserTimeZone,
  formatSlotLong,
  groupSlotsByDay,
  hasMoreWindows,
  mergeSlots,
  patientLocalTimeNote,
  type Slot,
  timeZoneLabel,
} from "./slots";
import { BTN_SECONDARY } from "./styles";

type Props = {
  doctor: Pick<PublicDoctor, "id" | "name" | "timezone">;
  /** ISO start of the selected slot. */
  value: string | null;
  onChange: (start: string | null) => void;
  /** Bump to re-fetch (e.g. after "that time was just taken"). */
  refreshKey?: number;
  /** A time to hide (the appointment being rescheduled). */
  excludeStart?: string | null;
  /** Shown when no times exist in the loaded range (e.g. a waitlist button). */
  emptyAction?: React.ReactNode;
  disabled?: boolean;
};

const SR_ONLY = "sr-only";

/**
 * Day + time picker over `getAvailability`. Loads the first 14-day window and
 * further windows only on request (the server caps a request at 14 days).
 * Every time is shown in the DOCTOR's timezone, labelled, with the patient's
 * local time added when the two differ.
 */
export const SlotPicker = ({
  doctor,
  value,
  onChange,
  refreshKey = 0,
  excludeStart = null,
  emptyAction,
  disabled = false,
}: Props) => {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadedWindows, setLoadedWindows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [patientZone, setPatientZone] = useState<string | null>(null);

  // Window math is anchored once per (doctor, refresh) so windows stay adjacent.
  const anchor = useRef<Date>(new Date());
  const requestId = useRef(0);
  const loadedRef = useRef(0);
  const lastDoctor = useRef<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => setPatientZone(browserTimeZone()), []);

  const fetchWindows = useCallback(
    async (indexes: number[], replace: boolean) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const results = await Promise.all(
          indexes.map((index) => {
            const { from, to } = availabilityWindow(anchor.current, index);
            return getAvailability({
              doctorId: doctor.id,
              from: from.toISOString(),
              to: to.toISOString(),
            });
          })
        );
        if (id !== requestId.current) return; // a newer request superseded this one

        const failed = results.find((result) => !result.ok);
        if (failed && !failed.ok) {
          setError(failed.error);
          return;
        }

        const fetched = results.flatMap((result) => (result.ok ? result.data : []));
        setSlots((current) => (replace ? mergeSlots([], fetched) : mergeSlots(current, fetched)));
        const loaded = Math.max(...indexes) + 1;
        loadedRef.current = Math.max(loadedRef.current, loaded);
        setLoadedWindows(loadedRef.current);

        // Someone else may have taken the chosen time: drop a stale selection.
        if (replace && valueRef.current) {
          const stillOpen = fetched.some((slot) => slot.start === valueRef.current);
          if (!stillOpen) onChangeRef.current(null);
        }
      } catch (err) {
        if (id !== requestId.current) return;
        Sentry.captureException(err);
        setError("We couldn't load available times. Please try again.");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [doctor.id]
  );

  // New doctor or explicit refresh: start over from "now". A refresh for the
  // same doctor reloads every window already shown so nothing disappears.
  useEffect(() => {
    const sameDoctor = lastDoctor.current === doctor.id;
    lastDoctor.current = doctor.id;
    anchor.current = new Date();

    let count = 1;
    if (sameDoctor) {
      count = Math.max(loadedRef.current, 1);
    } else {
      loadedRef.current = 0;
      setSlots([]);
      setLoadedWindows(0);
      setPickedDay(null);
    }
    fetchWindows(
      Array.from({ length: count }, (_, i) => i),
      true
    );
  }, [doctor.id, refreshKey, fetchWindows]);

  const visibleSlots = useMemo(
    () => (excludeStart ? slots.filter((slot) => slot.start !== excludeStart) : slots),
    [slots, excludeStart]
  );
  const days = useMemo(
    () => groupSlotsByDay(visibleSlots, doctor.timezone),
    [visibleSlots, doctor.timezone]
  );

  const valueDay = useMemo(
    () => days.find((day) => day.slots.some((slot) => slot.start === value))?.key ?? null,
    [days, value]
  );
  const activeDayKey =
    valueDay ?? (pickedDay && days.some((d) => d.key === pickedDay) ? pickedDay : days[0]?.key ?? null);
  const activeDay = days.find((day) => day.key === activeDayKey) ?? null;

  // Screen-reader status: loading, counts, empty.
  useEffect(() => {
    if (loading) setAnnouncement("Loading available times.");
    else if (error) setAnnouncement("");
    else if (days.length === 0) setAnnouncement("No available times found.");
    else setAnnouncement(`${visibleSlots.length} available times across ${days.length} days.`);
  }, [loading, error, days.length, visibleSlots.length]);

  const onPickDay = (key: string) => {
    setPickedDay(key);
    const day = days.find((d) => d.key === key);
    // Switching day clears a selection that belongs to another day.
    if (day && value && !day.slots.some((slot) => slot.start === value)) onChange(null);
    if (day) setAnnouncement(`${day.longLabel}: ${day.slots.length} times available.`);
  };

  const canLoadMore = hasMoreWindows(loadedWindows);
  const loadMore = () => fetchWindows([loadedWindows], false);

  const localNote =
    value && patientZone ? patientLocalTimeNote(value, doctor.timezone, patientZone) : null;

  return (
    <div className="space-y-4" aria-busy={loading}>
      <p className="text-14-regular text-dark-700">
        Times are shown in {timeZoneLabel(doctor.timezone)}, where {doctor.name} works.
      </p>

      <p role="status" aria-live="polite" className={SR_ONLY}>
        {announcement}
      </p>

      {error && (
        <div className="space-y-3">
          <FormError message={error} />
          <Button
            type="button"
            className={BTN_SECONDARY}
            onClick={() =>
              fetchWindows(
                Array.from({ length: Math.max(loadedWindows, 1) }, (_, i) => i),
                true
              )
            }
          >
            Try again
          </Button>
        </div>
      )}

      {loading && days.length === 0 && !error && (
        <p className="text-14-regular text-dark-700">Loading available times...</p>
      )}

      {!loading && !error && days.length === 0 && (
        <div className="space-y-3 rounded-md border border-dashed border-dark-500 p-4">
          <p className="text-14-regular text-dark-700">
            {doctor.name} has no open times in the days we have checked.
          </p>
          {emptyAction}
        </div>
      )}

      {days.length > 0 && (
        <>
          <div className="space-y-2">
            <p className="text-14-medium text-dark-700">Day</p>
            <RadioGrid
              label="Choose a day"
              className="flex flex-wrap gap-2"
              options={days.map((day) => ({
                value: day.key,
                label: day.label,
                hint: `${day.slots.length} ${day.slots.length === 1 ? "time" : "times"} available`,
              }))}
              value={activeDayKey}
              onChange={onPickDay}
              disabled={disabled}
            />
          </div>

          {activeDay && (
            <div className="space-y-2">
              <p className="text-14-medium text-dark-700">Time on {activeDay.longLabel}</p>
              <RadioGrid
                label={`Available times on ${activeDay.longLabel}`}
                className="grid grid-cols-3 gap-2 sm:grid-cols-4"
                options={activeDay.slots.map((slot) => ({
                  value: slot.start,
                  label: slot.label,
                }))}
                value={value}
                onChange={(start) => onChange(start)}
                disabled={disabled}
              />
            </div>
          )}
        </>
      )}

      {value && (
        <p className="text-14-medium text-white">
          Selected: {formatSlotLong(value, doctor.timezone)}
          {localNote && (
            <span className="text-14-regular mt-1 block text-dark-700">{localNote}</span>
          )}
        </p>
      )}

      {canLoadMore && !error && (days.length > 0 || !loading) && (
        <Button
          type="button"
          className={BTN_SECONDARY}
          onClick={loadMore}
          disabled={loading || disabled}
        >
          {loading ? "Loading..." : "Show later dates"}
        </Button>
      )}
    </div>
  );
};
