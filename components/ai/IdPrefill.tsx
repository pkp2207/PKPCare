"use client";

import { useEffect, useRef, useState } from "react";

import { useAiStatus } from "@/components/ai/useAiStatus";
import { extractIdDetails } from "@/lib/actions/ai.actions";

type Fields = Partial<{
  name: string;
  birthDate: string;
  identificationNumber: string;
  identificationType: string;
}>;

type Key = keyof Fields;

const LABELS: Record<Key, string> = {
  name: "Full name",
  birthDate: "Date of birth (YYYY-MM-DD)",
  identificationNumber: "ID number",
  identificationType: "ID type",
};
const KEYS: Key[] = ["name", "birthDate", "identificationNumber", "identificationType"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Row = { value: string; confidence: "low" | "medium" | "high"; checked: boolean };

/**
 * Opt-in "fill from my ID". Suggestions are shown for the user to tick/edit and
 * are only passed to `onApply` when the user presses Apply. Renders nothing
 * when AI is disabled.
 */
export function IdPrefill(props: {
  file: File | null;
  onApply: (fields: Fields) => void;
}): JSX.Element {
  const { file, onApply } = props;
  const status = useAiStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Partial<Record<Key, Row>> | null>(null);
  const run = useRef(0);

  // A different file invalidates any previous suggestion or in-flight request.
  useEffect(() => {
    run.current += 1;
    setRows(null);
    setError(null);
    setBusy(false);
  }, [file]);

  if (status?.enabled !== true || !file) return <></>;

  if (!IMAGE_TYPES.includes(file.type)) {
    return (
      <p className="text-12-regular text-dark-600">
        AI fill works with image files (JPEG, PNG or WebP) only, not PDFs.
      </p>
    );
  }

  const start = async () => {
    const id = ++run.current;
    setBusy(true);
    setError(null);
    setRows(null);
    try {
      const formData = new FormData();
      formData.append("blobFile", new Blob([file], { type: file.type }));
      formData.append("fileName", file.name);
      const result = await extractIdDetails(formData);
      if (id !== run.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const next: Partial<Record<Key, Row>> = {};
      KEYS.forEach((key) => {
        const found = result.data.fields[key];
        if (found) {
          next[key] = {
            value: found.value,
            confidence: found.confidence,
            checked: found.confidence !== "low",
          };
        }
      });
      if (Object.keys(next).length === 0) {
        setError("Could not read any details from this image. You can type them instead.");
        return;
      }
      setRows(next);
    } catch {
      if (id === run.current) setError("AI assistance is temporarily unavailable.");
    } finally {
      if (id === run.current) setBusy(false);
    }
  };

  const update = (key: Key, patch: Partial<Row>) =>
    setRows((current) =>
      current && current[key] ? { ...current, [key]: { ...current[key], ...patch } as Row } : current,
    );

  const apply = () => {
    if (!rows) return;
    const out: Fields = {};
    KEYS.forEach((key) => {
      const row = rows[key];
      const value = row?.value.trim();
      if (row?.checked && value) out[key] = value;
    });
    onApply(out);
    setRows(null);
  };

  return (
    <section
      aria-label="Fill details from ID using AI"
      className="flex flex-col gap-3 rounded-lg border border-dark-500 bg-dark-400 p-4 text-sm"
    >
      {!rows ? (
        <>
          <p className="text-dark-700">
            Optional. If you choose this, the image of your ID is sent to our AI provider to read
            your name, date of birth and ID number. The AI feature does not save the image or the
            result. You will review everything before anything is filled in.
          </p>
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="w-fit rounded-md border border-green-500 px-4 py-2 text-green-500 hover:bg-green-600 disabled:opacity-60"
          >
            {busy ? "Reading your ID..." : "Fill details from my ID (uses AI)"}
          </button>
        </>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-semibold text-white">
            Check these details, untick or edit anything that is wrong
          </legend>
          {KEYS.map((key) => {
            const row = rows[key];
            if (!row) return null;
            const inputId = `id-prefill-${key}`;
            return (
              <div key={key} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={row.checked}
                  onChange={(e) => update(key, { checked: e.target.checked })}
                  aria-label={`Use ${LABELS[key]}`}
                  className="mt-2"
                />
                <div className="flex flex-1 flex-col gap-1">
                  <label htmlFor={inputId} className="text-dark-700">
                    {LABELS[key]}
                    {row.confidence === "low" ? " (low confidence, check carefully)" : ""}
                  </label>
                  <input
                    id={inputId}
                    value={row.value}
                    onChange={(e) => update(key, { value: e.target.value })}
                    className="rounded-md border border-dark-500 bg-dark-300 px-3 py-2 text-white"
                  />
                </div>
              </div>
            );
          })}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={apply}
              className="rounded-md bg-green-500 px-4 py-2 text-white"
            >
              Apply selected
            </button>
            <button
              type="button"
              onClick={() => setRows(null)}
              className="rounded-md border border-dark-500 px-4 py-2 text-dark-700"
            >
              Dismiss
            </button>
          </div>
        </fieldset>
      )}
      {error ? (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
