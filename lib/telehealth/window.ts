// Pure time-window rules for a video visit.
export const VISIT_OPEN_BEFORE_MINUTES = 10;
export const VISIT_CLOSE_AFTER_MINUTES = 30;
/** Visit tokens outlive the join window so late arrivals see "ended", not "invalid". */
export const VISIT_TOKEN_GRACE_MINUTES = 60;

const MIN = 60_000;

export type VisitWindowState = "early" | "open" | "late";

export type VisitWindow = {
  state: VisitWindowState;
  opensAt: Date;
  closesAt: Date;
};

export const computeVisitWindow = (
  start: Date,
  end: Date,
  now: Date,
): VisitWindow => {
  const opensAt = new Date(start.getTime() - VISIT_OPEN_BEFORE_MINUTES * MIN);
  const closesAt = new Date(end.getTime() + VISIT_CLOSE_AFTER_MINUTES * MIN);
  const t = now.getTime();
  const state: VisitWindowState =
    t < opensAt.getTime() ? "early" : t > closesAt.getTime() ? "late" : "open";
  return { state, opensAt, closesAt };
};

/** Token lifetime: appointment end plus grace (epoch ms). */
export const visitTokenExpiry = (end: Date): number =>
  end.getTime() + VISIT_TOKEN_GRACE_MINUTES * MIN;
