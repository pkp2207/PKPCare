import { formatPercent, type Heatmap } from "@/lib/analytics/metrics";

import { ui } from "./ui";

export type BarDatum = {
  label: string;
  value: number;
  /** Text shown next to the bar; defaults to the value. */
  display?: string;
};

/** Collapsed data table that mirrors a chart (the accessible alternative). */
function DataAlternative({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="mt-3">
      <summary className={`${ui.hint} cursor-pointer rounded ${ui.focus}`}>
        View as table
      </summary>
      <div className={`${ui.tableWrap} mt-2`}>
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-dark-200">
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col" className={ui.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-dark-400">
                {row.map((cell, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className={`${ui.td} text-left font-normal`}>{cell}</th>
                  ) : (
                    <td key={j} className={ui.td}>{cell}</td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Horizontal bars in plain HTML/CSS. `max` defaults to the largest value. */
export function BarChart({
  title,
  data,
  max,
  valueHeader = "Count",
}: {
  title: string;
  data: BarDatum[];
  max?: number;
  valueHeader?: string;
}) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className={ui.card}>
      <figcaption className="text-16-semibold mb-3">{title}</figcaption>
      {data.length === 0 ? (
        <p className={ui.hint}>No data.</p>
      ) : (
        <ul className="space-y-2" aria-label={title}>
          {data.map((d) => (
            <li key={d.label} className="text-14-regular grid grid-cols-[8rem_1fr_4.5rem] items-center gap-3">
              <span className="truncate" title={d.label}>{d.label}</span>
              <span className="h-4 rounded bg-dark-300" aria-hidden="true">
                <span
                  className="block h-4 rounded bg-green-500"
                  style={{ width: `${Math.min(100, (d.value / top) * 100)}%` }}
                />
              </span>
              <span className="text-right tabular-nums">{d.display ?? d.value}</span>
            </li>
          ))}
        </ul>
      )}
      <DataAlternative
        caption={title}
        headers={["Item", valueHeader]}
        rows={data.map((d) => [d.label, d.display ?? d.value])}
      />
    </figure>
  );
}

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Day x hour heatmap. Cell text carries the count so colour is never the only cue. */
export function HeatmapChart({ title, heatmap }: { title: string; heatmap: Heatmap }) {
  const { matrix, days, max, timeZone } = heatmap;
  // Only show the hours that have any activity, plus padding, to keep it compact.
  const used = matrix.flatMap((row) => row.map((v, h) => (v > 0 ? h : -1))).filter((h) => h >= 0);
  const first = used.length ? Math.max(0, Math.min(...used) - 1) : 8;
  const last = used.length ? Math.min(23, Math.max(...used) + 1) : 18;
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  return (
    <figure className={ui.card}>
      <figcaption className="text-16-semibold mb-1">{title}</figcaption>
      <p className={`${ui.hint} mb-3`}>
        Appointments by weekday and start hour ({timeZone}); cancelled excluded.
      </p>
      <div className="overflow-x-auto">
        <div
          role="img"
          aria-label={`${title}. Use the table below for exact values.`}
          className="grid min-w-[560px] gap-px text-xs"
          style={{ gridTemplateColumns: `3rem repeat(${hours.length}, minmax(0, 1fr))` }}
        >
          <span />
          {hours.map((h) => (
            <span key={h} className="text-center text-dark-700">{String(h).padStart(2, "0")}</span>
          ))}
          {days.map((day, row) => (
            <div key={day} className="contents">
              <span className="pr-1 capitalize text-dark-700">{day}</span>
              {hours.map((h) => {
                const v = matrix[row][h];
                const alpha = max > 0 ? 0.15 + 0.85 * (v / max) : 0;
                return (
                  <span
                    key={h}
                    className="flex h-7 items-center justify-center rounded-sm text-white"
                    style={{ backgroundColor: v > 0 ? `rgba(36,174,124,${alpha.toFixed(2)})` : "rgba(54,58,61,0.4)" }}
                  >
                    {v > 0 ? v : ""}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <DataAlternative
        caption={`${title} (busiest slots)`}
        headers={["Weekday", "Hour", "Appointments"]}
        rows={days
          .flatMap((day, row) =>
            matrix[row].map((v, h) => ({ day, h, v }))
          )
          .filter((cell) => cell.v > 0)
          .sort((a, b) => b.v - a.v)
          .slice(0, 30)
          .map((cell) => [cell.day, hourLabel(cell.h), cell.v])}
      />
    </figure>
  );
}

export const pct = formatPercent;
