import type { Metadata } from "next";

import { AutoRefresh } from "@/components/telehealth/AutoRefresh";
import { DeviceChecklist } from "@/components/telehealth/DeviceChecklist";
import { VisitNotice } from "@/components/telehealth/VisitNotice";
import { VisitMessage, VisitShell } from "@/components/telehealth/VisitShell";
import { getRoom, isTelehealthEnabled } from "@/lib/telehealth";
import { verifyVisitToken } from "@/lib/telehealth/token";
import {
  checkVisitEligibility,
  loadVisitContext,
  type VisitContext,
} from "@/lib/telehealth/visit";
import {
  computeVisitWindow,
  VISIT_OPEN_BEFORE_MINUTES,
} from "@/lib/telehealth/window";

export const dynamic = "force-dynamic";

// The token is a credential: keep it out of referrers and search indexes.
export const metadata: Metadata = {
  title: "Video visit | PKPCare",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const formatTime = (date: Date, timeZone: string) => {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
  }
};

const Unavailable = () => (
  <VisitShell>
    <VisitMessage title="This link is not available">
      <p>
        The link is invalid, has expired, or video visits are not available right
        now. Please open your appointment again to get a new link, or contact the
        clinic.
      </p>
    </VisitMessage>
  </VisitShell>
);

const When = ({ ctx }: { ctx: VisitContext }) => (
  <p>
    With {ctx.doctorName} on{" "}
    <time dateTime={ctx.start.toISOString()}>{formatTime(ctx.start, ctx.timezone)}</time>
  </p>
);

const VisitPage = async ({ params }: { params: { token: string } }) => {
  const now = new Date();

  if (!isTelehealthEnabled()) return <Unavailable />;
  const verified = verifyVisitToken(params.token, now.getTime());
  if (!verified.ok) return <Unavailable />;

  let ctx: VisitContext | null;
  try {
    ctx = await loadVisitContext(verified.claims.appointmentId);
  } catch {
    return <Unavailable />;
  }
  if (!ctx) return <Unavailable />;

  const eligible = checkVisitEligibility(ctx);
  if (!eligible.ok) {
    return (
      <VisitShell>
        <VisitMessage title="This visit is not available">
          <p>{eligible.message}</p>
        </VisitMessage>
      </VisitShell>
    );
  }

  const window = computeVisitWindow(ctx.start, ctx.end, now);

  if (window.state === "early") {
    return (
      <VisitShell>
        <VisitMessage title="Your visit has not opened yet">
          <When ctx={ctx} />
          <p>
            The room opens {VISIT_OPEN_BEFORE_MINUTES} minutes before the start, at{" "}
            <time dateTime={window.opensAt.toISOString()}>
              {formatTime(window.opensAt, ctx.timezone)}
            </time>
            . Keep this page open; the join button will appear here.
          </p>
        </VisitMessage>
        <DeviceChecklist />
        <AutoRefresh at={window.opensAt.toISOString()} />
      </VisitShell>
    );
  }

  if (window.state === "late") {
    return (
      <VisitShell>
        <VisitMessage title="This visit has ended">
          <When ctx={ctx} />
          <p>If you still need to speak with your doctor, please contact the clinic.</p>
        </VisitMessage>
      </VisitShell>
    );
  }

  // Window is open: only now is the room address computed and shown.
  let roomUrl: string;
  try {
    roomUrl = (await getRoom({ appointmentId: ctx.appointmentId, start: ctx.start })).url;
  } catch {
    return <Unavailable />;
  }

  return (
    <VisitShell>
      <VisitMessage title="Your video visit is ready">
        <When ctx={ctx} />
      </VisitMessage>
      <DeviceChecklist />
      <VisitNotice />
      <a
        href={roomUrl}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        className="shad-primary-btn inline-flex h-11 items-center justify-center rounded-md px-6 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Join video visit
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </VisitShell>
  );
};

export default VisitPage;
