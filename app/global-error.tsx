"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // global-error replaces the root layout, so app styles (Tailwind) can't be
  // relied on here; keep the markup self-contained with inline styles.
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          textAlign: "center",
          background: "#131619",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main role="alert">
          <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#abb8c4", margin: "0 0 24px" }}>
            An unexpected error occurred. Our team has been notified.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: "#24ae7c",
              color: "#fff",
              border: 0,
              borderRadius: 6,
              padding: "12px 24px",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ color: "#76828d", fontSize: 12, marginTop: 24 }}>
              Error reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
