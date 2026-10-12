"use client";

// Lab Reports & Certifications panel for the admin product detail page.
// Loads, uploads, edits, archives, unarchives and deletes rows in the
// product_reports table via /api/admin/products/[id]/reports. The file
// itself does not travel through that route: it goes straight to storage
// with a signed upload URL (see lib/admin-upload.ts) because a Vercel
// function request body is capped at ~4.5 MB at the edge, well under the
// 50 MiB storage accepts. Every mutation is gated by the security
// PIN — requirePin() is owned by the parent page and passed down; the
// returned grant rides as the `x-pin-grant` header, on the signed-URL
// request as well as on the metadata POST.
//
// UPLOADS ARE A BATCH, AND A BATCH IS NOT ALL-OR-NOTHING. Pick several
// files at once, give each its own label, and each one uploads and
// registers independently: the ones that land are kept and the ones that
// fail stay in the modal with their own reason, so a single bad file does
// not cost the operator the other nine.

import { useCallback, useEffect, useState } from "react";

import Select from "@/components/ui/Select";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDateTime } from "@/lib/admin-formatting";
import {
  readAdminError,
  uploadLimitLabel,
  uploadViaSignedUrl,
} from "@/lib/admin-upload";
import {
  PRODUCT_REPORT_CATEGORIES,
  PRODUCT_REPORT_CATEGORY_LABEL,
  ProductReport,
  ProductReportCategory,
} from "@/lib/product-reports";
import { checkUploadFile, UPLOAD_LIMITS } from "@/lib/upload-limits";

// One row per picked file. `status` drives the per-file result badge, which
// is the whole point: a partial batch has to be readable at a glance.
type BatchRow = {
  key: string;
  file: File;
  name: string;
  number: string;
  summary: string;
  category: ProductReportCategory;
  status: "pending" | "uploading" | "done" | "error";
  error: string | null;
};

const ACCEPT_ATTR = UPLOAD_LIMITS["product-reports"].mimes.join(",");

let rowSeq = 0;

// Default label from the file name, minus the extension. Operators rename
// most of these, but "COA-2024-11.pdf" is a better starting point than an
// empty box, and a blank label is a 400 from the route.
function labelFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return stem.replace(/[_-]+/g, " ").trim().slice(0, 120);
}

function toBatchRow(file: File): BatchRow {
  rowSeq += 1;
  return {
    key: `${rowSeq}-${file.name}-${file.size}`,
    file,
    name: labelFromFileName(file.name),
    number: "",
    summary: "",
    category: "other",
    status: "pending",
    error: null,
  };
}

const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.18)";

export function LabReportsSection({
  productId,
  requirePin,
}: {
  productId: string;
  requirePin: () => Promise<string | null>;
}) {
  const [reports, setReports] = useState<ProductReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Add-modal state. One BatchRow per picked file; `addErr` is reserved for
  // problems with the batch as a whole (no files, PIN refused), never for a
  // single file — those live on the row.
  const [showAdd, setShowAdd] = useState(false);
  const [addRows, setAddRows] = useState<BatchRow[]>([]);
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
        `/api/admin/products/${productId}/reports?include_archived=1`,
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

  function patchAddRow(key: string, patch: Partial<BatchRow>) {
    setAddRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    setAddErr(null);
    setAddRows((prev) => [...prev, ...files.map(toBatchRow)]);
  }

  async function submitAdd() {
    // Anything already uploaded is left alone — this is also the retry path
    // after a partial batch, so a successful row must never be sent twice.
    const queue = addRows.filter((r) => r.status !== "done");
    if (queue.length === 0) {
      setAddErr("Select at least one file");
      return;
    }
    const unnamed = queue.filter((r) => !r.name.trim()).length;
    if (unnamed > 0) {
      setAddErr(
        unnamed === 1
          ? "One file still needs a report name"
          : `${unnamed} files still need a report name`,
      );
      return;
    }
    const grant = await requirePin();
    if (!grant) return;
    setAddBusy(true);
    setAddErr(null);
    // sort_order: every existing row is 0, so ordering currently falls
    // through to uploaded_at desc. Start the batch ABOVE whatever is already
    // stored — the picked order is preserved and no existing row is touched.
    const base =
      reports.reduce((max, r) => Math.max(max, r.sort_order ?? 0), 0) + 1;
    setAddRows((prev) =>
      prev.map((r) =>
        r.status === "done" ? r : { ...r, status: "uploading", error: null },
      ),
    );

    // Each file is its own two-step upload (signed URL straight to storage,
    // then a metadata POST) and its own try/catch. One rejection marks one
    // row; it does not reject the batch.
    const outcomes = await Promise.all(
      queue.map(async (row, i) => {
        try {
          const uploaded = await uploadViaSignedUrl(row.file, {
            bucket: "product-reports",
            prefix: productId,
            pinGrant: grant,
          });
          const res = await fetch(`/api/admin/products/${productId}/reports`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "x-pin-grant": grant,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              report_name: row.name.trim(),
              report_number: row.number.trim(),
              summary: row.summary.trim(),
              category: row.category,
              storage_path: uploaded.path,
              file_name: row.file.name,
              sort_order: base + i,
            }),
          });
          if (!res.ok) {
            throw new Error(await readAdminError(res, "Upload failed"));
          }
          patchAddRow(row.key, { status: "done", error: null });
          return true;
        } catch (e) {
          patchAddRow(row.key, {
            status: "error",
            error: e instanceof Error ? e.message : "Upload failed",
          });
          return false;
        }
      }),
    );

    try {
      await load();
    } finally {
      setAddBusy(false);
    }

    const failed = outcomes.filter((ok) => !ok).length;
    if (failed === 0) {
      setShowAdd(false);
      setAddRows([]);
    } else {
      setAddErr(
        `${outcomes.length - failed} of ${outcomes.length} uploaded. ${failed} failed — fix and upload again.`,
      );
    }
  }

  async function patchRow(id: string, patch: Partial<ProductReport>) {
    const grant = await requirePin();
    if (!grant) return;
    setRowBusy(id);
    setRowErr(null);
    try {
      await adminFetch(`/api/admin/products/${productId}/reports/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
        headers: { "x-pin-grant": grant },
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
    const grant = await requirePin();
    if (!grant) return;
    setRowBusy(id);
    setRowErr(null);
    try {
      await adminFetch(
        `/api/admin/products/${productId}/reports/${id}/${
          archived ? "unarchive" : "archive"
        }`,
        { method: "POST", headers: { "x-pin-grant": grant } },
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

  async function deleteRow(id: string, label: string) {
    if (
      !window.confirm(
        `Permanently delete "${label}"? The file will be removed from storage and cannot be undone.`,
      )
    ) {
      return;
    }
    const grant = await requirePin();
    if (!grant) return;
    setRowBusy(id);
    setRowErr(null);
    try {
      await adminFetch(`/api/admin/products/${productId}/reports/${id}`, {
        method: "DELETE",
        headers: { "x-pin-grant": grant },
      });
      await load();
    } catch (e) {
      setRowErr(e instanceof AdminFetchError ? e.message : "Delete failed");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className="mt-2">
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
            setAddRows([]);
            setAddErr(null);
          }}
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.25em",
            color: CREAM,
            border: `1px solid ${CREAM}`,
            padding: "0.45rem 0.9rem",
            background: "transparent",
          }}
        >
          + Add Lab Reports
        </button>
      </div>

      <p
        className="mb-4"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
          letterSpacing: "0.04em",
          color: CREAM,
          border: `1px solid ${BORDER}`,
          background: "rgba(251,243,212,0.06)",
          padding: "0.6rem 0.9rem",
        }}
      >
        Final trials are under process.
      </p>

      {loadErr ? (
        <p style={{ color: "#EF4444", fontFamily: "var(--font-body)" }}>
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
            fontSize: "1rem",
          }}
        >
          No lab reports uploaded yet.
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
              onDelete={() =>
                deleteRow(r.id, r.report_name ?? r.title)
              }
            />
          ))}
        </ul>
      )}

      {rowErr ? (
        <p
          className="mt-3"
          style={{ color: "#EF4444", fontFamily: "var(--font-body)" }}
        >
          {rowErr}
        </p>
      ) : null}

      {showAdd ? (
        <AddReportModal
          rows={addRows}
          onAddFiles={addFiles}
          onPatchRow={patchAddRow}
          onRemoveRow={(key) =>
            setAddRows((prev) => prev.filter((r) => r.key !== key))
          }
          busy={addBusy}
          err={addErr}
          onCancel={() => {
            setShowAdd(false);
            setAddRows([]);
            setAddErr(null);
          }}
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
  const [name, setName] = useState(report.report_name ?? report.title);
  const [number, setNumber] = useState(report.report_number ?? "");
  const [summary, setSummary] = useState(report.summary ?? "");
  const [category, setCategory] = useState<ProductReportCategory>(
    report.category,
  );

  function resetDrafts() {
    setName(report.report_name ?? report.title);
    setNumber(report.report_number ?? "");
    setSummary(report.summary ?? "");
    setCategory(report.category);
  }

  return (
    <li
      className="p-4"
      style={{
        border: `1px solid ${BORDER}`,
        background: "rgba(29,29,31,0.18)",
        opacity: report.is_archived ? 0.55 : 1,
      }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
        <span
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.25em",
            color: CREAM,
          }}
        >
          {PRODUCT_REPORT_CATEGORY_LABEL[report.category]}
          {report.is_archived ? " · Archived" : ""}
        </span>
        <span
          style={{
            color: FADED,
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
          }}
        >
          {formatDateTime(report.uploaded_at)}
        </span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <label style={fieldLabel}>
            Report Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full px-3 py-2"
              style={fieldInput}
            />
          </label>
          <label style={fieldLabel}>
            Report Number
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Optional"
              className="mt-1 w-full px-3 py-2"
              style={fieldInput}
            />
          </label>
          <label style={fieldLabel}>
            Summary
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Optional"
              rows={3}
              className="mt-1 w-full px-3 py-2"
              style={{ ...fieldInput, resize: "vertical" }}
            />
          </label>
          <label style={fieldLabel}>
            Category
            <div className="mt-1">
              <Select
                value={category}
                onChange={(v) => setCategory(v as ProductReportCategory)}
                ariaLabel="Report category"
                style={{
                  minHeight: 0,
                  borderColor: BORDER,
                  fontSize: "1rem",
                  textTransform: "none",
                  letterSpacing: "0.05em",
                }}
                options={PRODUCT_REPORT_CATEGORIES.map((c) => ({
                  value: c,
                  label: PRODUCT_REPORT_CATEGORY_LABEL[c],
                }))}
              />
            </div>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onPatch({
                  report_name: name.trim(),
                  report_number: number.trim() || null,
                  summary: summary.trim() || null,
                  category,
                });
                setEditing(false);
              }}
              disabled={busy || !name.trim()}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.25em",
                color: CREAM,
                border: `1px solid ${CREAM}`,
                padding: "0.35rem 0.7rem",
                background: "transparent",
                opacity: busy || !name.trim() ? 0.5 : 1,
              }}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                resetDrafts();
                setEditing(false);
              }}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
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
          {report.report_number ? (
            <div
              style={{
                fontFamily: "var(--font-body)",
                color: FADED,
                fontSize: "0.875rem",
                letterSpacing: "0.08em",
                marginBottom: "0.15rem",
              }}
            >
              {report.report_number}
            </div>
          ) : null}
          <div
            style={{
              fontFamily: "var(--font-body)",
              color: CREAM,
              fontSize: "1rem",
              marginBottom: "0.35rem",
            }}
          >
            {report.report_name ?? report.title}
          </div>
          {report.summary ? (
            <p
              style={{
                fontFamily: "var(--font-body)",
                color: FADED,
                fontSize: "1rem",
                lineHeight: 1.5,
                marginBottom: "0.5rem",
              }}
            >
              {report.summary}
            </p>
          ) : null}
          <a
            href={report.file_url}
            target="_blank"
            rel="noreferrer"
            className="block"
            style={{
              fontFamily: "var(--font-body)",
              color: CREAM,
              fontSize: "1rem",
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
              fontSize: "1rem",
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
                fontSize: "0.875rem",
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
                fontSize: "0.875rem",
                letterSpacing: "0.25em",
                color: report.is_archived ? CREAM : FADED,
                border: `1px solid ${report.is_archived ? CREAM : BORDER}`,
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
                fontSize: "0.875rem",
                letterSpacing: "0.25em",
                color: "#EF4444",
                border: "1px solid #EF4444",
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
  rows,
  onAddFiles,
  onPatchRow,
  onRemoveRow,
  busy,
  err,
  onCancel,
  onSubmit,
}: {
  rows: BatchRow[];
  onAddFiles: (files: File[]) => void;
  onPatchRow: (key: string, patch: Partial<BatchRow>) => void;
  onRemoveRow: (key: string) => void;
  busy: boolean;
  err: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const pending = rows.filter((r) => r.status !== "done").length;
  const done = rows.length - pending;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(29,29,31,0.7)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl"
        style={{
          background: "rgb(29,29,31)",
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
            background: "rgb(29,29,31)",
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
            Add Lab Reports
          </h4>
          <p
            style={{
              margin: "0.4rem 0 0",
              fontFamily: "var(--font-body)",
              color: FADED,
              fontSize: "1rem",
            }}
          >
            {rows.length === 0
              ? `Pick one or several files — PDF, JPEG or PNG, up to ${uploadLimitLabel("product-reports")} each.`
              : `${rows.length} file${rows.length === 1 ? "" : "s"} selected${done > 0 ? ` · ${done} already uploaded` : ""}. Each needs its own report name.`}
          </p>
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
          <label className="block mb-4" style={fieldLabel}>
            {rows.length === 0 ? "Choose Files" : "Add More Files"}
            <input
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              disabled={busy}
              onChange={(e) => {
                onAddFiles(Array.from(e.target.files ?? []));
                // Clear the input so re-picking the same file still fires a
                // change event — otherwise a removed row cannot be re-added.
                e.target.value = "";
              }}
              className="mt-1 w-full"
              style={{
                color: CREAM,
                fontFamily: "var(--font-body)",
                fontSize: "1rem",
                textTransform: "none",
                letterSpacing: "0.02em",
              }}
            />
          </label>

          {rows.map((row, i) => (
            <BatchRowFields
              key={row.key}
              row={row}
              index={i}
              busy={busy}
              onPatch={(p) => onPatchRow(row.key, p)}
              onRemove={() => onRemoveRow(row.key)}
            />
          ))}

          {err ? (
            <p
              style={{
                margin: 0,
                color: "#EF4444",
                fontFamily: "var(--font-body)",
                fontSize: "1rem",
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
            background: "rgb(29,29,31)",
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
              fontSize: "0.875rem",
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
            disabled={busy || pending === 0}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.25em",
              color: CREAM,
              border: `1px solid ${CREAM}`,
              padding: "0.45rem 0.9rem",
              background: "transparent",
              opacity: busy || pending === 0 ? 0.5 : 1,
            }}
          >
            {busy
              ? "Uploading…"
              : pending > 1
                ? `Upload ${pending} Files`
                : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

// One picked file: its own label, number, summary and category, plus its own
// outcome. The local checkUploadFile() call is a courtesy preview of the
// refusal uploadViaSignedUrl would give — the bucket row is the real control.
function BatchRowFields({
  row,
  index,
  busy,
  onPatch,
  onRemove,
}: {
  row: BatchRow;
  index: number;
  busy: boolean;
  onPatch: (patch: Partial<BatchRow>) => void;
  onRemove: () => void;
}) {
  const locked = row.status === "done" || row.status === "uploading";
  const localRefusal =
    row.status === "pending"
      ? checkUploadFile("product-reports", row.file)
      : null;
  const note = row.error ?? localRefusal;

  return (
    <div
      className="mb-3 p-3"
      style={{
        border: `1px solid ${row.status === "error" ? "#EF4444" : BORDER}`,
        background: "rgba(251,243,212,0.04)",
        opacity: row.status === "done" ? 0.6 : 1,
      }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
        <span
          style={{
            fontFamily: "var(--font-body)",
            color: CREAM,
            fontSize: "1rem",
          }}
        >
          {index + 1}. {row.file.name} ({formatBytes(row.file.size)})
        </span>
        <span className="flex items-baseline gap-3">
          <span
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.2em",
              color:
                row.status === "done"
                  ? "#34D399"
                  : row.status === "error"
                    ? "#EF4444"
                    : FADED,
            }}
          >
            {row.status === "done"
              ? "Uploaded"
              : row.status === "error"
                ? "Failed"
                : row.status === "uploading"
                  ? "Uploading…"
                  : "Ready"}
          </span>
          {row.status === "uploading" ? null : (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.2em",
                color: FADED,
                border: "none",
                background: "transparent",
                padding: 0,
              }}
            >
              Remove
            </button>
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block" style={fieldLabel}>
          Report Name
          <input
            value={row.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            disabled={locked}
            placeholder="e.g. Nutrition Analysis"
            className="mt-1 w-full px-3 py-2"
            style={fieldInput}
          />
        </label>

        <label className="block" style={fieldLabel}>
          Report Number
          <input
            value={row.number}
            onChange={(e) => onPatch({ number: e.target.value })}
            disabled={locked}
            placeholder="Optional"
            className="mt-1 w-full px-3 py-2"
            style={fieldInput}
          />
        </label>

        <label className="block" style={fieldLabel}>
          Category
          <div className="mt-1">
            <Select
              value={row.category}
              onChange={(v) => onPatch({ category: v as ProductReportCategory })}
              disabled={locked}
              ariaLabel={`Report category for ${row.file.name}`}
              style={{
                borderColor: BORDER,
                fontSize: "1rem",
                textTransform: "none",
                letterSpacing: "0.05em",
              }}
              options={PRODUCT_REPORT_CATEGORIES.map((c) => ({
                value: c,
                label: PRODUCT_REPORT_CATEGORY_LABEL[c],
              }))}
            />
          </div>
        </label>

        <label className="block" style={fieldLabel}>
          Summary
          <textarea
            value={row.summary}
            onChange={(e) => onPatch({ summary: e.target.value })}
            disabled={locked}
            placeholder="Optional"
            rows={2}
            className="mt-1 w-full px-3 py-2"
            style={{ ...fieldInput, resize: "vertical" }}
          />
        </label>
      </div>

      {note ? (
        <p
          className="mt-2"
          style={{
            margin: 0,
            color: "#EF4444",
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
          }}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  color: FADED,
  fontSize: "0.875rem",
  letterSpacing: "0.2em",
  textTransform: "uppercase",
};

const fieldInput: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  background: "transparent",
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  letterSpacing: "0.05em",
  textTransform: "none",
};

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
