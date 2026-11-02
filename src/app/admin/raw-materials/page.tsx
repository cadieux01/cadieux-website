"use client";

// /admin/raw-materials — list, create, edit and deactivate raw materials.
//
// Scope is deliberately narrow: NO batch entry, NO stock movements, NO charts.
// Stock appears here read-only, straight from the raw_material_stock view.
//
// THERE IS NO DELETE BUTTON. production_batch_materials references
// raw_materials ON DELETE RESTRICT, so anything ever consumed cannot be
// deleted — and the row is the only record of what a past batch was made
// from. Deactivating hides a material from new entry and keeps the history.

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  BORDER,
  CREAM,
  CREAM_SOFT,
  DANGER_SOFT,
  errorBox,
  FADED,
  Field,
  ghostBtn,
  GOLD,
  linkBtn,
  modalCard,
  modalTitle,
  modalWrap,
  primaryBtn,
  StatusPill,
  tabBtn,
  td,
  th,
} from "@/components/admin/kitchen-ui";
import Select from "@/components/ui/Select";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import {
  DEACTIVATE_NOTE,
  FIELD_LIMITS,
  formatQty,
  RAW_MATERIAL_UNITS,
  REORDER_LABEL,
  reorderState,
  UNIT_LOCKED_REASON,
  type RawMaterialAdminRow,
  type ReorderState,
  type VendorRow,
} from "@/lib/raw-materials";

type TabKey = "active" | "inactive" | "all";

const TABS: { key: TabKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "all", label: "All" },
];

/**
 * The three reorder states must be three VISUALLY distinct things, and
 * "undecided" must not read as reassurance.
 *
 * - below     → red, filled. Something to act on.
 * - ok        → quiet cream. Deliberately the least eye-catching.
 * - undecided → gold, dashed border, and the words "No level set". Dashed
 *               because every other border on this screen is solid, so it
 *               reads as incomplete rather than as a third severity. It is
 *               NOT green, NOT a tick, and it never says "ok".
 */
const REORDER_STYLE: Record<ReorderState, React.CSSProperties> = {
  below: {
    color: DANGER_SOFT,
    border: "1px solid rgba(239,68,68,0.55)",
    background: "rgba(239,68,68,0.12)",
  },
  ok: {
    color: CREAM_SOFT,
    border: `1px solid ${BORDER}`,
    background: "transparent",
  },
  undecided: {
    color: GOLD,
    border: `1px dashed ${GOLD}`,
    background: "transparent",
  },
};

type FormState = {
  code: string;
  name: string;
  unit: string;
  category: string;
  reorder_level: string;
  lead_time_days: string;
  vendor_id: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  unit: RAW_MATERIAL_UNITS[0],
  category: "",
  reorder_level: "",
  lead_time_days: "",
  vendor_id: "",
  notes: "",
};

export default function AdminRawMaterialsPage() {
  const [materials, setMaterials] = useState<RawMaterialAdminRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("active");

  const [editing, setEditing] = useState<RawMaterialAdminRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Vendors come along for the picker. Inactive ones are included so an
      // existing material still shows the vendor it actually points at rather
      // than falling back to "None" and quietly clearing it on next save.
      const [mats, vends] = await Promise.all([
        adminFetch<{ materials: RawMaterialAdminRow[] }>(
          "/api/admin/raw-materials?include_inactive=1",
        ),
        adminFetch<{ vendors: VendorRow[] }>(
          "/api/admin/vendors?include_inactive=1",
        ),
      ]);
      setMaterials(mats.materials ?? []);
      setVendors(vends.vendors ?? []);
    } catch (e) {
      setError(
        e instanceof AdminFetchError
          ? e.message
          : "Could not load raw materials.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    if (tab === "all") return materials;
    const wantActive = tab === "active";
    return materials.filter((m) => m.is_active === wantActive);
  }, [materials, tab]);

  const vendorOptions = useMemo(
    () => [
      { value: "", label: "No vendor" },
      ...vendors.map((v) => ({
        value: v.id,
        label: v.is_active ? v.name : `${v.name} (inactive)`,
      })),
    ],
    [vendors],
  );

  const unitOptions = useMemo(
    () => RAW_MATERIAL_UNITS.map((u) => ({ value: u, label: u })),
    [],
  );

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function openEdit(m: RawMaterialAdminRow) {
    setCreating(false);
    setEditing(m);
    setForm({
      code: m.code,
      name: m.name,
      unit: m.unit,
      category: m.category ?? "",
      // Blank, not "0", when the level is unset — the form must be able to
      // round-trip the UNDECIDED state without inventing a decision.
      reorder_level:
        m.reorder_level === null || m.reorder_level === undefined
          ? ""
          : String(m.reorder_level),
      lead_time_days:
        m.lead_time_days === null || m.lead_time_days === undefined
          ? ""
          : String(m.lead_time_days),
      vendor_id: m.vendor_id ?? "",
      notes: m.notes ?? "",
    });
    setFormError(null);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setFormError(null);
  }

  // The DB rule, respected rather than re-implemented: the composite FK
  // (material_id, unit) → raw_materials(id, unit) is ON UPDATE RESTRICT, so a
  // consumed material's unit cannot change. The server answers `unit_locked`
  // per row; the field is disabled from that answer alone, never from a guess
  // about stock or movement counts.
  //
  // FAILS CLOSED: only an explicit `false` unlocks the field. An absent or
  // undefined `unit_locked` — an older payload, a route that drops nulls via
  // conditional spread, a merge read that came back short — means nobody has
  // answered the question, and the safe reading of silence is LOCKED. `=== true`
  // here would have rendered the field editable on a consumed material and sent
  // `unit` to a save Postgres then refuses.
  //
  // Creating is the one unlocked case by definition: a material that does not
  // exist yet cannot have been consumed.
  const unitLocked = editing !== null && editing.unit_locked !== false;

  async function save() {
    if (!form.code.trim()) {
      setFormError("Code is required.");
      return;
    }
    if (!form.name.trim()) {
      setFormError("Name is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        code: form.code,
        name: form.name,
        category: form.category,
        reorder_level: form.reorder_level,
        lead_time_days: form.lead_time_days,
        vendor_id: form.vendor_id,
        notes: form.notes,
      };
      // Omit `unit` entirely when it is locked. Sending the unchanged value
      // would be harmless today, but omitting it means a future server that
      // treats the key's presence as intent still cannot be asked to break
      // the constraint.
      if (!unitLocked) payload.unit = form.unit;

      if (editing) {
        await adminFetch(`/api/admin/raw-materials/${editing.material_id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await adminFetch("/api/admin/raw-materials", {
          method: "POST",
          body: JSON.stringify({ ...payload, unit: form.unit }),
        });
      }
      closeForm();
      await load();
    } catch (e) {
      setFormError(
        e instanceof AdminFetchError
          ? e.message
          : "Could not save the material.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function setActive(m: RawMaterialAdminRow, next: boolean) {
    setError(null);
    try {
      await adminFetch(`/api/admin/raw-materials/${m.material_id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: next }),
      });
      await load();
    } catch (e) {
      setError(
        e instanceof AdminFetchError
          ? e.message
          : "Could not change the material.",
      );
    }
  }

  const formOpen = creating || editing !== null;

  return (
    <AdminShell
      title="Raw Materials"
      subtitle="What the kitchen buys and consumes. Stock is read-only here."
      actions={
        <button onClick={openCreate} style={primaryBtn}>
          Add material
        </button>
      }
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              ...tabBtn,
              borderColor: tab === t.key ? GOLD : BORDER,
              color: tab === t.key ? CREAM : FADED,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}

      {loading ? (
        <p style={{ color: FADED, fontSize: 13 }}>Loading…</p>
      ) : error ? (
        // NO EMPTY-STATE COPY WHEN THE LOAD FAILED. `materials` is [] after a
        // failed load exactly as it is on a genuinely empty table, so the
        // "none yet" sentence would assert there are no materials when the
        // truth is that nobody knows. The error box above is the whole answer.
        null
      ) : shown.length === 0 ? (
        <p style={{ color: FADED, fontSize: 13, lineHeight: 1.7 }}>
          {materials.length === 0
            ? "No raw materials yet. Add the first one to start tracking what the kitchen buys."
            : "No materials on this tab."}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "Code",
                  "Name",
                  "Unit",
                  "In stock",
                  "Reorder level",
                  "Vendor",
                  "Lead time",
                  "Status",
                  "",
                ].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const state = reorderState(m.needs_reorder);
                return (
                  <tr key={m.material_id}>
                    <td style={{ ...td, color: CREAM, whiteSpace: "nowrap" }}>
                      {m.code}
                    </td>
                    <td style={td}>
                      <span style={{ color: CREAM }}>{m.name}</span>
                      {m.category ? (
                        <div
                          style={{ color: FADED, fontSize: 11, marginTop: 3 }}
                        >
                          {m.category}
                        </div>
                      ) : null}
                    </td>
                    <td style={td}>{m.unit}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span style={{ color: CREAM }}>
                        {formatQty(m.current_qty)}
                      </span>{" "}
                      <span style={{ color: FADED, fontSize: 11 }}>
                        {m.unit}
                      </span>
                      <div
                        style={{
                          display: "inline-block",
                          marginLeft: 10,
                          padding: "2px 8px",
                          fontSize: 10,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          ...REORDER_STYLE[state],
                        }}
                      >
                        {REORDER_LABEL[state]}
                      </div>
                    </td>
                    <td style={td}>
                      {state === "undecided" ? (
                        <span style={{ color: GOLD, fontSize: 12 }}>
                          Not set
                        </span>
                      ) : (
                        formatQty(m.reorder_level)
                      )}
                    </td>
                    <td style={td}>{m.vendor_name ?? "—"}</td>
                    <td style={td}>
                      {m.lead_time_days === null
                        ? "—"
                        : `${m.lead_time_days} d`}
                    </td>
                    <td style={td}>
                      <StatusPill active={m.is_active} />
                    </td>
                    <td
                      style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}
                    >
                      <button onClick={() => openEdit(m)} style={linkBtn}>
                        Edit
                      </button>
                      <button
                        onClick={() => void setActive(m, !m.is_active)}
                        style={{ ...linkBtn, marginLeft: 14 }}
                      >
                        {m.is_active ? "Deactivate" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {formOpen ? (
        <div style={modalWrap} onClick={closeForm}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <h2 style={modalTitle}>
              {editing ? "Edit material" : "Add material"}
            </h2>

            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Field
                  label="Code"
                  required
                  value={form.code}
                  maxLength={FIELD_LIMITS.code}
                  onChange={(v) => setForm({ ...form, code: v })}
                  hint="Stored exactly as you type it."
                />
              </div>
              <div style={{ flex: 2 }}>
                <Field
                  label="Name"
                  required
                  value={form.name}
                  maxLength={FIELD_LIMITS.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <span
                style={{
                  display: "block",
                  color: FADED,
                  fontSize: 10,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Unit *
              </span>
              <Select
                value={form.unit}
                options={unitOptions}
                disabled={unitLocked}
                onChange={(v) => setForm({ ...form, unit: v })}
              />
              {unitLocked ? (
                <p
                  style={{
                    color: GOLD,
                    fontSize: 11,
                    lineHeight: 1.6,
                    marginTop: 8,
                  }}
                >
                  {UNIT_LOCKED_REASON}
                </p>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Field
                  label="Category"
                  value={form.category}
                  maxLength={FIELD_LIMITS.category}
                  onChange={(v) => setForm({ ...form, category: v })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <Field
                  label="Reorder level"
                  type="number"
                  value={form.reorder_level}
                  placeholder="Leave blank if undecided"
                  onChange={(v) => setForm({ ...form, reorder_level: v })}
                  hint="Blank means no level set — the board shows that as its own state, not as 'in stock'."
                />
              </div>
              <div style={{ flex: 1 }}>
                <Field
                  label="Lead time (days)"
                  type="number"
                  value={form.lead_time_days}
                  onChange={(v) => setForm({ ...form, lead_time_days: v })}
                />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <span
                style={{
                  display: "block",
                  color: FADED,
                  fontSize: 10,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Vendor
              </span>
              <Select
                value={form.vendor_id}
                options={vendorOptions}
                onChange={(v) => setForm({ ...form, vendor_id: v })}
              />
            </div>

            <Field
              label="Notes"
              value={form.notes}
              multiline
              onChange={(v) => setForm({ ...form, notes: v })}
            />

            {formError ? <div style={errorBox}>{formError}</div> : null}

            {editing?.is_active ? (
              <p style={{ color: FADED, fontSize: 11, lineHeight: 1.6 }}>
                {DEACTIVATE_NOTE}
              </p>
            ) : null}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 12,
                marginTop: 20,
              }}
            >
              <button onClick={closeForm} style={ghostBtn} disabled={saving}>
                Cancel
              </button>
              <button
                onClick={() => void save()}
                style={primaryBtn}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
