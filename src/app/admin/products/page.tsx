"use client";

// Admin product catalogue. Lists every product (with an optional toggle
// to include archived rows), shows stock + visibility flags at a
// glance, and links into the per-product editor. The "New product"
// button opens the create form.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDateTime, formatINR } from "@/lib/admin-formatting";
import { AdminProductRow } from "@/lib/admin-shared";

const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.18)";

export default function AdminProductsPage() {
  const [rows, setRows] = useState<AdminProductRow[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const qs = includeArchived ? "?include_archived=1" : "";
      const res = await adminFetch<{ products: AdminProductRow[] }>(
        `/api/admin/products${qs}`,
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
  }, [includeArchived]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const live = rows.filter((r) => !r.is_archived).length;
    const archived = rows.filter((r) => r.is_archived).length;
    return { live, archived };
  }, [rows]);

  return (
    <AdminShell
      title="Products"
      subtitle={`${counts.live} live${
        includeArchived ? ` · ${counts.archived} archived` : ""
      }`}
      actions={
        <>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.25em",
              color: CREAM,
              border: `1px solid ${CREAM}`,
              padding: "0.45rem 0.9rem",
              background: "transparent",
              cursor: refreshing ? "wait" : "pointer",
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => setIncludeArchived((v) => !v)}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.25em",
              color: includeArchived ? CREAM : FADED,
              border: `1px solid ${BORDER}`,
              padding: "0.45rem 0.9rem",
              background: "transparent",
            }}
          >
            {includeArchived ? "Hide archived" : "Show archived"}
          </button>
          <Link
            href="/admin/products/new"
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.25em",
              color: CREAM,
              border: `1px solid ${CREAM}`,
              padding: "0.45rem 0.9rem",
            }}
          >
            New product
          </Link>
        </>
      }
    >
      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      {loading ? (
        <p style={{ color: FADED, fontFamily: "var(--font-body)" }}>
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p style={{ color: FADED, fontFamily: "var(--font-body)" }}>
          No products yet. Create one with “New product”.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full"
            style={{
              borderCollapse: "collapse",
              fontFamily: "var(--font-body)",
              color: CREAM,
            }}
          >
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <Th>Image</Th>
                <Th>Name</Th>
                <Th>Slug</Th>
                <Th align="right">One-time</Th>
                <Th align="right">Per loaf (sub)</Th>
                <Th>Status</Th>
                <Th>Last updated</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: `1px solid ${BORDER}`,
                    opacity: r.is_archived ? 0.55 : 1,
                  }}
                >
                  <Td>
                    {r.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.image_url}
                        alt=""
                        style={{
                          width: 48,
                          height: 48,
                          objectFit: "cover",
                          border: `1px solid ${BORDER}`,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          border: `1px dashed ${BORDER}`,
                        }}
                      />
                    )}
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/products/${r.id}`}
                      style={{ color: CREAM, textDecoration: "underline" }}
                    >
                      {r.name}
                    </Link>
                  </Td>
                  <Td>
                    <code style={{ color: FADED, fontSize: "1rem" }}>
                      {r.slug}
                    </code>
                  </Td>
                  <Td align="right">{formatINR(r.price_inr)}</Td>
                  <Td align="right">
                    {r.subscription_per_loaf_inr === null
                      ? "—"
                      : formatINR(r.subscription_per_loaf_inr)}
                  </Td>
                  <Td>
                    <StatusFlags row={r} />
                  </Td>
                  <Td>
                    <span style={{ color: FADED, fontSize: "1rem" }}>
                      {formatDateTime(r.updated_at)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

function StatusFlags({ row }: { row: AdminProductRow }) {
  const tags: { label: string; color: string }[] = [];
  if (row.is_archived) tags.push({ label: "Archived", color: "rgba(251,243,212,0.7)" });
  if (!row.is_active) tags.push({ label: "Hidden", color: "rgba(251,243,212,0.7)" });
  if (row.is_active && !row.is_archived) tags.push({ label: "Live", color: CREAM });
  if (!row.in_stock) tags.push({ label: "Out of stock", color: "#EF4444" });
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t.label}
          className="uppercase"
          style={{
            fontSize: "0.875rem",
            letterSpacing: "0.18em",
            color: t.color,
            border: `1px solid ${t.color}`,
            padding: "0.15rem 0.5rem",
          }}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className="uppercase"
      style={{
        textAlign: align,
        padding: "0.6rem 0.75rem",
        fontSize: "0.875rem",
        letterSpacing: "0.22em",
        color: FADED,
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "0.7rem 0.75rem",
        fontSize: "1rem",
      }}
    >
      {children}
    </td>
  );
}

function ErrorBox({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="mb-4 p-3"
      style={{
        border: "1px solid #EF4444",
        color: "#EF4444",
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
      }}
    >
      {message}{" "}
      <button
        type="button"
        onClick={onRetry}
        style={{
          marginLeft: 8,
          color: CREAM,
          textDecoration: "underline",
        }}
      >
        Retry
      </button>
    </div>
  );
}
