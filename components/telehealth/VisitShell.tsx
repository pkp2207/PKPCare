// Server-rendered chrome for the public /visit/[token] page. No PHI: callers
// pass only a doctor name and a time.
import type { ReactNode } from "react";

export const EMERGENCY_NOTICE =
  "Video visits are not for emergencies. If you think you are having a medical emergency, call your local emergency number (for example 112 in India or 911 in the US) now.";

export const VisitShell = ({ children }: { children: ReactNode }) => (
  <main
    id="main"
    className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-6 py-10 text-white"
  >
    <p className="text-18-bold text-green-500">PKPCare</p>
    {children}
    <p className="text-14-regular text-dark-600">{EMERGENCY_NOTICE}</p>
  </main>
);

/** Polite live region for states such as "not open yet" / "ended". */
export const VisitMessage = ({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) => (
  <section aria-labelledby="visit-title" className="flex flex-col gap-3">
    <h1 id="visit-title" className="header">
      {title}
    </h1>
    <div role="status" aria-live="polite" className="flex flex-col gap-3 text-dark-700">
      {children}
    </div>
  </section>
);
