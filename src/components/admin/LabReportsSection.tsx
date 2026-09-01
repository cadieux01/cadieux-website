"use client";

// Lab Reports & Certifications panel for the admin product detail page.
// Loads, uploads, edits, archives, unarchives and deletes rows in the
// product_reports table via /api/admin/products/[id]/reports. File
// uploads use a raw fetch (not adminFetch) so the multipart Content-Type
// boundary is set by the browser. Every mutation is gated by the security
// PIN — requirePin() is owned by the parent page and passed down; the
// returned grant rides as the `x-pin-grant` header.

import { useCallback, useEffect, useState } from "react";

import Select from "@/components/ui/Select";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDateTime } from "@/lib/admin-formatting";
import {
  PRODUCT_REPORT_CATEGORIES,
  PRODUCT_REPORT_CATEGORY_LABEL,
  ProductReport,
  ProductReportCategory,
} from "@/lib/product-reports";

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

  // Add-modal state
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addNumber, setAddNumber] = useState("");
  const [addSummary, setAddSummary] = useState("");
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

  async function submitAdd() {
    if (!addFile) {
      setAddErr("Select a PDF file");
      return;
    }
    if (addFile.type !== "application/pdf") {
      setAddErr("File must be a PDF");
      return;
    }
    if (!addName.trim()) {
      setAddErr("Report name is required");
      return;
    }
    const grant = await requirePin();
    if (!grant) return;
    setAddBusy(true);
    setAddErr(null);
    try {
      const fd = new FormData();
      fd.append("file", addFile);
      fd.append("report_name", addName.trim());
      fd.append("report_number", addNumber.trim());
      fd.append("summary", addSummary.trim());
      fd.append("category", addCategory);
      const res = await fetch(
        `/api/admin/products/${productId}/reports`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "x-pin-grant": grant },
          body: fd,
        },
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? `Upload failed (${res.status})`);
      }
      setShowAdd(false);
      setAddName("");
      setAddNumber("");
      setAddSummary("");
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
          + Add Lab Report
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
          name={addName}
          onName={setAddName}
          number={addNumber}
          onNumber={setAddNumber}
          summary={addSummary}
          onSummary={setAddSummary}
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
  name,
  onName,
  number,
  onNumber,
  summary,
  onSummary,
  category,
  onCategory,
  file,
  onFile,
  busy,
  err,
  onCancel,
  onSubmit,
}: {
  name: string;
  onName: (s: string) => void;
  number: string;
  onNumber: (s: string) => void;
  summary: string;
  onSummary: (s: string) => void;
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
      style={{ background: "rgba(29,29,31,0.7)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md"
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
            Add Lab Report
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
          <label className="block mb-3" style={fieldLabel}>
            Report Name
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder="e.g. Nutrition Analysis"
              className="mt-1 w-full px-3 py-2"
              style={fieldInput}
            />
          </label>

          <label className="block mb-3" style={fieldLabel}>
            Report Number
            <input
              value={number}
              onChange={(e) => onNumber(e.target.value)}
              placeholder="Optional"
              className="mt-1 w-full px-3 py-2"
              style={fieldInput}
            />
          </label>

          <label className="block mb-3" style={fieldLabel}>
            Summary
            <textarea
              value={summary}
              onChange={(e) => onSummary(e.target.value)}
              placeholder="Optional"
              rows={3}
              className="mt-1 w-full px-3 py-2"
              style={{ ...fieldInput, resize: "vertical" }}
            />
          </label>

          <label className="block mb-3" style={fieldLabel}>
            Category
            <div className="mt-1">
              <Select
                value={category}
                onChange={(v) => onCategory(v as ProductReportCategory)}
                ariaLabel="Report category"
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

          <label className="block mb-4" style={fieldLabel}>
            PDF File (max 10MB)
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="mt-1 w-full"
              style={{
                color: CREAM,
                fontFamily: "var(--font-body)",
                fontSize: "1rem",
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
                  fontSize: "1rem",
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
            disabled={busy}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.25em",
              color: CREAM,
              border: `1px solid ${CREAM}`,
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
