"use client";

import { useEffect, useState } from "react";

const FORMATS = {
  dateTime: {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
  date: { month: "short", day: "numeric", year: "numeric" },
  time: { hour: "numeric", minute: "2-digit" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

/**
 * Renders an instant in the viewer's timezone. The first (server + hydration)
 * render is UTC so markup matches; the browser zone is applied right after
 * mount. Avoids hydration mismatches and shows server-zone times to nobody.
 */
export function LocalTime({
  iso,
  format = "dateTime",
  className,
}: {
  iso: string;
  format?: keyof typeof FORMATS;
  className?: string;
}) {
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(true), []);

  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) {
    return <span className={className}>-</span>;
  }
  const text = new Intl.DateTimeFormat("en-US", {
    ...FORMATS[format],
    ...(local ? {} : { timeZone: "UTC" }),
  }).format(date);

  return (
    <time dateTime={iso} className={className}>
      {text}
      {local || format === "date" ? "" : " UTC"}
    </time>
  );
}
