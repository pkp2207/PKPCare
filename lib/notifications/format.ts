// Date formatting for messages. With no (valid) timezone the output is
// identical to formatDateTime(...).dateTime so legacy SMS text is unchanged.
import { formatDateTime } from "@/lib/utils";

const validZone = (timezone?: string | null): string | null => {
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone
      ? timezone
      : null;
  } catch {
    return null;
  }
};

export const formatWhen = (
  value: Date | string,
  timezone?: string | null
): string => {
  const zone = validZone(timezone);
  if (!zone) return formatDateTime(value).dateTime;
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
    timeZone: zone,
    timeZoneName: "short",
  });
};

export const formatTimeOnly = (
  value: Date | string,
  timezone?: string | null
): string => {
  const zone = validZone(timezone);
  if (!zone) return formatDateTime(value).timeOnly;
  return new Date(value).toLocaleString("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: true,
    timeZone: zone,
    timeZoneName: "short",
  });
};
