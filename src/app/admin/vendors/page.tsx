"use client";

// /admin/vendors — list, create, edit and deactivate vendors.
//
// Scope is deliberately narrow: no purchase entry, no spend history, no
// charts. A vendor here is reference data that /admin/raw-materials points at.
//
// THERE IS NO DELETE BUTTON, AND THAT IS THE DESIGN.
// raw_materials.vendor_id is ON DELETE RESTRICT, so a vendor with materials
// cannot be deleted at all, and one without them still records who supplied
// what. Deactivating keeps every past row readable and only hides the vendor
// from new entry.

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  BORDER,
  CREAM,
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
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import {
  DEACTIVATE_NOTE,
  FIELD_LIMITS,
  type VendorRow,
} from "@/lib/raw-materials";

type TabKey = "active" | "inactive" | "all";

const TABS: { key: TabKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "all", label: "All" },
];

type FormState = {
  name: string;
  contact_person: string;
  phone: string;
  whatsapp: string;
  address: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  contact_person: "",
  phone: "",
  whatsapp: "",
  address: "",
  notes: "",
};

export default function AdminVendorsPage() {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("active");

  const [editing, setEditing] = useState<VendorRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Always load every vendor and filter on the client: the list is reference
  // data of a few dozen rows, and switching tabs without a round trip keeps
  // the Inactive tab honest about what deactivating just did.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<{ vendors: VendorRow[] }>(
        "/api/admin/vendors?include_inactive=1",
      );
      setVendors(res.vendors ?? []);
    } catch (e) {
      setError(
        e instanceof AdminFetchError ? e.message : "Could not load vendors.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    if (tab === "all") return vendors;
    const wantActive = tab === "active";
    return vendors.filter((v) => v.is_active === wantActive);
  }, [vendors, tab]);

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function openEdit(v: VendorRow) {
    setCreating(false);
    setEditing(v);
    setForm({
      name: v.name,
      contact_person: v.contact_person ?? "",
      phone: v.phone ?? "",
      whatsapp: v.whatsapp ?? "",
      address: v.address ?? "",
      notes: v.notes ?? "",
    });
    setFormError(null);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setFormError(null);
  }

  async function save() {
    if (!form.name.trim()) {
      setFormError("Name is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        contact_person: form.contact_person,
        phone: form.phone,
        whatsapp: form.whatsapp,
        address: form.address,
        notes: form.notes,
      };
      if (editing) {
        await adminFetch(`/api/admin/vendors/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await adminFetch("/api/admin/vendors", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      closeForm();
      await load();
    } catch (e) {
      setFormError(
        e instanceof AdminFetchError ? e.message : "Could not save the vendor.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function setActive(v: VendorRow, next: boolean) {
    setError(null);
    try {
      await adminFetch(`/api/admin/vendors/${v.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: next }),
      });
      await load();
    } catch (e) {
      setError(
        e instanceof AdminFetchError
          ? e.message
          : "Could not change the vendor.",
      );
    }
  }

  const formOpen = creating || editing !== null;

  return (
    <AdminShell
      title="Vendors"
      subtitle="Who supplies the kitchen. Reference data for raw materials."
      actions={
        <button onClick={openCreate} style={primaryBtn}>
          Add vendor
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
        // See the same branch in ../raw-materials/page.tsx: after a failed
        // load `vendors` is [] just as it is on an empty table, so the
        // "none yet" sentence would claim a fact nobody has.
        null
      ) : shown.length === 0 ? (
        <p style={{ color: FADED, fontSize: 13, lineHeight: 1.7 }}>
          {vendors.length === 0
            ? "No vendors yet. Add the first one to start recording who supplies each raw material."
            : "No vendors on this tab."}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name", "Contact", "Phone", "WhatsApp", "Status", ""].map(
                  (h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr key={v.id}>
                  <td style={td}>
                    <span style={{ color: CREAM }}>{v.name}</span>
                    {v.address ? (
                      <div style={{ color: FADED, fontSize: 11, marginTop: 3 }}>
                        {v.address}
                      </div>
                    ) : null}
                  </td>
                  <td style={td}>{v.contact_person ?? "—"}</td>
                  <td style={td}>{v.phone ?? "—"}</td>
                  <td style={td}>{v.whatsapp ?? "—"}</td>
                  <td style={td}>
                    <StatusPill active={v.is_active} />
                  </td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => openEdit(v)} style={linkBtn}>
                      Edit
                    </button>
                    <button
                      onClick={() => void setActive(v, !v.is_active)}
                      style={{ ...linkBtn, marginLeft: 14 }}
                    >
                      {v.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen ? (
        <div style={modalWrap} onClick={closeForm}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <h2 style={modalTitle}>{editing ? "Edit vendor" : "Add vendor"}</h2>

            <Field
              label="Name"
              required
              value={form.name}
              maxLength={FIELD_LIMITS.name}
              onChange={(v) => setForm({ ...form, name: v })}
            />
            <Field
              label="Contact person"
              value={form.contact_person}
              maxLength={FIELD_LIMITS.contactPerson}
              onChange={(v) => setForm({ ...form, contact_person: v })}
            />
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Field
                  label="Phone"
                  value={form.phone}
                  maxLength={FIELD_LIMITS.phone}
                  onChange={(v) => setForm({ ...form, phone: v })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <Field
                  label="WhatsApp"
                  value={form.whatsapp}
                  maxLength={FIELD_LIMITS.whatsapp}
                  onChange={(v) => setForm({ ...form, whatsapp: v })}
                />
              </div>
            </div>
            <Field
              label="Address"
              value={form.address}
              multiline
              onChange={(v) => setForm({ ...form, address: v })}
            />
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

