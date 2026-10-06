"use client";

import { useEffect, useMemo, useState } from "react";

import { useAiStatus } from "@/components/ai/useAiStatus";
import { suggestSpecialty } from "@/lib/actions/ai.actions";
import { listDoctors } from "@/lib/actions/doctor.actions";
import { buildRedFlagMessage, detectRedFlags } from "@/lib/ai/red-flags";

const DEBOUNCE_MS = 800;
const MIN_CHARS = 15;

type Suggestion = {
  specialty: string;
  doctorIds: string[];
  disclaimer: string;
};

type DoctorLite = { id: string; name: string };

/**
 * Advisory symptom -> specialty hint for the booking form.
 *  - The red-flag banner is a SAFETY feature: it renders whenever the
 *    deterministic rules match, even when AI is disabled.
 *  - The suggestion card renders only when AI is enabled and the server
 *    returned a usable suggestion; otherwise nothing is shown.
 */
export function SymptomRouter(props: {
  reason: string;
  onSelectDoctor?: (doctorId: string) => void;
}): JSX.Element {
  const { reason, onSelectDoctor } = props;
  const status = useAiStatus();
  const enabled = status?.enabled === true;

  const text = reason ?? "";
  const matches = useMemo(() => detectRedFlags(text), [text]);
  const redFlag = matches.length > 0;
  const bannerMessage = useMemo(
    () =>
      buildRedFlagMessage(
        matches.map((m) => m.category),
        status?.emergencyNumber,
      ),
    [matches, status?.emergencyNumber],
  );

  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [doctors, setDoctors] = useState<DoctorLite[]>([]);

  useEffect(() => {
    setSuggestion(null);
    const trimmed = text.trim();
    if (!enabled || redFlag || trimmed.length < MIN_CHARS) return undefined;

    // Server actions cannot be aborted mid-flight; `cancelled` makes any
    // in-flight result from an older input be ignored.
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await suggestSpecialty({ reason: trimmed });
        if (cancelled || !result.ok) return;
        const data = result.data;
        if (data.redFlag || !data.specialty || data.doctorIds.length === 0) return;
        const list = await listDoctors();
        if (cancelled) return;
        if (list.ok) {
          setDoctors(list.data.map((d) => ({ id: d.id, name: d.name })));
        }
        setSuggestion({
          specialty: data.specialty,
          doctorIds: data.doctorIds,
          disclaimer: data.disclaimer,
        });
      } catch {
        // Silently hide on any failure.
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, enabled, redFlag]);

  if (redFlag) {
    return (
      <div
        role="alert"
        className="rounded-lg border-2 border-white bg-red-700 p-4 text-white shadow-lg"
      >
        <p className="text-16-semibold font-bold">Possible emergency</p>
        <p className="mt-1 text-sm">{bannerMessage}</p>
      </div>
    );
  }

  if (!enabled || !suggestion) return <></>;

  const names = suggestion.doctorIds.map(
    (id) => doctors.find((d) => d.id === id) ?? { id, name: "" },
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-dark-500 bg-dark-400 p-4 text-sm text-dark-700"
    >
      <p>
        <span className="font-semibold text-white">
          Suggested: {suggestion.specialty}
        </span>
        {names.length > 0 ? " — " : ""}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {names.map((doctor) => (
          <li key={doctor.id} className="flex items-center justify-between gap-3">
            <span>{doctor.name ? `Dr ${doctor.name.replace(/^Dr\.?\s*/i, "")}` : "Doctor"}</span>
            {onSelectDoctor ? (
              <button
                type="button"
                onClick={() => onSelectDoctor(doctor.id)}
                className="rounded-md border border-green-500 px-3 py-1 text-green-500 hover:bg-green-600"
                aria-label={`Select ${doctor.name || "this doctor"}`}
              >
                Select
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-dark-600">{suggestion.disclaimer}</p>
    </div>
  );
}
