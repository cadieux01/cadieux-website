"use client";

// Segment-level error boundary for /admin/*. Next.js calls this when any
// child throws during render. Without it, a runtime render crash unmounts
// the whole tree and the operator sees a blank dark screen with nothing
// in the console (we shipped exactly this on /admin/audit-log).
//
// Renders the actual error message + stack so the operator can copy it
// into a bug report instead of guessing what broke. A Retry button calls
// Next's `reset()` to remount the segment.

import { useEffect } from "react";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console so the failure surfaces in browser devtools
    // regardless of whether the visible banner is dismissed.
    console.error("[admin error boundary]", error);
  }, [error]);

  return (
    <main
      className="min-h-screen relative"
      style={{
        background: "rgb(6,4,2)",
        padding: "3rem 1.5rem",
        fontFamily: "var(--font-body)",
        color: CREAM,
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1
          className="uppercase"
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            letterSpacing: "0.18em",
            fontSize: "clamp(1.4rem, 5vw, 2rem)",
            color: CREAM,
            marginBottom: "0.5rem",
          }}
        >
          Admin page crashed
        </h1>
        <p
          style={{
            color: FADED,
            fontSize: "0.85rem",
            marginBottom: "1.5rem",
          }}
        >
          A runtime error stopped the page from rendering. The details below
          come straight from the browser — copy them into a bug report.
        </p>

        <div
          role="alert"
          style={{
            border: "1px solid rgba(239,68,68,0.55)",
            background: "rgba(239,68,68,0.08)",
            padding: "1rem 1.2rem",
            color: "#fecaca",
            fontSize: "0.85rem",
            lineHeight: 1.5,
            marginBottom: "1.5rem",
          }}
        >
          <strong
            style={{
              color: "#fca5a5",
              letterSpacing: "0.1em",
              display: "block",
              marginBottom: "0.5rem",
            }}
          >
            {error.name || "Error"}
          </strong>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
              fontSize: "0.78rem",
              margin: 0,
            }}
          >
            {error.message || "(no message)"}
          </pre>
          {error.digest ? (
            <p
              style={{
                marginTop: "0.75rem",
                fontSize: "0.7rem",
                color: "rgba(254,202,202,0.7)",
                letterSpacing: "0.08em",
              }}
            >
              digest: {error.digest}
            </p>
          ) : null}
          {error.stack ? (
            <details style={{ marginTop: "0.75rem" }}>
              <summary
                style={{
                  cursor: "pointer",
                  color: "#fca5a5",
                  fontSize: "0.7rem",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                Stack trace
              </summary>
              <pre
                style={{
                  marginTop: "0.5rem",
                  fontFamily:
                    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                  fontSize: "0.72rem",
                  color: "rgba(254,202,202,0.75)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {error.stack}
              </pre>
            </details>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={reset}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              color: GOLD,
              border: `1px solid ${GOLD}`,
              padding: "0.55rem 1.1rem",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
          <a
            href="/admin/overview"
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              color: FADED,
              border: `1px solid rgba(245,158,11,0.25)`,
              padding: "0.55rem 1.1rem",
              background: "transparent",
              textDecoration: "none",
            }}
          >
            Back to Overview
          </a>
        </div>
      </div>
    </main>
  );
}
