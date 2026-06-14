"use client";

// Lab Reports & Certifications panel for the admin product detail page.
// Loads, uploads, edits, archives, unarchives and deletes rows in the
// product_reports table via /api/admin/products/[id]/reports. File
// uploads use a raw fetch (not adminFetch) so the multipart Content-Type
// boundary is set by the browser.

import { useCallback, useEffect, useState } from "react";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDateTime } from "@/lib/admin-formatting";
import {
  PRODUCT_REPORT_CATEGORIES,
  PRODUCT_REPORT_CATEGORY_LABEL,
  ProductReport,
  ProductReportCategory,
} from "@/lib/product-reports";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

export function LabReportsSection({ productId }: { productId: string }) {
  const [reports, setReports] = useState<ProductReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Add-modal state
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addCategory, setAddCategory] = useState<ProductReportCategory>("other");
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  // Per-row busy + error
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await adminFetch<{ reports: ProductReport[] }>(
        `/api/admin/products/${productId}/reports`,
      );
      setReports(res.reports ?? []);
    } catch (e) {
      setLoadErr(
        e instanceof AdminFetchError ? e.message : "Failed to load reports",
      );
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitAdd() {
    if (!addFile) {
      setAddErr("Select a file");
      return;
    }
    if (!addTitle.trim()) {
      setAddErr("Title is required");
      return;
    }
    setAddBusy(true);
    setAddErr(null);
    try {
      const fd = new FormData();
      fd.append("file", addFile);
      fd.append("title", addTitle.trim());
      fd.append("category", addCategory);
      const res = await fetch(
        `/api/admin/products/${productId}/reports`,
        {
          method: "POST",
          credentials: "same-origin",
          body: fd,
        },
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? `Upload failed (${res.status})`);
      }
      setShowAdd(false);
      setAddTitle("");
      setAddCategory("other");
      setAddFile(null);
      await load();
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setAddBusy(false);
    }
  }

  async function patchRow(id: string, patch: Partial<ProductReport>) {
    setRowBusy(id);
    setRowErr(null);
    try {
      await adminFetch(`/api/admin/products/${productId}/reports/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await load();
    } catch (e) {
      setRowErr(
        e instanceof AdminFetchError ? e.message : "Update failed",
      );
    } finally {
      setRowBusy(null);
    }
  }

  async function archiveRow(id: string, archived: boolean) {
    setRowBusy(id);
    setRowErr(null);
    try {
      await adminFetch(
        `/api/admin/products/${productId}/reports/${id}/${
          archived ? "unarchive" : "archive"
        }`,
        { method: "POST" },
      );
      await load();
    } catch (e) {
      setRowErr(
        e instanceof AdminFetchError ? e.message : "Archive failed",
      );
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteRow(id: string, title: string) {
    if (
      !window.confirm(
        `Permanently delete "${title}"? The file will be removed from storage and cannot be undone.`,
      )
    ) {
      return;
    }
    setRowBusy(id);
    setRowErr(null);
    try {
      await adminFetch(`/api/admin/products/${productId}/reports/${id}`, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setRowErr(e instanceof AdminFetchError ? e.message : "Delete failed");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <h3
          className="uppercase"
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: "1.4rem",
            letterSpacing: "0.2em",
            color: CREAM,
          }}
        >
          Lab Reports &amp; Certifications
        </h3>
        <button
          type="button"
          onClick={() => {
            setShowAdd(true);
            setAddErr(null);
          }}
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.7rem",
            letterSpacing: "0.25em",
            color: GOLD,
            border: `1px solid ${GOLD}`,
            padding: "0.45rem 0.9rem",
            background: "transparent",
          }}
        >
          + Add Report
        </button>
      </div>

      {loadErr ? (
        <p style={{ color: "#fecaca", fontFamily: "var(--font-body)" }}>
          {loadErr}
        </p>
      ) : loading ? (
        <p style={{ color: FADED, fontFamily: "var(--font-body)" }}>
          Loading reports…
        </p>
      ) : reports.length === 0 ? (
        <p
          style={{
            color: FADED,
            fontFamily: "var(--font-body)",
            fontSize: "0.9rem",
          }}
        >
          No reports uploaded yet.
        </p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {reports.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              busy={rowBusy === r.id}
              onPatch={(p) => patchRow(r.id, p)}
              onArchive={() => archiveRow(r.id, r.is_archived)}
              onDelete={() => deleteRow(r.id, r.title)}
            />
          ))}
        </ul>
      )}

      {rowErr ? (
        <p
          className="mt-3"
          style={{ color: "#fecaca", fontFamily: "var(--font-body)" }}
        >
          {rowErr}
        </p>
      ) : null}

      {showAdd ? (
        <AddReportModal
          title={addTitle}
          onTitle={setAddTitle}
          category={addCategory}
          onCategory={setAddCategory}
          file={addFile}
          onFile={setAddFile}
          busy={addBusy}
          err={addErr}
          onCancel={() => setShowAdd(false)}
          onSubmit={submitAdd}
        />
      ) : null}
    </section>
  );
}

function ReportCard({
  report,
  busy,
  onPatch,
  onArchive,
  onDelete,
}: {
  report: ProductReport;
  busy: boolean;
  onPatch: (p: Partial<ProductReport>) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(report.title);
  const [category, setCategory] = useState<ProductReportCategory>(report.category);

  return (
    <li
      className="p-4"
      style={{
        border: `1px solid ${BORDER}`,
        background: "rgba(0,0,0,0.18)",
        opacity: report.is_archived ? 0.55 : 1,
      }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
        <span
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.62rem",
            letterSpacing: "0.25em",
            color: GOLD,
          }}
        >
          {PRODUCT_REPORT_CATEGORY_LABEL[report.category]}
          {report.is_archived ? " · Archived" : ""}
        </span>
        <span
          style={{
            color: FADED,
            fontFamily: "var(--font-body)",
            fontSize: "0.7rem",
          }}
        >
          {formatDateTime(report.uploaded_at)}
        </span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2"
            style={{
              border: `1px solid ${BORDER}`,
              background: "transparent",
              color: CREAM,
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
            }}
          />
          <select
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as ProductReportCategory)
            }
            className="w-full px-3 py-2"
            style={{
              border: `1px solid ${BORDER}`,
              background: "rgb(6,4,2)",
              color: CREAM,
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
            }}
          >
            {PRODUCT_REPORT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PRODUCT_REPORT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onPatch({ title: title.trim(), category });
                setEditing(false);
              }}
              disabled={busy || !title.trim()}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.65rem",
                letterSpacing: "0.25em",
                color: GOLD,
                border: `1px solid ${GOLD}`,
                padding: "0.35rem 0.7rem",
                background: "transparent",
                opacity: busy || !title.trim() ? 0.5 : 1,
              }}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setTitle(report.title);
                setCategory(report.category);
                setEditing(false);
              }}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.65rem",
                letterSpacing: "0.25em",
                color: FADED,
                border: `1px solid ${BORDER}`,
                padding: "0.35rem 0.7rem",
                background: "transparent",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              fontFamily: "var(--font-body)",
              color: CREAM,
              fontSize: "0.95rem",
              marginBottom: "0.35rem",
            }}
          >
            {report.title}
          </div>
          <a
            href={report.file_url}
            target="_blank"
            rel="noreferrer"
            className="block"
            style={{
              fontFamily: "var(--font-body)",
              color: GOLD,
              fontSize: "0.78rem",
              wordBreak: "break-all",
              textDecoration: "underline",
            }}
          >
            {report.file_name}
          </a>
          <div
            style={{
              fontFamily: "var(--font-body)",
              color: FADED,
              fontSize: "0.7rem",
              marginTop: "0.25rem",
            }}
          >
            {formatBytes(report.file_size_bytes)}
            {report.mime_type ? ` · ${report.mime_type}` : ""}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.62rem",
                letterSpacing: "0.25em",
                color: FADED,
                border: `1px solid ${BORDER}`,
                padding: "0.3rem 0.65rem",
                background: "transparent",
              }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onArchive}
              disabled={busy}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.62rem",
                letterSpacing: "0.25em",
                color: report.is_archived ? GOLD : FADED,
                border: `1px solid ${report.is_archived ? GOLD : BORDER}`,
                padding: "0.3rem 0.65rem",
                background: "transparent",
                opacity: busy ? 0.5 : 1,
              }}
            >
              {report.is_archived ? "Unarchive" : "Archive"}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.62rem",
                letterSpacing: "0.25em",
                color: "#ef4444",
                border: "1px solid #ef4444",
                padding: "0.3rem 0.65rem",
                background: "transparent",
                opacity: busy ? 0.5 : 1,
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function AddReportModal({
  title,
  onTitle,
  category,
  onCategory,
  file,
  onFile,
  busy,
  err,
  onCancel,
  onSubmit,
}: {
  title: string;
  onTitle: (s: string) => void;
  category: ProductReportCategory;
  onCategory: (c: ProductReportCategory) => void;
  file: File | null;
  onFile: (f: File | null) => void;
  busy: boolean;
  err: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md"
        style={{
          background: "rgb(6,4,2)",
          border: `1px solid ${BORDER}`,
          // 3-zone scrollable layout
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(90vh, calc(100dvh - 2rem))",
          minHeight: 0,
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            flexShrink: 0,
            padding: "1.25rem 1.5rem 1rem",
            background: "rgb(6,4,2)",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <h4
            className="uppercase"
            style={{
              margin: 0,
              fontFamily: "var(--font-heading)",
              color: CREAM,
              fontSize: "1.1rem",
              letterSpacing: "0.2em",
              fontWeight: 300,
            }}
          >
            Add Report
          </h4>
        </div>

        <div
          data-lenis-prevent
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "1rem 1.5rem",
          }}
        >
          <label
            className="block mb-3"
            style={{
              fontFamily: "var(--font-body)",
              color: FADED,
              fontSize: "0.7rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            Title
            <input
              value={title}
              onChange={(e) => onTitle(e.target.value)}
              placeholder="e.g. FSSAI License 2025"
              className="mt-1 w-full px-3 py-2"
              style={{
                border: `1px solid ${BORDER}`,
                background: "transparent",
                color: CREAM,
                fontFamily: "var(--font-body)",
                fontSize: "0.9rem",
                letterSpacing: "0.05em",
                textTransform: "none",
              }}
            />
          </label>

          <label
            className="block mb-3"
            style={{
              fontFamily: "var(--font-body)",
              color: FADED,
              fontSize: "0.7rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            Category
            <select
              value={category}
              onChange={(e) =>
                onCategory(e.target.value as ProductReportCategory)
              }
              className="mt-1 w-full px-3 py-2"
              style={{
                border: `1px solid ${BORDER}`,
                background: "rgb(6,4,2)",
                color: CREAM,
                fontFamily: "var(--font-body)",
                fontSize: "0.9rem",
                textTransform: "none",
                letterSpacing: "0.05em",
              }}
            >
              {PRODUCT_REPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PRODUCT_REPORT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>

          <label
            className="block mb-4"
            style={{
              fontFamily: "var(--font-body)",
              color: FADED,
              fontSize: "0.7rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            File (any type · max 10MB)
            <input
              type="file"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="mt-1 w-full"
              style={{
                color: CREAM,
                fontFamily: "var(--font-body)",
                fontSize: "0.85rem",
                textTransform: "none",
                letterSpacing: "0.02em",
              }}
            />
            {file ? (
              <span
                style={{
                  display: "block",
                  marginTop: "0.35rem",
                  color: CREAM,
                  fontSize: "0.8rem",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                {file.name} ({formatBytes(file.size)})
              </span>
            ) : null}
          </label>

          {err ? (
            <p
              style={{
                margin: 0,
                color: "#fecaca",
                fontFamily: "var(--font-body)",
                fontSize: "0.85rem",
              }}
            >
              {err}
            </p>
          ) : null}
        </div>

        <div
          style={{
            flexShrink: 0,
            padding: "1rem 1.5rem 1.25rem",
            background: "rgb(6,4,2)",
            borderTop: `1px solid ${BORDER}`,
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              color: FADED,
              border: `1px solid ${BORDER}`,
              padding: "0.45rem 0.9rem",
              background: "transparent",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              color: GOLD,
              border: `1px solid ${GOLD}`,
              padding: "0.45rem 0.9rem",
              background: "transparent",
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
