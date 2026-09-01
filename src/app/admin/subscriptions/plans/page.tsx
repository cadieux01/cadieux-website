"use client";

// Subscription plan catalogue. Manages the products that appear in the
// /subscriptions/setup wizard. Backed by the products table — same row
// admins edit at /admin/products/[id], surfaced here with only the
// plan-related fields (title, blurb, per-loaf price, on/off) plus
// activation toggles so the operator can flip the wizard list without
// leaving this page.
//
// Mutates via PATCH /api/admin/products/[id] (PIN-gated + audited just
// like the editor). On any save the /api/subscription-plans cache is
// busted server-side, so the wizard reflects the change inside 60s.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { usePinGate } from "@/components/admin/PinGateModal";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatINR } from "@/lib/admin-formatting";
import { AdminProductRow } from "@/lib/admin-shared";

const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.18)";

type PlanEdits = {
  subscription_title: string;
  subscription_blurb: string;
  subscription_per_loaf_inr: string;
};

export default function AdminSubscriptionPlansPage() {
  const [rows, setRows] = useState<AdminProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-row edit buffer. Keyed by product id; only populated while the
  // operator is actively editing a row so untouched rows stay in sync
  // with the server snapshot.
  const [edits, setEdits] = useState<Record<string, PlanEdits>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { requirePin, modal: pinModal } = usePinGate();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      // Include archived so the operator can re-flag a plan that was
      // archived without leaving this page; we render them dimmed.
      const res = await adminFetch<{ products: AdminProductRow[] }>(
        "/api/admin/products?include_archived=1",
      );
      setRows(res.products ?? []);
    } catch (e) {
      const msg =
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
          ? e.message
          : "Failed to load products";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live plans (toggle on, not archived) — these are what currently
  // power the wizard. Plus a "catalogue" list of everything else so the
  // admin can promote a product into a plan from this page.
  const { plans, catalogue } = useMemo(() => {
    const plans: AdminProductRow[] = [];
    const catalogue: AdminProductRow[] = [];
    for (const r of rows) {
      if (r.is_subscription_plan && !r.is_archived) plans.push(r);
      else catalogue.push(r);
    }
    return { plans, catalogue };
  }, [rows]);

  function startEdit(row: AdminProductRow) {
    setEdits((m) => ({
      ...m,
      [row.id]: {
        subscription_title: row.subscription_title ?? "",
        subscription_blurb: row.subscription_blurb ?? "",
        subscription_per_loaf_inr:
          row.subscription_per_loaf_inr === null
            ? ""
            : String(row.subscription_per_loaf_inr),
      },
    }));
  }

  function cancelEdit(id: string) {
    setEdits((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  }

  function patchEdit(id: string, p: Partial<PlanEdits>) {
    setEdits((m) => ({
      ...m,
      [id]: { ...(m[id] ?? blankEdits()), ...p },
    }));
  }

  async function patchProduct(
    id: string,
    payload: Record<string, unknown>,
    okMsg: string,
  ) {
    const grant = await requirePin();
    if (!grant) return; // operator cancelled
    setBusyId(id);
    try {
      await adminFetch(`/api/admin/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
        headers: { "x-pin-grant": grant },
      });
      await load();
      cancelEdit(id);
      showToast(okMsg);
    } catch (e) {
      const msg =
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
          ? e.message
          : "Save failed";
      setError(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdits(row: AdminProductRow) {
    const e = edits[row.id];
    if (!e) return;
    const payload: Record<string, unknown> = {
      subscription_title: e.subscription_title.trim() || null,
      subscription_blurb: e.subscription_blurb.trim() || null,
    };
    const priceStr = e.subscription_per_loaf_inr.trim();
    if (priceStr === "") {
      payload.subscription_per_loaf_inr = null;
    } else {
      const n = Number(priceStr);
      if (!Number.isFinite(n) || n < 0) {
        setError("Per-loaf price must be a non-negative number.");
        return;
      }
      payload.subscription_per_loaf_inr = Math.round(n);
    }
    await patchProduct(row.id, payload, `Updated "${row.name}" plan details`);
  }

  async function togglePlanFlag(row: AdminProductRow, next: boolean) {
    await patchProduct(
      row.id,
      { is_subscription_plan: next },
      next
        ? `"${row.name}" added to subscription plans`
        : `"${row.name}" removed from subscription plans`,
    );
  }

  async function toggleActive(row: AdminProductRow, next: boolean) {
    await patchProduct(
      row.id,
      { is_active: next },
      next ? `"${row.name}" activated` : `"${row.name}" deactivated`,
    );
  }

  return (
    <AdminShell
      title="Subscription Plans"
      subtitle={`${plans.length} live in wizard`}
      actions={
        <>
          <Link
            href="/admin/products"
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.25em",
              color: FADED,
              border: `1px solid ${BORDER}`,
              padding: "0.45rem 0.9rem",
            }}
          >
            All products →
          </Link>
        </>
      }
    >
      {error ? (
        <div
          className="p-3 mb-6"
          style={{
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p style={{ color: FADED, fontFamily: "var(--font-body)" }}>Loading…</p>
      ) : (
        <div className="flex flex-col gap-10">
          <section>
            <SectionHeader
              label="Live plans"
              hint="These products appear in the /subscriptions/setup wizard at their per-loaf price below."
            />
            {plans.length === 0 ? (
              <EmptyState message="No active plans. Promote a product from Catalogue below to make it bookable as a subscription." />
            ) : (
              <ul className="flex flex-col gap-4">
                {plans.map((row) => (
                  <PlanRow
                    key={row.id}
                    row={row}
                    edits={edits[row.id]}
                    busy={busyId === row.id}
                    onStartEdit={() => startEdit(row)}
                    onCancelEdit={() => cancelEdit(row.id)}
                    onChangeEdit={(p) => patchEdit(row.id, p)}
                    onSave={() => void saveEdits(row)}
                    onTogglePlan={(v) => void togglePlanFlag(row, v)}
                    onToggleActive={(v) => void toggleActive(row, v)}
                  />
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeader
              label="Catalogue"
              hint="Promote any product into the wizard. Archived products are dimmed and must be unarchived first."
            />
            {catalogue.length === 0 ? (
              <EmptyState message="Every product is already configured." />
            ) : (
              <ul className="flex flex-col gap-3">
                {catalogue.map((row) => (
                  <CataloguePromoteRow
                    key={row.id}
                    row={row}
                    busy={busyId === row.id}
                    onPromote={() => void togglePlanFlag(row, true)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {pinModal}

      {toast ? (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: "1.5rem",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 410,
            background: "#1D1D1F",
            color: "#FBF3D4",
            border: "1px solid rgba(251,243,212,0.3)",
            padding: "0.7rem 1.2rem",
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.08em",
            boxShadow: "0 16px 40px -12px rgba(29,29,31,0.6)",
          }}
        >
          ✓ {toast}
        </div>
      ) : null}
    </AdminShell>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────

function blankEdits(): PlanEdits {
  return {
    subscription_title: "",
    subscription_blurb: "",
    subscription_per_loaf_inr: "",
  };
}

function SectionHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="mb-4">
      <h2
        className="uppercase"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          letterSpacing: "0.3em",
          color: CREAM,
        }}
      >
        {label}
      </h2>
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
          color: FADED,
          marginTop: "0.4rem",
          maxWidth: 560,
        }}
      >
        {hint}
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p
      className="p-4"
      style={{
        border: `1px dashed ${BORDER}`,
        color: FADED,
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
      }}
    >
      {message}
    </p>
  );
}

function PlanRow({
  row,
  edits,
  busy,
  onStartEdit,
  onCancelEdit,
  onChangeEdit,
  onSave,
  onTogglePlan,
  onToggleActive,
}: {
  row: AdminProductRow;
  edits: PlanEdits | undefined;
  busy: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeEdit: (p: Partial<PlanEdits>) => void;
  onSave: () => void;
  onTogglePlan: (next: boolean) => void;
  onToggleActive: (next: boolean) => void;
}) {
  const editing = !!edits;
  const livePrice = row.subscription_per_loaf_inr ?? row.price_inr;
  return (
    <li
      className="p-4 flex flex-col gap-3"
      style={{
        border: `1px solid ${BORDER}`,
        background: row.is_active
          ? "rgba(251,243,212,0.04)"
          : "rgba(251,243,212,0.04)",
        opacity: row.is_active ? 1 : 0.7,
      }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "1.3rem",
              color: CREAM,
            }}
          >
            {row.name}
          </div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              color: FADED,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              marginTop: 2,
            }}
          >
            slug: {row.slug}
            {!row.is_active ? " · inactive" : null}
            {!row.in_stock ? " · out of stock" : null}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href={`/admin/products/${row.id}`}
            className="uppercase"
            style={chipBtn(FADED)}
          >
            Open in editor
          </Link>
          <button
            type="button"
            onClick={() => onToggleActive(!row.is_active)}
            disabled={busy}
            className="uppercase"
            style={chipBtn(row.is_active ? "#EF4444" : CREAM, busy)}
          >
            {row.is_active ? "🔒 Deactivate" : "🔒 Activate"}
          </button>
          <button
            type="button"
            onClick={() => onTogglePlan(false)}
            disabled={busy}
            className="uppercase"
            style={chipBtn("#EF4444", busy)}
          >
            🔒 Remove from plans
          </button>
        </div>
      </div>

      {editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <LabeledInput
            label="Wizard title"
            value={edits!.subscription_title}
            placeholder="Multigrain"
            onChange={(v) => onChangeEdit({ subscription_title: v })}
          />
          <LabeledInput
            label="Per-loaf ₹"
            type="number"
            min={0}
            step={1}
            value={edits!.subscription_per_loaf_inr}
            placeholder={String(row.price_inr)}
            onChange={(v) => onChangeEdit({ subscription_per_loaf_inr: v })}
          />
          <LabeledInput
            label="Wizard blurb"
            value={edits!.subscription_blurb}
            placeholder="Ancient grains, seeds, whey protein."
            onChange={(v) => onChangeEdit({ subscription_blurb: v })}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <DisplayField
            label="Wizard title"
            value={row.subscription_title ?? "(uses product name)"}
            muted={!row.subscription_title}
          />
          <DisplayField
            label="Per-loaf ₹"
            value={formatINR(livePrice)}
            muted={row.subscription_per_loaf_inr === null}
            hint={
              row.subscription_per_loaf_inr === null
                ? "Falling back to one-time price"
                : undefined
            }
          />
          <DisplayField
            label="Wizard blurb"
            value={row.subscription_blurb ?? "(empty)"}
            muted={!row.subscription_blurb}
          />
        </div>
      )}

      <div className="flex gap-2 flex-wrap pt-1">
        {editing ? (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="uppercase"
              style={chipBtn(CREAM, busy)}
            >
              {busy ? "Saving…" : "🔒 Save"}
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={busy}
              className="uppercase"
              style={chipBtn(FADED, busy)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onStartEdit}
            disabled={busy}
            className="uppercase"
            style={chipBtn(CREAM, busy)}
          >
            Edit plan details
          </button>
        )}
      </div>
    </li>
  );
}

function CataloguePromoteRow({
  row,
  busy,
  onPromote,
}: {
  row: AdminProductRow;
  busy: boolean;
  onPromote: () => void;
}) {
  const canPromote = !row.is_archived;
  return (
    <li
      className="p-3 flex items-center justify-between gap-4"
      style={{
        border: `1px solid ${BORDER}`,
        opacity: row.is_archived ? 0.5 : 1,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            color: CREAM,
          }}
        >
          {row.name}
        </div>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            color: FADED,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            marginTop: 2,
          }}
        >
          slug: {row.slug}
          {row.is_archived ? " · archived" : ""}
          {!row.is_active && !row.is_archived ? " · inactive" : ""}
        </div>
      </div>
      <button
        type="button"
        disabled={!canPromote || busy}
        onClick={onPromote}
        className="uppercase"
        style={chipBtn(CREAM, !canPromote || busy)}
      >
        {busy ? "Working…" : "🔒 Add to plans"}
      </button>
    </li>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: number;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          letterSpacing: "0.22em",
          color: FADED,
        }}
      >
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        step={step}
        className="px-2 py-1.5 bg-transparent outline-none"
        style={{
          border: `1px solid ${BORDER}`,
          color: CREAM,
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
        }}
      />
    </label>
  );
}

function DisplayField({
  label,
  value,
  muted,
  hint,
}: {
  label: string;
  value: string;
  muted?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          letterSpacing: "0.22em",
          color: FADED,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
          color: muted ? FADED : CREAM,
          fontStyle: muted ? "italic" : "normal",
        }}
      >
        {value}
      </span>
      {hint ? (
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            color: FADED,
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function chipBtn(color: string, disabled = false): React.CSSProperties {
  return {
    fontFamily: "var(--font-body)",
    fontSize: "0.875rem",
    letterSpacing: "0.25em",
    color,
    border: `1px solid ${color}`,
    padding: "0.45rem 0.9rem",
    background: "transparent",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
