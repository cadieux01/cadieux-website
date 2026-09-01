"use client";

// /admin/delivery-partners — CRUD for `public.delivery_partners`, the
// tiny operator-managed list of delivery riders the "Share" button on
// /admin/orders dispatches to via wa.me. Expected size: 3-4 rows.
//
// Deliberately minimal: no bulk actions, no Google Maps, no tabs.
// One list + Add button + inline row actions (Edit / Archive /
// Restore). Soft-delete only — the row stays for audit continuity.

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import {
  formatPartnerPhoneDisplay,
  normalizeWhatsAppPhone,
} from "@/lib/delivery-partner-phone";

const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.18)";
const DANGER = "#EF4444";

type DeliveryPartner = {
  id: string;
  name: string;
  phone: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type ListResponse = { partners: DeliveryPartner[] };
type MutationResponse = { partner: DeliveryPartner };

type EditorState = {
  mode: "create" | "edit";
  id?: string;
  name: string;
  phone: string;
};

const EMPTY_EDITOR: EditorState = { mode: "create", name: "", phone: "" };

export default function DeliveryPartnersPage() {
  const [partners, setPartners] = useState<DeliveryPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // include_inactive=1 → we show archived rows in a muted section so
      // the operator can restore without visiting a separate tab.
      const data = await adminFetch<ListResponse>(
        "/api/admin/delivery-partners?include_inactive=1",
      );
      setPartners(data.partners);
    } catch (err) {
      const message =
        err instanceof AdminFetchError ? err.message : "Failed to load partners";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = partners.filter((p) => p.is_active);
  const archived = partners.filter((p) => !p.is_active);

  const openCreate = () => {
    setSaveError(null);
    setEditor({ ...EMPTY_EDITOR });
  };
  const openEdit = (p: DeliveryPartner) => {
    setSaveError(null);
    setEditor({ mode: "edit", id: p.id, name: p.name, phone: p.phone });
  };
  const closeEditor = () => {
    if (saving) return;
    setEditor(null);
    setSaveError(null);
  };

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    setSaveError(null);
    try {
      const name = editor.name.trim();
      const phone = editor.phone.trim();
      if (!name) throw new Error("Name is required");
      if (!normalizeWhatsAppPhone(phone)) {
        throw new Error(
          "Phone must be a valid WhatsApp number (10-digit Indian mobile or full country-coded number)",
        );
      }
      if (editor.mode === "create") {
        await adminFetch<MutationResponse>("/api/admin/delivery-partners", {
          method: "POST",
          body: JSON.stringify({ name, phone }),
        });
      } else if (editor.id) {
        await adminFetch<MutationResponse>(
          `/api/admin/delivery-partners/${editor.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ name, phone }),
          },
        );
      }
      setEditor(null);
      await load();
    } catch (err) {
      const message =
        err instanceof AdminFetchError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Save failed";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const archive = async (p: DeliveryPartner) => {
    if (!confirm(`Archive delivery partner "${p.name}"?`)) return;
    try {
      await adminFetch<MutationResponse>(
        `/api/admin/delivery-partners/${p.id}`,
        { method: "DELETE" },
      );
      await load();
    } catch (err) {
      alert(err instanceof AdminFetchError ? err.message : "Archive failed");
    }
  };

  const restore = async (p: DeliveryPartner) => {
    try {
      await adminFetch<MutationResponse>(
        `/api/admin/delivery-partners/${p.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: true }),
        },
      );
      await load();
    } catch (err) {
      alert(err instanceof AdminFetchError ? err.message : "Restore failed");
    }
  };

  return (
    <AdminShell
      title="Delivery Partners"
      subtitle="Riders the /admin/orders Share button can dispatch to via WhatsApp."
      actions={
        <button
          type="button"
          onClick={openCreate}
          style={{
            background: CREAM,
            color: "#1D1D1F",
            border: "none",
            padding: "8px 16px",
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Add partner
        </button>
      }
    >
      {loading && <p style={{ color: FADED }}>Loading…</p>}
      {error && <p style={{ color: DANGER }}>{error}</p>}

      {!loading && !error && (
        <>
          <PartnerTable
            partners={active}
            emptyLabel="No delivery partners yet. Add one to enable per-order Share."
            onEdit={openEdit}
            onArchive={archive}
          />

          {archived.length > 0 && (
            <div style={{ marginTop: 40 }}>
              <h3
                style={{
                  color: FADED,
                  fontFamily: "var(--font-body)",
                  fontSize: "0.875rem",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  margin: "0 0 12px",
                }}
              >
                Archived
              </h3>
              <ArchivedTable partners={archived} onRestore={restore} />
            </div>
          )}
        </>
      )}

      {editor && (
        <EditorModal
          editor={editor}
          saving={saving}
          error={saveError}
          onChange={setEditor}
          onClose={closeEditor}
          onSave={save}
        />
      )}
    </AdminShell>
  );
}

function PartnerTable({
  partners,
  emptyLabel,
  onEdit,
  onArchive,
}: {
  partners: DeliveryPartner[];
  emptyLabel: string;
  onEdit: (p: DeliveryPartner) => void;
  onArchive: (p: DeliveryPartner) => void;
}) {
  if (partners.length === 0) {
    return (
      <p style={{ color: FADED, fontStyle: "italic" }}>{emptyLabel}</p>
    );
  }
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        overflow: "hidden",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
        }}
      >
        <thead>
          <tr
            style={{
              background: "rgba(251,243,212,0.05)",
              color: FADED,
              textAlign: "left",
              fontSize: "0.875rem",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            <th style={{ padding: "10px 12px" }}>Name</th>
            <th style={{ padding: "10px 12px" }}>WhatsApp</th>
            <th style={{ padding: "10px 12px", textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {partners.map((p) => (
            <tr
              key={p.id}
              style={{ borderTop: `1px solid ${BORDER}`, color: CREAM }}
            >
              <td style={{ padding: "10px 12px" }}>{p.name}</td>
              <td style={{ padding: "10px 12px", fontVariantNumeric: "tabular-nums" }}>
                {formatPartnerPhoneDisplay(p.phone)}
              </td>
              <td style={{ padding: "10px 12px", textAlign: "right" }}>
                <button
                  type="button"
                  onClick={() => onEdit(p)}
                  style={rowBtnStyle}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onArchive(p)}
                  style={{ ...rowBtnStyle, color: DANGER, marginLeft: 6 }}
                >
                  Archive
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArchivedTable({
  partners,
  onRestore,
}: {
  partners: DeliveryPartner[];
  onRestore: (p: DeliveryPartner) => void;
}) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, opacity: 0.75 }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
        }}
      >
        <tbody>
          {partners.map((p) => (
            <tr key={p.id} style={{ color: FADED }}>
              <td style={{ padding: "8px 12px" }}>{p.name}</td>
              <td style={{ padding: "8px 12px" }}>
                {formatPartnerPhoneDisplay(p.phone)}
              </td>
              <td style={{ padding: "8px 12px", textAlign: "right" }}>
                <button
                  type="button"
                  onClick={() => onRestore(p)}
                  style={rowBtnStyle}
                >
                  Restore
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const rowBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: CREAM,
  border: `1px solid ${BORDER}`,
  padding: "4px 10px",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: "pointer",
};

function EditorModal({
  editor,
  saving,
  error,
  onChange,
  onClose,
  onSave,
}: {
  editor: EditorState;
  saving: boolean;
  error: string | null;
  onChange: (e: EditorState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(29,29,31,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 40,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1D1D1F",
          border: `1px solid ${BORDER}`,
          padding: 24,
          width: "100%",
          maxWidth: 420,
          color: CREAM,
          fontFamily: "var(--font-body)",
        }}
      >
        <h3
          style={{
            margin: "0 0 16px",
            fontSize: "1rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: CREAM,
          }}
        >
          {editor.mode === "create" ? "Add partner" : "Edit partner"}
        </h3>

        <label style={labelStyle}>
          Name
          <input
            type="text"
            value={editor.name}
            onChange={(e) => onChange({ ...editor, name: e.target.value })}
            placeholder="Rider name"
            style={inputStyle}
            autoFocus
          />
        </label>

        <label style={labelStyle}>
          WhatsApp number
          <input
            type="tel"
            value={editor.phone}
            onChange={(e) => onChange({ ...editor, phone: e.target.value })}
            placeholder="9989153747 or +91 9989153747"
            style={inputStyle}
          />
          <span style={{ color: FADED, fontSize: "1rem", marginTop: 4 }}>
            10-digit Indian mobile is auto-prefixed with +91.
          </span>
        </label>

        {error && (
          <p style={{ color: DANGER, fontSize: "1rem", margin: "8px 0 0" }}>
            {error}
          </p>
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 20,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              ...rowBtnStyle,
              padding: "8px 16px",
              opacity: saving ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            style={{
              background: CREAM,
              color: "#1D1D1F",
              border: "none",
              padding: "8px 16px",
              fontSize: "0.875rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : editor.mode === "create" ? "Add" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginBottom: 14,
  fontSize: "0.875rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: FADED,
};

const inputStyle: React.CSSProperties = {
  background: "#1D1D1F",
  color: CREAM,
  border: `1px solid ${BORDER}`,
  padding: "10px 12px",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  letterSpacing: "0.02em",
  textTransform: "none",
};
