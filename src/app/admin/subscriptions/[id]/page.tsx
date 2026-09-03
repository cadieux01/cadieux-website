"use client";

// Single-subscription detail page for /admin/subscriptions.
//
// Reached by clicking any row in the subscriptions list, exactly like
// /admin/orders/[id] is reached from the orders list — and laid out the
// same way, so an operator reading one already knows how to read the
// other.
//
// Why this exists alongside the drawer: the drawer is the WORKBENCH (it
// changes overall status, payment status, per-delivery status and notes)
// and only shows the handful of fields those actions need. It silently
// drops what the customer actually chose — the day/slot pairs for a
// multi-day plan, the per-loaf price, payment method, start date, the
// original address snapshot. This page shows every stored field in one
// view.
//
// The ONE thing it writes is per-delivery status, through the same
// PATCH .../deliveries/[deliveryId] route the drawer uses. Overall
// status and payment status stay in the drawer — one owner per field.
//
// Styling is lifted verbatim from /admin/orders/[id] (same panel /
// Block / KeyVal idiom, same print stylesheet) rather than invented.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { ContactActions } from "@/components/admin/ContactActions";
import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  PartnerShareButton,
  type ShareablePartner,
} from "@/components/admin/PartnerShareButton";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDate, formatDateTime, formatINR } from "@/lib/admin-formatting";
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_OPTIONS,
  type AdminDeliveryRow,
  type AdminSubscriptionRow,
} from "@/lib/admin-shared";
import Select from "@/components/ui/Select";
import {
  describeSubscriptionPlan,
  resolveSubscriptionAddress,
  formatAddressFull,
  phonesDiffer,
} from "@/lib/subscription-display";
import { composeSubscriptionShareMessage } from "@/lib/subscription-share-message";
import { DAY_LABEL } from "@/lib/subscription-ui";

type DetailResponse = {
  subscription: AdminSubscriptionRow;
  deliveries: AdminDeliveryRow[];
};

const DASH = "—";

/** Every field renders through here, so a null column can never surface
 *  as an empty cell or the literal string "null". */
function show(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  const s = String(v).trim();
  return s === "" ? DASH : s;
}

/** "pending_confirmation" → "Pending confirmation". */
function humanise(v: string | null | undefined): string {
  if (!v) return DASH;
  const s = v.replace(/_/g, " ").trim();
  if (!s) return DASH;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Postgres `numeric` can arrive as a string depending on the driver
 *  path, and formatINR only accepts numbers. */
function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** "mon" → "Monday"; unknown keys pass through capitalised. */
function dayLabel(key: string): string {
  return DAY_LABEL[key.toLowerCase()] ?? humanise(key);
}

export default function AdminSubscriptionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [sub, setSub] = useState<AdminSubscriptionRow | null>(null);
  const [deliveries, setDeliveries] = useState<AdminDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  // Delivery partners power the "Share" button (same popover as the list
  // + orders). Fetched once; the page itself never writes.
  const [partners, setPartners] = useState<ShareablePartner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [partnersError, setPartnersError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch<{
          partners: { id: string; name: string; phone: string }[];
        }>("/api/admin/delivery-partners");
        if (cancelled) return;
        setPartners(
          (res.partners ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            phone: p.phone,
          })),
        );
        setPartnersError(null);
      } catch (e) {
        if (cancelled) return;
        setPartnersError(
          e instanceof AdminFetchError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Could not load partners.",
        );
      } finally {
        if (!cancelled) setPartnersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch<DetailResponse>(
        `/api/admin/subscriptions/${encodeURIComponent(params.id)}`,
      );
      setSub(res.subscription ?? null);
      setDeliveries(res.deliveries ?? []);
    } catch (e) {
      if (e instanceof AdminFetchError && e.status === 404) {
        setMissing(true);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Could not load subscription.");
      }
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Per-delivery status control. Optimistic: the cell flips immediately,
  // and any failure restores the exact previous list. `expected_status`
  // makes the write conditional on the status this row was rendered with,
  // so a row that moved elsewhere 409s instead of clobbering.
  //
  // Cancelling ONE delivery does not touch the subscription. The only
  // knock-on is the deliveries route's existing auto-complete: when the
  // LAST open delivery reaches delivered/cancelled it flips an `active`
  // subscription to `completed`. That's why we reload the whole detail
  // payload afterwards rather than only patching local state.
  const [deliveryBusyId, setDeliveryBusyId] = useState<string | null>(null);

  const updateDeliveryStatus = async (
    delivery: AdminDeliveryRow,
    next: string,
  ) => {
    if (next === delivery.status) return;
    if (
      next === "cancelled" &&
      !confirm(
        `Cancel delivery ${delivery.sequence ?? ""} (${formatDate(
          delivery.scheduled_date ?? delivery.delivery_date,
        )})?\n\nThis cancels ONLY this delivery. The subscription itself stays as it is.`,
      )
    ) {
      return;
    }

    const prev = deliveries;
    setDeliveryBusyId(delivery.id);
    setDeliveries((curr) =>
      curr.map((d) => (d.id === delivery.id ? { ...d, status: next } : d)),
    );
    try {
      await adminFetch(
        `/api/admin/subscriptions/${encodeURIComponent(
          params.id,
        )}/deliveries/${encodeURIComponent(delivery.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: next,
            ...(delivery.status ? { expected_status: delivery.status } : {}),
          }),
        },
      );
      await load();
    } catch (e) {
      setDeliveries(prev);
      alert(
        e instanceof AdminFetchError ? e.message : "Delivery update failed.",
      );
    } finally {
      setDeliveryBusyId(null);
    }
  };

  const backLink = (
    <Link href="/admin/subscriptions" style={chipNeutral} className="no-print">
      ← Back to subscriptions
    </Link>
  );

  if (loading) {
    return (
      <AdminShell title="Subscription" actions={backLink}>
        <Placeholder>Loading subscription…</Placeholder>
      </AdminShell>
    );
  }

  if (missing) {
    return (
      <AdminShell title="Subscription not found" actions={backLink}>
        <Placeholder>
          No subscription matches this id. It may have been deleted, or the
          link is stale.
        </Placeholder>
      </AdminShell>
    );
  }

  if (error || !sub) {
    return (
      <AdminShell title="Subscription" actions={backLink}>
        <Placeholder>
          Could not load subscription: {error ?? "unknown error"}
        </Placeholder>
      </AdminShell>
    );
  }

  // The customer row is the source of truth when the subscription is
  // linked to one; the customer_* columns are the signup-time snapshot
  // and are all legacy rows have.
  const name = sub.customer?.full_name ?? sub.customer_name ?? null;
  const phone = sub.customer?.phone ?? sub.customer_phone ?? null;

  const addr = sub.delivery_address ?? null;
  const addressLines = [addr?.line1, addr?.line2].filter(Boolean) as string[];
  const addressFallback = sub.customer_address ?? null;
  const city = addr?.city ?? sub.customer_city ?? null;
  const pincode = addr?.pincode ?? sub.customer_pincode ?? null;

  // What the customer actually picked. A plan can run on several days a
  // week, each with its own slot — `days` + `slots_by_day` carry that,
  // while day_of_week/time_slot only hold the first pair.
  const days = Array.isArray(sub.days) && sub.days.length > 0
    ? sub.days
    : sub.day_of_week
      ? [sub.day_of_week]
      : [];
  const slotFor = (day: string): string | null =>
    sub.slots_by_day?.[day] ?? sub.slot ?? sub.time_slot ?? null;

  const unitPrice = num(sub.bread_price);

  // Normalised address (jsonb → flat fallback), the plan sentence, and a
  // coord-aware Maps link. Coords come matched from the customer's saved
  // addresses (GET route); none → an address-text search.
  const resolvedAddr = resolveSubscriptionAddress(sub);
  const planSentence = describeSubscriptionPlan(sub, deliveries.length);
  const accountPhone = sub.customer?.phone ?? null;
  const showBothPhones = phonesDiffer(resolvedAddr.phone, accountPhone);
  const hasCoords =
    typeof sub.latitude === "number" &&
    typeof sub.longitude === "number" &&
    Number.isFinite(sub.latitude) &&
    Number.isFinite(sub.longitude) &&
    !(sub.latitude === 0 && sub.longitude === 0);
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps?q=${sub.latitude},${sub.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        formatAddressFull(resolvedAddr),
      )}`;
  const nextDelivery =
    deliveries.find(
      (d) => d.status !== "delivered" && d.status !== "cancelled",
    ) ?? null;
  const shareMessage = composeSubscriptionShareMessage(sub, {
    deliveryCount: deliveries.length,
    nextDeliveryDate: nextDelivery?.scheduled_date ?? nextDelivery?.delivery_date ?? null,
    nextDeliverySlot: nextDelivery?.scheduled_time_slot ?? nextDelivery?.slot ?? null,
  });

  const timeline: { label: string; at: string | null | undefined }[] = [
    { label: "Subscription created", at: sub.created_at },
    { label: "Last updated", at: sub.updated_at },
  ].filter((e) => Boolean(e.at));

  return (
    <AdminShell
      // The product name is the heading inside the HEADER block below —
      // keeping the shell title generic avoids printing it twice.
      title="Subscription"
      actions={
        <>
          <span className="no-print">
            <PartnerShareButton
              message={shareMessage}
              partners={partners}
              partnersLoading={partnersLoading}
              partnersError={partnersError}
              buttonStyle={chipNeutral}
            />
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            style={chipPrimary}
            className="no-print"
          >
            Print
          </button>
          {backLink}
        </>
      }
    >
      <div id="subscription-detail" style={{ display: "grid", gap: "1.25rem" }}>
        {/* 1 · HEADER ------------------------------------------------- */}
        <section style={panel}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={headingLine}>
                {show(sub.product_name)} × {show(sub.quantity_per_delivery)}
              </div>
              <div style={mutedLine}>
                Started {formatDateTime(sub.created_at)}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
                alignItems: "center",
              }}
            >
              <StatusBadge status={sub.status} />
              <StatusBadge status={sub.payment_status} />
              {sub.is_preorder ? (
                <span style={preorderChip}>Pre-order</span>
              ) : null}
            </div>
          </div>
        </section>

        {/* 2 · CUSTOMER ----------------------------------------------- */}
        <Block title="Customer">
          <div style={rowWrap}>
            <span style={keyStyle}>Name</span>
            <span style={valStyle}>
              {sub.customer_id ? (
                <Link
                  href={`/admin/customers/${sub.customer_id}`}
                  style={inlineLink}
                >
                  {show(name)}
                </Link>
              ) : (
                show(name)
              )}
            </span>
          </div>
          <div style={rowWrap}>
            <span style={keyStyle}>Phone</span>
            <span style={valStyle}>
              {phone ? (
                <span className="inline-flex items-center gap-2 flex-wrap">
                  <span>{phone}</span>
                  <ContactActions
                    phone={phone}
                    customerName={name}
                    orderInfo={`${sub.product_name} subscription`}
                  />
                </span>
              ) : (
                DASH
              )}
            </span>
          </div>
          <KeyVal k="Email" v={show(sub.customer?.email)} />
          <KeyVal k="City" v={show(sub.customer?.city ?? city)} />
        </Block>

        {/* 3 · PLAN — what the customer signed up for ------------------ */}
        <Block title="Plan">
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              color: "#FBF3D4",
              paddingBottom: "0.55rem",
              marginBottom: "0.35rem",
              borderBottom: "1px solid rgba(251,243,212,0.18)",
            }}
          >
            {planSentence}
          </div>
          <KeyVal k="Product" v={show(sub.product_name)} />
          <KeyVal k="Product slug" v={show(sub.product_slug)} />
          <KeyVal
            k="Loaves per delivery"
            v={show(sub.quantity_per_delivery)}
          />
          <KeyVal k="Frequency" v={humanise(sub.frequency)} />
          <div style={rowWrap}>
            <span style={keyStyle}>Delivery days</span>
            <span style={valStyle}>
              {days.length === 0
                ? DASH
                : days.map((d) => {
                    const slot = slotFor(d);
                    return (
                      <div key={d}>
                        {dayLabel(d)}
                        {slot ? (
                          <span style={{ color: "rgba(251,243,212,0.55)" }}>
                            {" · "}
                            {slot}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
            </span>
          </div>
          <KeyVal k="Slot mode" v={humanise(sub.slot_mode)} />
          <KeyVal k="Weeks" v={show(sub.total_weeks)} />
          <KeyVal k="Start date" v={formatDate(sub.start_date)} />
          <KeyVal k="End date (derived)" v={formatDate(sub.derived_end_date)} />
          <KeyVal
            k="Deliveries remaining"
            v={`${sub.remaining_deliveries ?? 0} of ${deliveries.length}`}
          />
        </Block>

        {/* 4 · DELIVERY ADDRESS --------------------------------------- */}
        <Block title="Delivery address">
          <KeyVal k="Recipient" v={show(addr?.name ?? name)} />
          {/* The address's own phone can differ from the account's — show
              both, labelled, when they do; otherwise one "Contact" row. */}
          {showBothPhones ? (
            <>
              <KeyVal k="Delivery phone" v={show(resolvedAddr.phone)} />
              <KeyVal k="Account phone" v={show(accountPhone)} />
            </>
          ) : (
            <KeyVal k="Contact" v={show(addr?.phone ?? phone)} />
          )}
          <KeyVal
            k="Address"
            v={
              addressLines.length > 0
                ? addressLines.join(", ")
                : show(addressFallback)
            }
          />
          <KeyVal k="City" v={show(city)} />
          <div style={rowWrap}>
            <span style={keyStyle}>Pincode</span>
            <span style={valStyle}>
              {pincode ? (
                show(pincode)
              ) : (
                <span style={{ color: "#EF4444" }}>
                  {DASH} · incomplete address
                </span>
              )}
            </span>
          </div>
          {/* No coords AND no address text would search Maps for "—". */}
          {hasCoords || resolvedAddr.hasAny ? (
            <div style={{ ...rowWrap }} className="no-print">
              <span style={keyStyle}>Map</span>
              <span style={valStyle}>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={inlineLink}
                >
                  {hasCoords
                    ? "Open pinned location"
                    : "Search address in Maps"}
                </a>
              </span>
            </div>
          ) : null}
        </Block>

        {/* 5 · DELIVERY SCHEDULE -------------------------------------- */}
        <section style={panel}>
          <h3 style={blockHeading}>Deliveries · {deliveries.length}</h3>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={tableHeadRow}>
                  <th style={{ ...th, width: 56 }}>#</th>
                  <th style={{ ...th, width: 76 }}>Week</th>
                  <th style={th}>Date</th>
                  <th style={th}>Slot</th>
                  <th style={th}>Status</th>
                  <th style={th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.length === 0 ? (
                  <tr>
                    <td style={td} colSpan={6}>
                      No deliveries scheduled.
                    </td>
                  </tr>
                ) : (
                  deliveries.map((d, i) => (
                    <tr key={d.id}>
                      <td style={td}>{d.sequence ?? i + 1}</td>
                      <td style={td}>{show(d.week_number)}</td>
                      <td style={td}>
                        {formatDate(d.scheduled_date ?? d.delivery_date)}
                        {d.day_key ? (
                          <div style={subtleCell}>{dayLabel(d.day_key)}</div>
                        ) : null}
                      </td>
                      <td style={td}>
                        {show(d.scheduled_time_slot ?? d.slot)}
                      </td>
                      <td style={td}>
                        <div className="no-print">
                          <Select
                            value={d.status ?? ""}
                            disabled={deliveryBusyId === d.id}
                            onChange={(v) => void updateDeliveryStatus(d, v)}
                            ariaLabel={`Delivery ${
                              d.sequence ?? i + 1
                            } status`}
                            style={deliverySelect}
                            options={DELIVERY_STATUS_OPTIONS.map((opt) => ({
                              value: opt,
                              label: DELIVERY_STATUS_LABELS[opt] ?? opt,
                            }))}
                          />
                        </div>
                        {/* Print keeps the badge — a paper copy shouldn't
                            render an empty control. */}
                        <span className="print-only">
                          <StatusBadge status={d.status} />
                        </span>
                        {d.status_updated_at ? (
                          <div style={subtleCell}>
                            {formatDateTime(d.status_updated_at)}
                          </div>
                        ) : null}
                      </td>
                      <td style={td}>{show(d.admin_notes)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p style={scheduleNote}>
            Changing a delivery here affects only that delivery — the
            subscription is untouched. The exception is the last open one:
            once every delivery is Delivered or Cancelled, an Active
            subscription is marked Completed.
          </p>
        </section>

        {/* 6 · PAYMENT ------------------------------------------------- */}
        <Block title="Payment">
          <KeyVal
            k="Method"
            v={
              sub.payment_method === "cod"
                ? "COD"
                : humanise(sub.payment_method)
            }
          />
          <KeyVal k="Status" v={humanise(sub.payment_status)} />
          <KeyVal
            k="Price per loaf"
            v={unitPrice === null ? DASH : formatINR(unitPrice)}
          />
          {/* Deliberately no derived per-delivery / per-week subtotal:
              total_amount is the stored source of truth and some legacy
              rows don't equal bread_price × qty × days × weeks. */}
          <div style={{ ...rowWrap, ...grandRow }}>
            <span style={keyStyle}>Subscription total</span>
            <span style={valStyle}>{formatINR(num(sub.total_amount))}</span>
          </div>
        </Block>

        {/* 7 · TIMELINE ------------------------------------------------ */}
        <Block title="Timeline">
          {timeline.length === 0 ? (
            <div style={mutedLine}>No timestamps recorded.</div>
          ) : (
            timeline.map((e) => (
              <KeyVal
                key={e.label}
                k={e.label}
                v={formatDateTime(e.at ?? null)}
              />
            ))
          )}
          <KeyVal k="Subscription id" v={sub.id} />
        </Block>
      </div>

      {/* Print stylesheet — drop the admin chrome and flip the dark theme
          to black-on-white. Same rules as the order detail page. */}
      <style jsx global>{`
        .print-only {
          display: none;
        }
        @media print {
          @page {
            margin: 12mm;
          }
          .print-only {
            display: inline !important;
          }
          .no-print,
          header,
          aside,
          [aria-hidden="true"],
          body > button,
          body > audio {
            display: none !important;
          }
          html,
          body,
          main {
            background: #FBF3D4 !important;
          }
          main > div > section {
            padding: 0 !important;
          }
          main,
          main * {
            color: #1D1D1F !important;
            background: transparent !important;
            box-shadow: none !important;
          }
          #subscription-detail section,
          #subscription-detail table,
          #subscription-detail th,
          #subscription-detail td,
          #subscription-detail [data-panel] {
            border-color: rgba(29,29,31,0.35) !important;
          }
        }
      `}</style>
    </AdminShell>
  );
}

// ── local presentational pieces ───────────────────────────────────────────

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={panel} data-panel>
      <h3 style={blockHeading}>{title}</h3>
      <div style={{ display: "grid", gap: "0.55rem" }}>{children}</div>
    </section>
  );
}

function KeyVal({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={rowWrap}>
      <span style={keyStyle}>{k}</span>
      <span style={valStyle}>{v}</span>
    </div>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed rgba(251,243,212,0.2)",
        borderRadius: 6,
        padding: "2rem 1rem",
        textAlign: "center",
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
        color: "rgba(251,243,212,0.55)",
      }}
    >
      {children}
    </div>
  );
}

// ── styles (mirrors /admin/orders/[id] — nothing new invented) ────────────

const panel: React.CSSProperties = {
  border: "1px solid rgba(251,243,212,0.18)",
  borderRadius: 6,
  padding: "1rem 1.1rem",
};

const blockHeading: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.25em",
  textTransform: "uppercase",
  color: "rgba(251,243,212,0.9)",
  margin: "0 0 0.85rem",
};

const headingLine: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontWeight: 300,
  fontSize: "clamp(1.4rem, 4.5vw, 2rem)",
  letterSpacing: "0.08em",
  color: "#FBF3D4",
  lineHeight: 1.15,
};

const mutedLine: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  color: "rgba(251,243,212,0.55)",
  marginTop: "0.3rem",
};

const rowWrap: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "1.5rem",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
};

const grandRow: React.CSSProperties = {
  borderTop: "1px solid rgba(251,243,212,0.35)",
  marginTop: "0.35rem",
  paddingTop: "0.5rem",
};

const keyStyle: React.CSSProperties = {
  color: "rgba(251,243,212,0.55)",
  whiteSpace: "nowrap",
};

const valStyle: React.CSSProperties = {
  color: "#FBF3D4",
  textAlign: "right",
  wordBreak: "break-word",
  minWidth: 0,
};

const inlineLink: React.CSSProperties = {
  color: "#FBF3D4",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
};

const tableWrap: React.CSSProperties = {
  border: "1px solid rgba(251,243,212,0.18)",
  borderRadius: 6,
  overflowX: "auto",
};

const tableHeadRow: React.CSSProperties = {
  background: "rgba(251,243,212,0.08)",
  color: "rgba(251,243,212,0.9)",
  textTransform: "uppercase",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  borderBottom: "1px solid rgba(251,243,212,0.15)",
};

const td: React.CSSProperties = {
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  color: "#FBF3D4",
  fontSize: "1rem",
  verticalAlign: "top",
  borderBottom: "1px solid rgba(251,243,212,0.06)",
};

const subtleCell: React.CSSProperties = {
  color: "rgba(251,243,212,0.5)",
  fontSize: "0.875rem",
  marginTop: "0.2rem",
};

// Metrics for the shared ui/Select. Its Foundation-Green skin is already
// repainted INK — trigger AND open menu — by the scoped rules in
// src/app/admin/layout.tsx, so nothing here fights the colour; this only
// sets the compact table sizing and type. 0.875rem = 14px, the floor.
const deliverySelect: React.CSSProperties = {
  background: "rgba(29,29,31,0.4)",
  color: "#FBF3D4",
  border: "1px solid rgba(251,243,212,0.4)",
  padding: "5px 10px",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  cursor: "pointer",
  minHeight: 0,
  borderRadius: 6,
  minWidth: 170,
};

const scheduleNote: React.CSSProperties = {
  marginTop: "0.9rem",
  marginBottom: 0,
  color: "rgba(251,243,212,0.5)",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  lineHeight: 1.6,
};

const chipBase: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  border: "1px solid rgba(251,243,212,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  background: "transparent",
  cursor: "pointer",
  textTransform: "uppercase",
  textDecoration: "none",
  display: "inline-block",
};

const chipPrimary: React.CSSProperties = {
  ...chipBase,
  color: "#FBF3D4",
  borderColor: "rgba(251,243,212,0.55)",
};

const chipNeutral: React.CSSProperties = {
  ...chipBase,
  color: "rgba(251,243,212,0.85)",
};

const preorderChip: React.CSSProperties = {
  ...chipBase,
  cursor: "default",
  fontSize: "1rem",
  padding: "0.3rem 0.7rem",
  color: "#FBF3D4",
};
