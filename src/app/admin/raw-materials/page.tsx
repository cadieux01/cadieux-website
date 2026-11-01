"use client";

// /admin/raw-materials — list / create / edit / deactivate for
// `public.raw_materials` and `public.vendors`.
//
// Scope is deliberately this and nothing more: no batch entry, no stock
// movements, no charts. Quantities shown here are READ from the
// raw_material_stock view; this screen never writes one.
//
// Neither table is reachable from a browser session — both grant privileges
// to service_role only and carry a deny-all RLS policy for anon and
// authenticated — so every read and write below goes through
// /api/admin/{raw-materials,vendors}, which is gated by isAdmin() exactly
// like every other admin route. No second auth scheme.

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import {
  classifyReorder,
  CODE_MAX_LENGTH,
  RAW_MATERIAL_UNITS,
  REORDER_LABEL,
  type ReorderState,
} from "@/lib/raw-materials";

const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.18)";
const DANGER = "#EF4444";
const OK = "#4ADE80";
const UNDECIDED = "#F59E0B";

type MaterialRow = {
  material_id: string;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  reorder_level: number | string | null;
  lead_time_days: number | null;
  vendor_id: string | null;
  is_active: boolean;
  current_qty: number | string | null;
  movement_count: number;
  last_movement_at: string | null;
  needs_reorder: boolean | null;
  vendor_name: string | null;
  vendor_is_active: boolean | null;
};

type Vendor = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
};

type MaterialListResponse = { materials: MaterialRow[] };
type VendorListResponse = { vendors: Vendor[] };
type MaterialDetailResponse = {
  material: {
    id: string;
    code: string;
    name: string;
    unit: string;
    category: string | null;
    reorder_level: number | string | null;
    lead_time_days: number | null;
    vendor_id: string | null;
    notes: string | null;
  };
  unit_locked: boolean;
  unit_locked_reason: string | null;
};

type MaterialEditor = {
  mode: "create" | "edit";
  id?: string;
  code: string;
  name: string;
  unit: string;
  category: string;
  reorder_level: string;
  lead_time_days: string;
  vendor_id: string;
  notes: string;
  unitLocked: boolean;
  unitLockedReason: string | null;
};

type VendorEditor = {
  mode: "create" | "edit";
  id?: string;
  name: string;
  contact_person: string;
  phone: string;
  whatsapp: string;
  address: string;
  notes: string;
};

const EMPTY_MATERIAL: MaterialEditor = {
  mode: "create",
  code: "",
  name: "",
  unit: RAW_MATERIAL_UNITS[0],
  category: "",
  reorder_level: "",
  lead_time_days: "",
  vendor_id: "",
  notes: "",
  unitLocked: false,
  unitLockedReason: null,
};

const EMPTY_VENDOR: VendorEditor = {
  mode: "create",
  name: "",
  contact_person: "",
  phone: "",
  whatsapp: "",
  address: "",
  notes: "",
};

function numberOrNull(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatQty(value: number | string | null): string {
  const n = numberOrNull(value);
  if (n === null) return "—";
  // Trim the view's three trailing decimals when they carry nothing.
  return String(Number(n.toFixed(3)));
}

export default function RawMaterialsPage() {
  const [tab, setTab] = useState<"materials" | "vendors">("materials");
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [materialEditor, setMaterialEditor] = useState<MaterialEditor | null>(null);
  const [vendorEditor, setVendorEditor] = useState<VendorEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // include_inactive=1 for both: deactivated rows are shown in a muted
      // section so they can be reactivated without a separate screen.
      const [m, v] = await Promise.all([
        adminFetch<MaterialListResponse>(
          "/api/admin/raw-materials?include_inactive=1",
        ),
        adminFetch<VendorListResponse>("/api/admin/vendors?include_inactive=1"),
      ]);
      setMaterials(m.materials);
      setVendors(v.vendors);
    } catch (err) {
      setError(
        err instanceof AdminFetchError ? err.message : "Failed to load",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreateMaterial = () => {
    setSaveError(null);
    setMaterialEditor({ ...EMPTY_MATERIAL });
  };

  // Editing fetches the single row rather than reusing the list entry,
  // because only the detail endpoint can answer whether the unit is still
  // changeable (it probes production_batch_materials).
  const openEditMaterial = async (row: MaterialRow) => {
    setSaveError(null);
    try {
      const data = await adminFetch<MaterialDetailResponse>(
        `/api/admin/raw-materials/${row.material_id}`,
      );
      setMaterialEditor({
        mode: "edit",
        id: data.material.id,
        code: data.material.code,
        name: data.material.name,
        unit: data.material.unit,
        category: data.material.category ?? "",
        reorder_level:
          data.material.reorder_level === null
            ? ""
            : String(data.material.reorder_level),
        lead_time_days:
          data.material.lead_time_days === null
            ? ""
            : String(data.material.lead_time_days),
        vendor_id: data.material.vendor_id ?? "",
        notes: data.material.notes ?? "",
        unitLocked: data.unit_locked,
        unitLockedReason: data.unit_locked_reason,
      });
    } catch (err) {
      alert(
        err instanceof AdminFetchError ? err.message : "Could not open material",
      );
    }
  };

  const saveMaterial = async () => {
    if (!materialEditor) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, unknown> = {
        code: materialEditor.code,
        name: materialEditor.name,
        category: materialEditor.category,
        reorder_level: materialEditor.reorder_level,
        lead_time_days: materialEditor.lead_time_days,
        vendor_id: materialEditor.vendor_id || null,
        notes: materialEditor.notes,
      };
      // Omit `unit` entirely when it is locked, so a stale form can never
      // even attempt the change the DB would refuse.
      if (!materialEditor.unitLocked) payload.unit = materialEditor.unit;

      if (materialEditor.mode === "create") {
        await adminFetch("/api/admin/raw-materials", {
          method: "POST",
          body: JSON.stringify({ ...payload, unit: materialEditor.unit }),
        });
      } else if (materialEditor.id) {
        await adminFetch(`/api/admin/raw-materials/${materialEditor.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      setMaterialEditor(null);
      await load();
    } catch (err) {
      setSaveError(
        err instanceof AdminFetchError || err instanceof Error
          ? err.message
          : "Save failed",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveVendor = async () => {
    if (!vendorEditor) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (!vendorEditor.name.trim()) throw new Error("Name is required");
      const payload = {
        name: vendorEditor.name,
        contact_person: vendorEditor.contact_person,
        phone: vendorEditor.phone,
        whatsapp: vendorEditor.whatsapp,
        address: vendorEditor.address,
        notes: vendorEditor.notes,
      };
      if (vendorEditor.mode === "create") {
        await adminFetch("/api/admin/vendors", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else if (vendorEditor.id) {
        await adminFetch(`/api/admin/vendors/${vendorEditor.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      setVendorEditor(null);
      await load();
    } catch (err) {
      setSaveError(
        err instanceof AdminFetchError || err instanceof Error
          ? err.message
          : "Save failed",
      );
    } finally {
      setSaving(false);
    }
  };

  // Deactivate / reactivate is a PATCH of is_active. There is no delete
  // path anywhere on this screen: both tables are referenced by
  // ON DELETE RESTRICT foreign keys and are kept as history.
  const setMaterialActive = async (row: MaterialRow, next: boolean) => {
    if (
      !next &&
      !confirm(
        `Deactivate "${row.code} — ${row.name}"? It stays in the records and can be reactivated.`,
      )
    ) {
      return;
    }
    try {
      await adminFetch(`/api/admin/raw-materials/${row.material_id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: next }),
      });
      await load();
    } catch (err) {
      alert(err instanceof AdminFetchError ? err.message : "Update failed");
    }
  };

  const setVendorActive = async (vendor: Vendor, next: boolean) => {
    if (
      !next &&
      !confirm(
        `Deactivate "${vendor.name}"? Materials already pointing at this vendor keep the link.`,
      )
    ) {
      return;
    }
    try {
      await adminFetch(`/api/admin/vendors/${vendor.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: next }),
      });
      await load();
    } catch (err) {
      alert(err instanceof AdminFetchError ? err.message : "Update failed");
    }
  };

  const activeMaterials = materials.filter((m) => m.is_active);
  const inactiveMaterials = materials.filter((m) => !m.is_active);
  const activeVendors = vendors.filter((v) => v.is_active);
  const inactiveVendors = vendors.filter((v) => !v.is_active);

  return (
    <AdminShell
      title="Raw Materials & Vendors"
      subtitle="What we buy and who we buy it from. Quantities are read from the stock view; this screen does not record movements."
      actions={
        <button
          type="button"
          onClick={() => {
            if (tab === "materials") openCreateMaterial();
            else {
              setSaveError(null);
              setVendorEditor({ ...EMPTY_VENDOR });
            }
          }}
          style={primaryBtnStyle}
        >
          {tab === "materials" ? "Add material" : "Add vendor"}
        </button>
      }
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {(["materials", "vendors"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              ...rowBtnStyle,
              background: tab === key ? CREAM : "transparent",
              color: tab === key ? "#1D1D1F" : CREAM,
              padding: "6px 14px",
            }}
          >
            {key === "materials"
              ? `Materials (${activeMaterials.length})`
              : `Vendors (${activeVendors.length})`}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: FADED }}>Loading…</p>}
      {error && <p style={{ color: DANGER }}>{error}</p>}

      {!loading && !error && tab === "materials" && (
        <>
          <MaterialTable
            rows={activeMaterials}
            emptyLabel="No raw materials yet. Add one to start tracking stock."
            onEdit={openEditMaterial}
            onToggleActive={setMaterialActive}
          />
          {inactiveMaterials.length > 0 && (
            <section style={{ marginTop: 40 }}>
              <h3 style={sectionHeadingStyle}>Deactivated</h3>
              <MaterialTable
                rows={inactiveMaterials}
                emptyLabel=""
                muted
                onEdit={openEditMaterial}
                onToggleActive={setMaterialActive}
              />
            </section>
          )}
        </>
      )}

      {!loading && !error && tab === "vendors" && (
        <>
          <VendorTable
            rows={activeVendors}
            emptyLabel="No vendors yet. Add one to attach it to a material."
            onEdit={(v) => {
              setSaveError(null);
              setVendorEditor({
                mode: "edit",
                id: v.id,
                name: v.name,
                contact_person: v.contact_person ?? "",
                phone: v.phone ?? "",
                whatsapp: v.whatsapp ?? "",
                address: v.address ?? "",
                notes: v.notes ?? "",
              });
            }}
            onToggleActive={setVendorActive}
          />
          {inactiveVendors.length > 0 && (
            <section style={{ marginTop: 40 }}>
              <h3 style={sectionHeadingStyle}>Deactivated</h3>
              <VendorTable
                rows={inactiveVendors}
                emptyLabel=""
                muted
                onEdit={(v) => {
                  setSaveError(null);
                  setVendorEditor({
                    mode: "edit",
                    id: v.id,
                    name: v.name,
                    contact_person: v.contact_person ?? "",
                    phone: v.phone ?? "",
                    whatsapp: v.whatsapp ?? "",
                    address: v.address ?? "",
                    notes: v.notes ?? "",
                  });
                }}
                onToggleActive={setVendorActive}
              />
            </section>
          )}
        </>
      )}

      {materialEditor && (
        <MaterialModal
          editor={materialEditor}
          vendors={vendors}
          saving={saving}
          error={saveError}
          onChange={setMaterialEditor}
          onClose={() => {
            if (!saving) {
              setMaterialEditor(null);
              setSaveError(null);
            }
          }}
          onSave={saveMaterial}
        />
      )}

      {vendorEditor && (
        <VendorModal
          editor={vendorEditor}
          saving={saving}
          error={saveError}
          onChange={setVendorEditor}
          onClose={() => {
            if (!saving) {
              setVendorEditor(null);
              setSaveError(null);
            }
          }}
          onSave={saveVendor}
        />
      )}
    </AdminShell>
  );
}

// ── reorder badge ──────────────────────────────────────────────────────
// Three states, three visibly different treatments. "undecided" must not
// be mistakable for "ok": it gets its own colour, a DASHED border, and
// wording that names the gap ("No reorder level") rather than describing
// stock, because nothing about stock has been established.
function ReorderBadge({ state }: { state: ReorderState }) {
  const palette: Record<
    ReorderState,
    { color: string; label: string; dashed: boolean }
  > = {
    below: { color: DANGER, label: "Reorder", dashed: false },
    ok: { color: OK, label: "OK", dashed: false },
    undecided: { color: UNDECIDED, label: "No reorder level", dashed: true },
  };
  const { color, label, dashed } = palette[state];
  return (
    <span
      title={REORDER_LABEL[state]}
      style={{
        display: "inline-block",
        color,
        border: `1px ${dashed ? "dashed" : "solid"} ${color}`,
        padding: "2px 8px",
        fontSize: "0.75rem",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function MaterialTable({
  rows,
  emptyLabel,
  muted,
  onEdit,
  onToggleActive,
}: {
  rows: MaterialRow[];
  emptyLabel: string;
  muted?: boolean;
  onEdit: (row: MaterialRow) => void;
  onToggleActive: (row: MaterialRow, next: boolean) => void;
}) {
  if (rows.length === 0) {
    return emptyLabel ? (
      <p style={{ color: FADED, fontStyle: "italic" }}>{emptyLabel}</p>
    ) : null;
  }
  return (
    <div style={{ border: `1px solid ${BORDER}`, opacity: muted ? 0.7 : 1 }}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={thStyle}>Code</th>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Unit</th>
            <th style={{ ...thStyle, textAlign: "right" }}>In stock</th>
            <th style={thStyle}>Reorder</th>
            <th style={thStyle}>Category</th>
            <th style={thStyle}>Vendor</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Lead</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const state = classifyReorder(row.needs_reorder);
            return (
              <tr
                key={row.material_id}
                style={{ borderTop: `1px solid ${BORDER}`, color: CREAM }}
              >
                <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                  {row.code}
                </td>
                <td style={tdStyle}>{row.name}</td>
                <td style={tdStyle}>{row.unit}</td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatQty(row.current_qty)}
                  {row.reorder_level !== null && (
                    <span style={{ color: FADED }}>
                      {" "}
                      / {formatQty(row.reorder_level)}
                    </span>
                  )}
                </td>
                <td style={tdStyle}>
                  <ReorderBadge state={state} />
                </td>
                <td style={tdStyle}>{row.category ?? "—"}</td>
                <td style={tdStyle}>
                  {row.vendor_name ?? "—"}
                  {row.vendor_name && row.vendor_is_active === false && (
                    <span style={{ color: UNDECIDED, fontSize: "0.75rem" }}>
                      {" "}
                      (inactive)
                    </span>
                  )}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {row.lead_time_days === null ? "—" : `${row.lead_time_days}d`}
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => onEdit(row)}
                    style={rowBtnStyle}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleActive(row, !row.is_active)}
                    style={{
                      ...rowBtnStyle,
                      marginLeft: 6,
                      color: row.is_active ? DANGER : CREAM,
                    }}
                  >
                    {row.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VendorTable({
  rows,
  emptyLabel,
  muted,
  onEdit,
  onToggleActive,
}: {
  rows: Vendor[];
  emptyLabel: string;
  muted?: boolean;
  onEdit: (vendor: Vendor) => void;
  onToggleActive: (vendor: Vendor, next: boolean) => void;
}) {
  if (rows.length === 0) {
    return emptyLabel ? (
      <p style={{ color: FADED, fontStyle: "italic" }}>{emptyLabel}</p>
    ) : null;
  }
  return (
    <div style={{ border: `1px solid ${BORDER}`, opacity: muted ? 0.7 : 1 }}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Contact</th>
            <th style={thStyle}>Phone</th>
            <th style={thStyle}>WhatsApp</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((vendor) => (
            <tr
              key={vendor.id}
              style={{ borderTop: `1px solid ${BORDER}`, color: CREAM }}
            >
              <td style={tdStyle}>{vendor.name}</td>
              <td style={tdStyle}>{vendor.contact_person ?? "—"}</td>
              <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                {vendor.phone ?? "—"}
              </td>
              <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                {vendor.whatsapp ?? "—"}
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                <button
                  type="button"
                  onClick={() => onEdit(vendor)}
                  style={rowBtnStyle}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onToggleActive(vendor, !vendor.is_active)}
                  style={{
                    ...rowBtnStyle,
                    marginLeft: 6,
                    color: vendor.is_active ? DANGER : CREAM,
                  }}
                >
                  {vendor.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Modal({
  title,
  children,
  saving,
  error,
  onClose,
  onSave,
  saveLabel,
}: {
  title: string;
  children: React.ReactNode;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
  saveLabel: string;
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
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1D1D1F",
          border: `1px solid ${BORDER}`,
          padding: 24,
          width: "100%",
          maxWidth: 480,
          color: CREAM,
          fontFamily: "var(--font-body)",
          maxHeight: "90vh",
          overflowY: "auto",
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
          {title}
        </h3>
        {children}
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
            style={{ ...rowBtnStyle, padding: "8px 16px", opacity: saving ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            style={{
              ...primaryBtnStyle,
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function MaterialModal({
  editor,
  vendors,
  saving,
  error,
  onChange,
  onClose,
  onSave,
}: {
  editor: MaterialEditor;
  vendors: Vendor[];
  saving: boolean;
  error: string | null;
  onChange: (next: MaterialEditor) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  // An inactive vendor is not offered as a new choice, but the one already
  // attached to this material stays selectable so editing any other field
  // cannot silently detach it.
  const selectableVendors = vendors.filter(
    (v) => v.is_active || v.id === editor.vendor_id,
  );

  return (
    <Modal
      title={editor.mode === "create" ? "Add material" : "Edit material"}
      saving={saving}
      error={error}
      onClose={onClose}
      onSave={onSave}
      saveLabel={editor.mode === "create" ? "Add" : "Save"}
    >
      <label style={labelStyle}>
        Code *
        <input
          type="text"
          value={editor.code}
          maxLength={CODE_MAX_LENGTH}
          onChange={(e) => onChange({ ...editor, code: e.target.value })}
          placeholder="MLK-01"
          style={inputStyle}
          autoFocus
        />
        <span style={hintStyle}>
          Stored exactly as typed — case is preserved. Must be unique.
        </span>
      </label>

      <label style={labelStyle}>
        Name *
        <input
          type="text"
          value={editor.name}
          onChange={(e) => onChange({ ...editor, name: e.target.value })}
          placeholder="Full cream milk"
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Unit *
        <select
          value={editor.unit}
          disabled={editor.unitLocked}
          onChange={(e) => onChange({ ...editor, unit: e.target.value })}
          style={{
            ...inputStyle,
            opacity: editor.unitLocked ? 0.55 : 1,
            cursor: editor.unitLocked ? "not-allowed" : "pointer",
          }}
        >
          {RAW_MATERIAL_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
        {editor.unitLocked && editor.unitLockedReason && (
          <span style={{ ...hintStyle, color: UNDECIDED }}>
            {editor.unitLockedReason}
          </span>
        )}
      </label>

      <label style={labelStyle}>
        Category
        <input
          type="text"
          value={editor.category}
          onChange={(e) => onChange({ ...editor, category: e.target.value })}
          placeholder="Dairy"
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Reorder level
        <input
          type="number"
          min={0}
          step="any"
          value={editor.reorder_level}
          onChange={(e) => onChange({ ...editor, reorder_level: e.target.value })}
          placeholder="Leave blank if undecided"
          style={inputStyle}
        />
        <span style={hintStyle}>
          Blank means no threshold has been decided — the list shows that as
          its own state, not as &ldquo;in stock&rdquo;.
        </span>
      </label>

      <label style={labelStyle}>
        Lead time (days)
        <input
          type="number"
          min={0}
          step={1}
          value={editor.lead_time_days}
          onChange={(e) =>
            onChange({ ...editor, lead_time_days: e.target.value })
          }
          placeholder="2"
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Vendor
        <select
          value={editor.vendor_id}
          onChange={(e) => onChange({ ...editor, vendor_id: e.target.value })}
          style={inputStyle}
        >
          <option value="">— none —</option>
          {selectableVendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.is_active ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Notes
        <textarea
          value={editor.notes}
          onChange={(e) => onChange({ ...editor, notes: e.target.value })}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>
    </Modal>
  );
}

function VendorModal({
  editor,
  saving,
  error,
  onChange,
  onClose,
  onSave,
}: {
  editor: VendorEditor;
  saving: boolean;
  error: string | null;
  onChange: (next: VendorEditor) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal
      title={editor.mode === "create" ? "Add vendor" : "Edit vendor"}
      saving={saving}
      error={error}
      onClose={onClose}
      onSave={onSave}
      saveLabel={editor.mode === "create" ? "Add" : "Save"}
    >
      <label style={labelStyle}>
        Name *
        <input
          type="text"
          value={editor.name}
          onChange={(e) => onChange({ ...editor, name: e.target.value })}
          placeholder="Supplier name"
          style={inputStyle}
          autoFocus
        />
      </label>

      <label style={labelStyle}>
        Contact person
        <input
          type="text"
          value={editor.contact_person}
          onChange={(e) =>
            onChange({ ...editor, contact_person: e.target.value })
          }
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Phone
        <input
          type="tel"
          value={editor.phone}
          onChange={(e) => onChange({ ...editor, phone: e.target.value })}
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        WhatsApp
        <input
          type="tel"
          value={editor.whatsapp}
          onChange={(e) => onChange({ ...editor, whatsapp: e.target.value })}
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Address
        <textarea
          value={editor.address}
          onChange={(e) => onChange({ ...editor, address: e.target.value })}
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>

      <label style={labelStyle}>
        Notes
        <textarea
          value={editor.notes}
          onChange={(e) => onChange({ ...editor, notes: e.target.value })}
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>
    </Modal>
  );
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
};

const theadRowStyle: React.CSSProperties = {
  background: "rgba(251,243,212,0.05)",
  color: FADED,
  textAlign: "left",
  fontSize: "0.875rem",
  letterSpacing: "0.15em",
  textTransform: "uppercase",
};

const thStyle: React.CSSProperties = { padding: "10px 12px" };
const tdStyle: React.CSSProperties = { padding: "10px 12px" };

const sectionHeadingStyle: React.CSSProperties = {
  color: FADED,
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  margin: "0 0 12px",
};

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

const primaryBtnStyle: React.CSSProperties = {
  background: CREAM,
  color: "#1D1D1F",
  border: "none",
  padding: "8px 16px",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: "pointer",
};

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

const hintStyle: React.CSSProperties = {
  color: FADED,
  fontSize: "0.75rem",
  letterSpacing: "0.02em",
  textTransform: "none",
  marginTop: 4,
};
