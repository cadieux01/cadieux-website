"use client";

// Per-product editor. PATCHes /api/admin/products/[id], offers
// archive/unarchive buttons, and renders the field-level change log
// returned by the same GET endpoint.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  APP_REPORTS_SPEC,
  ContentTableEditor,
  STAT_TILES_SPEC,
} from "@/components/admin/ContentTableEditor";
import { ContentStringsSection } from "@/components/admin/ContentStringsSection";
import { IngredientsSection } from "@/components/admin/IngredientsSection";
import { LabReportsSection } from "@/components/admin/LabReportsSection";
import {
  ProductForm,
  ProductFormValues,
  formValuesFromRow,
  valuesToPayload,
} from "@/components/admin/ProductForm";
import { usePinGate } from "@/components/admin/PinGateModal";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDateTime } from "@/lib/admin-formatting";
import {
  AdminProductChangeRow,
  AdminProductRow,
} from "@/lib/admin-shared";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

type EditorTab =
  | "details"
  | "strings"
  | "tiles"
  | "ingredients"
  | "app_reports"
  | "reports";

const TABS: { key: EditorTab; label: string }[] = [
  { key: "details", label: "Product Details" },
  { key: "strings", label: "Strings" },
  { key: "tiles", label: "Stat Tiles" },
  { key: "ingredients", label: "Ingredients" },
  { key: "app_reports", label: "Test Reports (App)" },
  { key: "reports", label: "Lab Reports" },
];

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [tab, setTab] = useState<EditorTab>("details");

  const [product, setProduct] = useState<AdminProductRow | null>(null);
  const [history, setHistory] = useState<AdminProductChangeRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // PIN gate — gates every change/delete to an existing product against the
  // single website_admin_pin (the same PIN /admin/profile manages).
  const { requirePin, modal: pinModal } = usePinGate();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await adminFetch<{
        product: AdminProductRow;
        history: AdminProductChangeRow[];
      }>(`/api/admin/products/${id}`);
      setProduct(res.product);
      setHistory(res.history ?? []);
    } catch (e) {
      const msg =
        e instanceof AdminFetchError ? e.message : "Failed to load product";
      setLoadErr(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(values: ProductFormValues) {
    if (!id || !product) return;
    setSaveErr(null);

    // Require the security PIN before any save touches the live catalogue.
    const grant = await requirePin();
    if (!grant) return; // operator cancelled

    setBusy(true);
    try {
      const payload = valuesToPayload(values);
      await adminFetch(`/api/admin/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
        headers: { "x-pin-grant": grant },
      });
      await load();
      showToast("Changes saved");
    } catch (e) {
      const msg =
        e instanceof AdminFetchError ? e.message : "Failed to save product";
      setSaveErr(msg);
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!id || !product) return;
    const action = product.is_archived ? "unarchive" : "archive";
    const verb = product.is_archived ? "Unarchive" : "Archive";

    // Archive/unarchive change live visibility — require the security PIN.
    const grant = await requirePin();
    if (!grant) return; // operator cancelled

    setArchiveBusy(true);
    setSaveErr(null);
    try {
      await adminFetch(`/api/admin/products/${id}/${action}`, {
        method: "POST",
        headers: { "x-pin-grant": grant },
      });
      await load();
      showToast(`Product ${product.is_archived ? "unarchived" : "archived"}`);
    } catch (e) {
      const msg =
        e instanceof AdminFetchError
          ? e.message
          : `Failed to ${action} product`;
      setSaveErr(msg);
    } finally {
      setArchiveBusy(false);
    }
  }

  if (!id) return null;

  return (
    <AdminShell
      title={product ? product.name : "Product"}
      subtitle={product ? `slug: ${product.slug}` : undefined}
      actions={
        product ? (
          <>
            <Link
              href="/admin/products"
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.7rem",
                letterSpacing: "0.25em",
                color: FADED,
                border: `1px solid ${BORDER}`,
                padding: "0.45rem 0.9rem",
              }}
            >
              ← All products
            </Link>
            <button
              type="button"
              onClick={toggleArchive}
              disabled={archiveBusy}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.7rem",
                letterSpacing: "0.25em",
                color: product.is_archived ? GOLD : "#ef4444",
                border: `1px solid ${
                  product.is_archived ? GOLD : "#ef4444"
                }`,
                padding: "0.45rem 0.9rem",
                background: "transparent",
                opacity: archiveBusy ? 0.5 : 1,
              }}
            >
              {archiveBusy
                ? "Working…"
                : product.is_archived
                ? "🔒 Unarchive"
                : "🔒 Archive"}
            </button>
          </>
        ) : (
          <Link
            href="/admin/products"
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              color: FADED,
              border: `1px solid ${BORDER}`,
              padding: "0.45rem 0.9rem",
            }}
          >
            ← All products
          </Link>
        )
      }
    >
      {loadErr ? (
        <p style={{ color: "#fecaca", fontFamily: "var(--font-body)" }}>
          {loadErr}
        </p>
      ) : loading || !product ? (
        <p style={{ color: FADED, fontFamily: "var(--font-body)" }}>Loading…</p>
      ) : (
        <>
          <div
            className="flex gap-1 mb-8 flex-wrap"
            style={{ borderBottom: `1px solid ${BORDER}` }}
          >
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className="uppercase"
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "0.72rem",
                    letterSpacing: "0.25em",
                    color: active ? CREAM : FADED,
                    background: "transparent",
                    border: "none",
                    borderBottom: `2px solid ${active ? GOLD : "transparent"}`,
                    padding: "0.6rem 1rem",
                    marginBottom: "-1px",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === "details" ? (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8">
              <ProductForm
                initial={formValuesFromRow(product)}
                submitLabel="🔒 Save changes"
                onSubmit={submit}
                busy={busy}
                error={saveErr}
              />
              <HistoryPanel history={history} />
            </div>
          ) : null}

          {tab === "strings" ? (
            <ContentStringsSection
              locale="en"
              productId={product.id}
              requirePin={requirePin}
              title="Per-product strings"
              subtitle="Strings scoped to this product (PDP name, tag, description, SEO, etc.)"
            />
          ) : null}

          {tab === "tiles" ? (
            <ContentTableEditor
              spec={STAT_TILES_SPEC}
              productId={product.id}
              locale="en"
              requirePin={requirePin}
              title="Stat tiles"
              subtitle="Small value/label tiles shown above the fold on the PDP."
            />
          ) : null}

          {tab === "ingredients" ? (
            <IngredientsSection productId={product.id} requirePin={requirePin} />
          ) : null}

          {tab === "app_reports" ? (
            <ContentTableEditor
              spec={APP_REPORTS_SPEC}
              productId={product.id}
              locale="en"
              requirePin={requirePin}
              title="Test reports (app)"
              subtitle="Mobile-app test-report tiles (metric + value + optional note)."
            />
          ) : null}

          {tab === "reports" ? (
            <LabReportsSection productId={product.id} requirePin={requirePin} />
          ) : null}
        </>
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
            background: "#024628",
            color: "#fbf3d4",
            border: "1px solid rgba(251,243,212,0.3)",
            padding: "0.7rem 1.2rem",
            fontFamily: "var(--font-body)",
            fontSize: "0.8rem",
            letterSpacing: "0.08em",
            boxShadow: "0 16px 40px -12px rgba(0,0,0,0.6)",
          }}
        >
          ✓ {toast}
        </div>
      ) : null}
    </AdminShell>
  );
}

function HistoryPanel({ history }: { history: AdminProductChangeRow[] }) {
  return (
    <aside>
      <h3
        className="uppercase mb-3"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.72rem",
          letterSpacing: "0.25em",
          color: FADED,
        }}
      >
        Change history
      </h3>
      {history.length === 0 ? (
        <p
          style={{
            color: FADED,
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
          }}
        >
          No changes recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {history.map((h) => (
            <li
              key={h.id}
              className="p-3"
              style={{
                border: `1px solid ${BORDER}`,
                fontFamily: "var(--font-body)",
                fontSize: "0.82rem",
                color: CREAM,
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span style={{ color: GOLD }}>{h.field_changed}</span>
                <span style={{ color: FADED, fontSize: "0.72rem" }}>
                  {formatDateTime(h.changed_at)}
                </span>
              </div>
              <div className="mt-1" style={{ color: FADED }}>
                {h.context ?? "update"}
              </div>
              <div className="mt-2 grid grid-cols-[60px_1fr] gap-x-3 gap-y-1">
                <span style={{ color: FADED }}>from</span>
                <code style={{ wordBreak: "break-word" }}>
                  {renderValue(h.old_value)}
                </code>
                <span style={{ color: FADED }}>to</span>
                <code style={{ wordBreak: "break-word" }}>
                  {renderValue(h.new_value)}
                </code>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length === 0 ? "(empty)" : v;
  return JSON.stringify(v);
}
