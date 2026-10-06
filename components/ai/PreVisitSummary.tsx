"use client";

import { useCallback, useEffect, useState } from "react";

import { useAiStatus } from "@/components/ai/useAiStatus";
import { getPreVisitSummary } from "@/lib/actions/ai.actions";

type Summary = { summary: string; generatedBy: "ai" | "template"; flags: string[] };

/**
 * Staff-only pre-visit summary. With AI disabled the deterministic template is
 * loaded automatically; with AI enabled it is generated on demand. All text is
 * rendered as plain text (never HTML).
 */
export function PreVisitSummary(props: { appointmentId: string }): JSX.Element {
  const { appointmentId } = props;
  const status = useAiStatus();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPreVisitSummary(appointmentId);
      if (result.ok) setData(result.data);
      else setError(result.error);
    } catch {
      setError("Could not prepare the summary. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [appointmentId]);

  useEffect(() => {
    setData(null);
    setError(null);
    if (status && !status.enabled) load();
  }, [status, load]);

  const copy = async () => {
    if (!data) return;
    const body = `${data.summary}\n\nFlags:\n${data.flags.map((f) => `- ${f}`).join("\n")}`;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the text and copy it manually.");
    }
  };

  if (status === undefined) return <></>;

  return (
    <section
      aria-label="Pre-visit summary"
      className="flex flex-col gap-3 rounded-lg border border-dark-500 bg-dark-400 p-4 text-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-white">Pre-visit summary</h3>
        <span className="rounded bg-yellow-700 px-2 py-0.5 text-xs text-white">
          Draft — verify with the patient
        </span>
      </div>

      {!data && status?.enabled ? (
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="w-fit rounded-md border border-green-500 px-4 py-2 text-green-500 hover:bg-green-600 disabled:opacity-60"
        >
          {loading ? "Generating..." : "Generate summary"}
        </button>
      ) : null}
      {!data && !status?.enabled && loading ? <p className="text-dark-600">Loading...</p> : null}

      {data ? (
        <>
          <p className="text-xs text-dark-600">
            {data.generatedBy === "ai"
              ? "Factual lines come straight from the record; the overview was drafted by AI."
              : "Template summary built from the record (no AI used)."}
          </p>
          <div className="whitespace-pre-wrap text-dark-700">{data.summary}</div>
          {data.flags.length > 0 ? (
            <div>
              <p className="font-semibold text-white">Check</p>
              <ul className="list-disc pl-5 text-dark-700">
                {data.flags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-dark-500 px-3 py-1 text-dark-700 hover:bg-dark-300"
            >
              Copy
            </button>
            <span role="status" aria-live="polite" className="text-xs text-green-500">
              {copied ? "Copied" : ""}
            </span>
          </div>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
