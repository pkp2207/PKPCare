"use client";

import { useId } from "react";

import { ui } from "./ui";
import {
  addRange,
  copyDay,
  type HoursError,
  removeRange,
  type Weekday,
  WEEK_ORDER,
  WEEKDAY_LABELS,
  type WeeklyModel,
  updateRange,
} from "./weekly-hours";

/**
 * Controlled per-weekday editor. Errors come from validateModel() and are tied
 * to inputs with aria-describedby; the parent decides when to block saving.
 */
export function WeeklyHoursEditor({
  value,
  onChange,
  errors,
  disabled = false,
}: {
  value: WeeklyModel;
  onChange: (next: WeeklyModel) => void;
  errors: HoursError[];
  disabled?: boolean;
}) {
  const uid = useId();

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-16-semibold mb-2">Weekly hours</legend>
      {WEEK_ORDER.map((day: Weekday) => {
        const dayErrors = errors.filter((e) => e.day === day);
        const errorId = `${uid}-${day}-err`;
        return (
          <div key={day} className="rounded-lg border border-dark-500 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-14-medium w-28">{WEEKDAY_LABELS[day]}</h4>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`${ui.btnSecondary} ${ui.btnSm}`}
                  onClick={() => onChange(addRange(value, day))}
                >
                  Add range<span className="sr-only"> for {WEEKDAY_LABELS[day]}</span>
                </button>
                {value[day].length > 0 && (
                  <button
                    type="button"
                    className={`${ui.btnGhost} ${ui.btnSm}`}
                    onClick={() =>
                      onChange(copyDay(value, day, WEEK_ORDER.filter((d) => d !== "sat" && d !== "sun")))
                    }
                  >
                    Copy to weekdays
                    <span className="sr-only"> from {WEEKDAY_LABELS[day]}</span>
                  </button>
                )}
              </div>
            </div>

            {value[day].length === 0 ? (
              <p className={`${ui.hint} mt-2`}>Closed</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {value[day].map((range, index) => {
                  const invalid = dayErrors.some((e) => e.index === index);
                  return (
                    <li key={index} className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`${uid}-${day}-${index}-s`}>
                        {WEEKDAY_LABELS[day]} range {index + 1} start
                      </label>
                      <input
                        id={`${uid}-${day}-${index}-s`}
                        type="time"
                        value={range.start}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? errorId : undefined}
                        className={`${ui.input} w-32`}
                        onChange={(e) =>
                          onChange(updateRange(value, day, index, { start: e.target.value }))
                        }
                      />
                      <span aria-hidden="true">to</span>
                      <label className="sr-only" htmlFor={`${uid}-${day}-${index}-e`}>
                        {WEEKDAY_LABELS[day]} range {index + 1} end
                      </label>
                      <input
                        id={`${uid}-${day}-${index}-e`}
                        type="time"
                        value={range.end}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? errorId : undefined}
                        className={`${ui.input} w-32`}
                        onChange={(e) =>
                          onChange(updateRange(value, day, index, { end: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className={`${ui.btnGhost} ${ui.btnSm} text-red-500`}
                        onClick={() => onChange(removeRange(value, day, index))}
                      >
                        Remove<span className="sr-only"> range {index + 1} on {WEEKDAY_LABELS[day]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div id={errorId} role={dayErrors.length ? "alert" : undefined}>
              {dayErrors.map((e, i) => (
                <p key={i} className={ui.error}>
                  {e.index !== undefined ? `Range ${e.index + 1}: ` : ""}
                  {e.message}
                </p>
              ))}
            </div>
          </div>
        );
      })}
      <p className={ui.hint}>
        Times are the doctor&apos;s local wall-clock time.
      </p>
    </fieldset>
  );
}
