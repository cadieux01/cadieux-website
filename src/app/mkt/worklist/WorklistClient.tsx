"use client";

// Worklist UI — one card at a time, outcome buttons advance the queue.
//
// Why no "already contacted recently" PRE-FILTER (as opposed to a visible
// marker): the operator may deliberately want to re-contact someone they
// just spoke with (e.g. a callback). Hiding those rows would surprise
// them. So the queue shows everyone, sorted so uncontacted come first,
// with a visible warning ribbon on anyone contacted in the last 14 days.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MKT } from "@/components/mkt/theme";
import { telHref, whatsAppHref } from "@/lib/admin-formatting";
import { SEGMENT_LABEL, type Segment } from "@/lib/mkt-crm";
import { mktFetch, mktPost } from "@/lib/mkt-fetch";

type PrevOutreach = {
  id: string;
  channel: string;
  outcome: string;
  note: string | null;
  created_at: string;
  created_by: string;
};

type WorklistCustomer = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  total_orders: number;
  cancelled_orders: number;
  total_spent_rupees: number;
  last_order_at: string | null;
  last_cancelled_status_at: string | null;
  has_subscription: boolean;
  last_touch_at: string | null;
  last_touch_body: string | null;
  last_touch_kind: "note" | "whatsapp" | null;
  previous_outreach: PrevOutreach[];
  recently_contacted: boolean;
};

type WorklistResponse = {
  segment: Segment;
  summary: {
    total_in_segment: number;
    customers_contacted: number;
    outcomes: Record<string, number>;
  };
  customers: WorklistCustomer[];
};

const OUTCOMES: Array<{
  value: "contacted" | "no_answer" | "not_interested" | "ordered" | "wrong_number" | "callback";
  label: string;
  hue: "green" | "amber" | "red" | "blue" | "mute";
}> = [
  { value: "contacted", label: "Contacted", hue: "green" },
  { value: "ordered", label: "Ordered", hue: "green" },
  { value: "callback", label: "Call back", hue: "blue" },
  { value: "no_answer", label: "No answer", hue: "amber" },
  { value: "not_interested", label: "Not interested", hue: "red" },
  { value: "wrong_number", label: "Wrong number", hue: "red" },
];

const inr = (rupees: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export function WorklistClient({ segment }: { segment: Segment }) {
  const [data, setData] = useState<WorklistResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [busyOutcome, setBusyOutcome] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<"call" | "whatsapp" | "visit">("call");

  const load = useCallback(async () => {
    setError(null);
    try {
      const j = await mktFetch<WorklistResponse>(
        `/api/mkt/worklist?segment=${encodeURIComponent(segment)}`,
        { timeoutMs: 30_000 },
      );
      setData(j);
      setCursor(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [segment]);

  useEffect(() => {
    void load();
  }, [load]);

  const current: WorklistCustomer | null = data && data.customers[cursor]
    ? data.customers[cursor]
    : null;

  const logOutcome = async (
    outcome: typeof OUTCOMES[number]["value"],
  ) => {
    if (!current) return;
    setBusyOutcome(outcome);
    setLogError(null);
    try {
      await mktPost("/api/mkt/outreach", {
        customer_id: current.id,
        channel,
        outcome,
        segment,
        note: note.trim() || null,
      });
      // Optimistic: patch the local row so the summary + marker update
      // without a full reload, then advance the cursor.
      setData((prev) => {
        if (!prev) return prev;
        const customers = prev.customers.slice();
        const row = { ...customers[cursor] };
        row.previous_outreach = [
          {
            id: "pending",
            channel,
            outcome,
            note: note.trim() || null,
            created_at: new Date().toISOString(),
            created_by: "you",
          },
          ...row.previous_outreach,
        ];
        row.recently_contacted = true;
        customers[cursor] = row;
        const alreadyWorked = (customers[cursor].previous_outreach.length > 1)
          ? prev.summary.customers_contacted
          : prev.summary.customers_contacted + 1;
        return {
          ...prev,
          customers,
          summary: {
            ...prev.summary,
            customers_contacted: alreadyWorked,
            outcomes: {
              ...prev.summary.outcomes,
              [outcome]: (prev.summary.outcomes[outcome] ?? 0) + 1,
            },
          },
        };
      });
      setNote("");
      setCursor((c) => c + 1);
    } catch (e) {
      setLogError(e instanceof Error ? e.message : "Log failed");
    } finally {
      setBusyOutcome(null);
    }
  };

  const chipHref = `/mkt?segment=${encodeURIComponent(segment)}`;

  if (error) {
    return (
      <PaneError message={error} back={chipHref} />
    );
  }
  if (!data) {
    return <Skeleton />;
  }

  return (
    <div style={{ display: "grid", gap: "1.2rem" }}>
      <SummaryStrip
        segment={segment}
        summary={data.summary}
        position={cursor + 1}
        total={data.customers.length}
      />

      {data.customers.length === 0 ? (
        <EmptyState chipHref={chipHref} segment={segment} />
      ) : !current ? (
        <DonePane
          segment={segment}
          worked={data.summary.customers_contacted}
          chipHref={chipHref}
        />
      ) : (
        <CustomerCard
          customer={current}
          note={note}
          onNote={setNote}
          channel={channel}
          onChannel={setChannel}
          busyOutcome={busyOutcome}
          logError={logError}
          onOutcome={logOutcome}
          onSkip={() => setCursor((c) => c + 1)}
          onBack={() => setCursor((c) => Math.max(0, c - 1))}
          canGoBack={cursor > 0}
        />
      )}

      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Link
          href={chipHref}
          style={{ color: MKT.blue, fontSize: "0.92rem" }}
        >
          ← Back to {SEGMENT_LABEL[segment]} list
        </Link>
        <button
          type="button"
          onClick={() => void load()}
          style={quietButton}
        >
          Refresh queue
        </button>
      </div>
    </div>
  );
}

function SummaryStrip({
  segment,
  summary,
  position,
  total,
}: {
  segment: Segment;
  summary: WorklistResponse["summary"];
  position: number;
  total: number;
}) {
  const workedPct = summary.total_in_segment === 0
    ? 0
    : Math.round((summary.customers_contacted / summary.total_in_segment) * 100);
  return (
    <section
      style={{
        background: "#FFFFFF",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 12,
        boxShadow: MKT.cardShadow,
        padding: "0.9rem 1.1rem",
        display: "grid",
        gap: "0.6rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "0.6rem",
          flexWrap: "wrap",
        }}
      >
        <strong style={{ color: MKT.green, fontSize: "1.05rem" }}>
          {SEGMENT_LABEL[segment]}
        </strong>
        <span style={{ color: MKT.mute, fontSize: "0.88rem" }}>
          card {Math.min(position, Math.max(1, total))} of {total}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: "0.9rem",
          flexWrap: "wrap",
          color: MKT.ink,
          fontSize: "0.9rem",
          alignItems: "center",
        }}
      >
        <span>
          <strong>{summary.customers_contacted}</strong> of {summary.total_in_segment}{" "}
          contacted ({workedPct}%)
        </span>
        {Object.entries(summary.outcomes).length > 0 ? (
          <>
            <span style={{ color: MKT.ash }}>·</span>
            <OutcomeStrip outcomes={summary.outcomes} />
          </>
        ) : null}
      </div>
    </section>
  );
}

function OutcomeStrip({ outcomes }: { outcomes: Record<string, number> }) {
  const order: Array<typeof OUTCOMES[number]["value"]> = [
    "contacted",
    "ordered",
    "callback",
    "no_answer",
    "not_interested",
    "wrong_number",
  ];
  const parts = order
    .map((o) => ({ o, n: outcomes[o] ?? 0 }))
    .filter((p) => p.n > 0);
  if (parts.length === 0) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        gap: "0.5rem",
        flexWrap: "wrap",
        color: MKT.mute,
        fontSize: "0.88rem",
      }}
    >
      {parts.map(({ o, n }, i) => (
        <span key={o}>
          {i > 0 ? <span style={{ color: MKT.ash }}>·</span> : null}
          {n} {labelOf(o)}
        </span>
      ))}
    </span>
  );
}

function labelOf(o: typeof OUTCOMES[number]["value"]): string {
  return OUTCOMES.find((x) => x.value === o)?.label.toLowerCase() ?? o;
}

function CustomerCard({
  customer,
  note,
  onNote,
  channel,
  onChannel,
  busyOutcome,
  logError,
  onOutcome,
  onSkip,
  onBack,
  canGoBack,
}: {
  customer: WorklistCustomer;
  note: string;
  onNote: (s: string) => void;
  channel: "call" | "whatsapp" | "visit";
  onChannel: (c: "call" | "whatsapp" | "visit") => void;
  busyOutcome: string | null;
  logError: string | null;
  onOutcome: (outcome: typeof OUTCOMES[number]["value"]) => void;
  onSkip: () => void;
  onBack: () => void;
  canGoBack: boolean;
}) {
  const busy = busyOutcome !== null;
  return (
    <article
      style={{
        background: "#FFFFFF",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 12,
        boxShadow: MKT.cardShadow,
        padding: "1.1rem 1.25rem",
        display: "grid",
        gap: "0.9rem",
      }}
    >
      {customer.recently_contacted ? (
        <div
          role="status"
          style={{
            background: "#FFF4E5",
            border: `1px solid ${MKT.ash}`,
            borderLeft: `3px solid #B35A00`,
            color: "#8A4A00",
            padding: "0.5rem 0.75rem",
            borderRadius: 6,
            fontSize: "0.9rem",
          }}
        >
          Already contacted in the last 14 days. Check the history below
          before ringing again.
        </div>
      ) : null}

      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div style={{ display: "grid", gap: "0.1rem" }}>
          <strong style={{ fontSize: "1.1rem", color: MKT.ink }}>
            {customer.full_name ?? "Unnamed"}
          </strong>
          <span
            style={{
              color: MKT.mute,
              fontSize: "0.9rem",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {customer.phone ?? "no phone"}
            {customer.city ? ` · ${customer.city}` : ""}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: "0.4rem",
            flexWrap: "wrap",
          }}
        >
          {customer.phone ? (
            <>
              <a
                href={whatsAppHref(customer.phone)}
                target="_blank"
                rel="noreferrer"
                style={actionButton("green")}
              >
                WhatsApp
              </a>
              <a href={telHref(customer.phone)} style={actionButton("blue")}>
                Call
              </a>
            </>
          ) : (
            <span style={{ color: MKT.mute, fontSize: "0.88rem" }}>
              no phone on file
            </span>
          )}
        </div>
      </header>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: "0.5rem 1rem",
          margin: 0,
          color: MKT.ink,
          fontSize: "0.9rem",
        }}
      >
        <Field label="Orders" value={String(customer.total_orders)} />
        <Field
          label="Spent"
          value={inr(customer.total_spent_rupees)}
        />
        <Field
          label="Last order"
          value={formatDate(customer.last_order_at)}
        />
        {customer.cancelled_orders > 0 ? (
          <Field
            label="Cancellations"
            value={`${customer.cancelled_orders} · ${formatDate(
              customer.last_cancelled_status_at,
            )}`}
            tone="error"
          />
        ) : null}
        {customer.has_subscription ? (
          <Field label="Plan" value="Subscriber" tone="green" />
        ) : null}
      </dl>

      {customer.last_touch_body ? (
        <div
          style={{
            background: MKT.hover,
            border: `1px solid ${MKT.ash}`,
            borderRadius: 6,
            padding: "0.55rem 0.75rem",
            fontSize: "0.9rem",
            color: MKT.ink,
          }}
        >
          <span
            style={{
              color: MKT.mute,
              fontSize: "0.72rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 700,
              marginRight: "0.4rem",
            }}
          >
            Last note · {formatDate(customer.last_touch_at)}
          </span>
          {customer.last_touch_body.replace(/\s+/g, " ").trim()}
        </div>
      ) : null}

      {customer.previous_outreach.length > 0 ? (
        <section style={{ display: "grid", gap: "0.35rem" }}>
          <span
            style={{
              color: MKT.mute,
              fontSize: "0.72rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Previous outreach ({customer.previous_outreach.length})
          </span>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "0.3rem",
            }}
          >
            {customer.previous_outreach.slice(0, 3).map((o) => (
              <li
                key={o.id}
                style={{
                  border: `1px solid ${MKT.ash}`,
                  borderRadius: 6,
                  padding: "0.4rem 0.6rem",
                  display: "grid",
                  gap: "0.15rem",
                  fontSize: "0.88rem",
                  color: MKT.ink,
                  background: "#FFFFFF",
                }}
              >
                <span>
                  <strong>{labelOf(
                    o.outcome as typeof OUTCOMES[number]["value"],
                  )}</strong>{" "}
                  via {o.channel} · {formatDate(o.created_at)}
                </span>
                {o.note ? (
                  <span style={{ color: MKT.mute }}>{o.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <label
        style={{
          display: "grid",
          gap: "0.3rem",
          color: MKT.ink,
          fontSize: "0.9rem",
        }}
      >
        <span>Short note (optional)</span>
        <textarea
          value={note}
          onChange={(e) => onNote(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="e.g. mentioned they travel next week, try after 29th"
          disabled={busy}
        />
      </label>

      <section style={{ display: "grid", gap: "0.45rem" }}>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "baseline",
            flexWrap: "wrap",
          }}
        >
          <span style={{ color: MKT.mute, fontSize: "0.9rem" }}>
            Channel:
          </span>
          {(["call", "whatsapp", "visit"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChannel(c)}
              disabled={busy}
              style={{
                border: `1px solid ${c === channel ? MKT.green : MKT.ash}`,
                background: c === channel ? MKT.green : "#FFFFFF",
                color: c === channel ? MKT.cream : MKT.ink,
                padding: "0.35rem 0.75rem",
                borderRadius: 999,
                minHeight: 36,
                fontSize: "0.85rem",
                cursor: busy ? "default" : "pointer",
                fontWeight: c === channel ? 700 : 500,
              }}
            >
              {c === "call" ? "Call" : c === "whatsapp" ? "WhatsApp" : "Visit"}
            </button>
          ))}
        </div>
        <span style={{ color: MKT.mute, fontSize: "0.9rem" }}>
          Log the outcome — the queue moves on after each tap
        </span>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "0.5rem",
          }}
        >
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={busy}
              onClick={() => onOutcome(o.value)}
              style={outcomeButton(o.hue, busyOutcome === o.value)}
            >
              {busyOutcome === o.value ? "Logging…" : o.label}
            </button>
          ))}
        </div>
        {logError ? (
          <span style={{ color: MKT.error, fontSize: "0.88rem" }}>
            {logError}
          </span>
        ) : null}
      </section>

      <footer
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          style={quietButton}
        >
          ← Previous
        </button>
        <button type="button" onClick={onSkip} style={quietButton}>
          Skip for now →
        </button>
      </footer>
    </article>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "error" | "green";
}) {
  const colour =
    tone === "error" ? MKT.error : tone === "green" ? MKT.green : MKT.ink;
  return (
    <div style={{ display: "grid", gap: "0.1rem" }}>
      <span
        style={{
          color: MKT.mute,
          fontSize: "0.72rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <span style={{ color: colour, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function EmptyState({
  chipHref,
  segment,
}: {
  chipHref: string;
  segment: Segment;
}) {
  return (
    <section
      style={{
        background: "#FFFFFF",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 12,
        boxShadow: MKT.cardShadow,
        padding: "1.6rem 1.4rem",
        textAlign: "center",
        color: MKT.mute,
      }}
    >
      <p style={{ margin: 0, fontSize: "1rem", color: MKT.ink }}>
        Nothing in <strong>{SEGMENT_LABEL[segment]}</strong> to work.
      </p>
      <p style={{ margin: "0.3rem 0 0", fontSize: "0.9rem" }}>
        <Link href={chipHref} style={{ color: MKT.blue }}>
          Back to the list
        </Link>
      </p>
    </section>
  );
}

function DonePane({
  segment,
  worked,
  chipHref,
}: {
  segment: Segment;
  worked: number;
  chipHref: string;
}) {
  return (
    <section
      style={{
        background: "#FFFFFF",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 12,
        boxShadow: MKT.cardShadow,
        padding: "1.6rem 1.4rem",
        textAlign: "center",
      }}
    >
      <p style={{ margin: 0, fontSize: "1.05rem", color: MKT.green, fontWeight: 700 }}>
        End of queue.
      </p>
      <p style={{ margin: "0.3rem 0 0", color: MKT.ink, fontSize: "0.95rem" }}>
        {worked} customer{worked === 1 ? "" : "s"} contacted in{" "}
        {SEGMENT_LABEL[segment]} so far.{" "}
        <Link href={chipHref} style={{ color: MKT.blue }}>
          Back to the list
        </Link>
      </p>
    </section>
  );
}

function PaneError({
  message,
  back,
}: {
  message: string;
  back: string;
}) {
  return (
    <div
      role="alert"
      style={{
        border: `1px solid ${MKT.error}`,
        background: MKT.errorBg,
        color: MKT.error,
        padding: "0.8rem 1rem",
        borderRadius: 8,
      }}
    >
      <div>{message}</div>
      <Link href={back} style={{ color: MKT.blue, fontSize: "0.9rem" }}>
        Back to list
      </Link>
    </div>
  );
}

function Skeleton() {
  return (
    <div
      style={{
        display: "grid",
        gap: "0.9rem",
      }}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            height: i === 0 ? 70 : 180,
            borderRadius: 12,
            background: MKT.hover,
            border: `1px solid ${MKT.ash}`,
          }}
        />
      ))}
    </div>
  );
}

// ── Button styles ──────────────────────────────────────────────────

const quietButton: React.CSSProperties = {
  border: `1px solid ${MKT.ash}`,
  background: "#FFFFFF",
  color: MKT.ink,
  padding: "0.55rem 0.9rem",
  borderRadius: 6,
  minHeight: 44,
  fontSize: "0.92rem",
  cursor: "pointer",
};

function actionButton(hue: "green" | "blue"): React.CSSProperties {
  const bg = hue === "green" ? MKT.green : MKT.blue;
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.55rem 0.9rem",
    borderRadius: 6,
    minHeight: 44,
    background: bg,
    color: MKT.cream,
    fontSize: "0.92rem",
    fontWeight: 600,
    textDecoration: "none",
  };
}

function outcomeButton(
  hue: "green" | "amber" | "red" | "blue" | "mute",
  busy: boolean,
): React.CSSProperties {
  const palette: Record<typeof hue, { bg: string; fg: string; border: string }> = {
    green: { bg: "#F0F7F2", fg: MKT.green, border: MKT.green },
    amber: { bg: "#FFF4E5", fg: "#8A4A00", border: "#B35A00" },
    red:   { bg: "#FCECEC", fg: MKT.error, border: MKT.error },
    blue:  { bg: "#F0F4FC", fg: MKT.blue,  border: MKT.blue },
    mute:  { bg: MKT.hover, fg: MKT.ink,   border: MKT.ash  },
  };
  const p = palette[hue];
  return {
    border: `1px solid ${p.border}`,
    background: busy ? MKT.hover : p.bg,
    color: p.fg,
    padding: "0.6rem 0.75rem",
    borderRadius: 6,
    minHeight: 44,
    fontSize: "0.92rem",
    fontWeight: 600,
    cursor: busy ? "default" : "pointer",
  };
}
