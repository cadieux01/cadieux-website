"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CustomerAddress,
  fetchAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} from "@/lib/addresses";

const GRAIN = "url(/grain.svg)";

type FormMode = "view" | "add" | "edit";

const LABEL_PRESETS = ["Home", "Work", "Other"] as const;

export default function AddressesPage() {
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [formMode, setFormMode] = useState<FormMode>("view");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state — mirrors the mobile app's fields on `public.addresses`.
  const [label, setLabel] = useState("Home");
  const [fullName, setFullName] = useState("");
  const [rowPhone, setRowPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);

  useEffect(() => {
    const savedPhone =
      typeof window !== "undefined"
        ? localStorage.getItem("cadieux_phone")
        : null;
    if (savedPhone) {
      setPhone(savedPhone);
      loadAddresses(savedPhone);
    } else {
      setLoading(false);
    }
  }, []);

  async function loadAddresses(phoneNum: string) {
    setLoading(true);
    const addrs = await fetchAddresses(phoneNum);
    setAddresses(addrs);
    setLoading(false);
  }

  function resetForm() {
    setLabel("Home");
    setFullName("");
    setRowPhone(phone ?? "");
    setLine1("");
    setArea("");
    setCity("");
    setPincode("");
    setFormError(null);
    setPageNotice(null);
  }

  function startAdd() {
    resetForm();
    setIsDefault(addresses.length === 0);
    setEditingId(null);
    setFormMode("add");
  }

  function startEdit(addr: CustomerAddress) {
    setLabel(addr.label);
    setFullName(addr.full_name);
    setRowPhone(addr.phone ?? phone ?? "");
    setLine1(addr.line1);
    setArea(addr.area);
    setCity(addr.city);
    setPincode(addr.pincode);
    setIsDefault(addr.is_default);
    setEditingId(addr.id);
    setFormError(null);
    setPageNotice(null);
    setFormMode("edit");
  }

  function cancelForm() {
    setFormMode("view");
    setEditingId(null);
    setFormError(null);
  }

  async function saveAddress() {
    if (!phone) return;
    const labelTrim = label.trim();
    const fullNameTrim = fullName.trim();
    const line1Trim = line1.trim();
    const areaTrim = area.trim();
    const cityTrim = city.trim();

    if (!labelTrim || labelTrim.length > 40) {
      setFormError("Label must be 1-40 characters.");
      return;
    }
    if (fullNameTrim.length < 2) {
      setFormError("Please enter the recipient's full name.");
      return;
    }
    if (line1Trim.length < 3) {
      setFormError("Please enter a street address.");
      return;
    }
    if (areaTrim.length < 2) {
      setFormError("Please enter an area / locality.");
      return;
    }
    if (cityTrim.length < 2) {
      setFormError("Please enter a city.");
      return;
    }
    if (!/^\d{6}$/.test(pincode)) {
      setFormError("Pincode must be 6 digits.");
      return;
    }
    const phoneDigits = rowPhone.replace(/\D/g, "").slice(-10);
    if (phoneDigits && phoneDigits.length !== 10) {
      setFormError("Contact phone must be a 10-digit number.");
      return;
    }
    setFormError(null);

    const payload = {
      label: labelTrim,
      full_name: fullNameTrim,
      phone: phoneDigits || undefined,
      line1: line1Trim,
      area: areaTrim,
      city: cityTrim,
      pincode,
      is_default: isDefault,
    };

    setFormLoading(true);
    try {
      let result: CustomerAddress | null;
      if (formMode === "add") {
        result = await createAddress(phone, payload);
      } else if (formMode === "edit" && editingId) {
        result = await updateAddress(phone, editingId, payload);
      } else {
        result = null;
      }
      if (result) {
        await loadAddresses(phone);
        setFormMode("view");
      } else {
        setFormError(
          "Could not save this address. Check the fields and try again.",
        );
      }
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!phone) return;
    if (!window.confirm("Delete this address?")) return;

    setPageNotice(null);
    const result = await deleteAddress(phone, id);
    if (result.ok) {
      await loadAddresses(phone);
    } else {
      setPageNotice(result.error);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #024628",
    background: "#FBF3D4",
    fontFamily: "var(--font-body)",
    fontSize: 16,
    color: "#024628",
    caretColor: "#024628",
    boxSizing: "border-box",
  };

  const fieldLabelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: 8,
    fontFamily: "var(--font-body)",
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    color: "rgba(2,70,40,0.7)",
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#C0C8CE",
        position: "relative",
        overflowX: "clip",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: GRAIN,
          opacity: 0.04,
          mixBlendMode: "multiply",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <Link
        href="/"
        style={{
          position: "fixed",
          top: "calc(24px + env(safe-area-inset-top))",
          left: "calc(20px + env(safe-area-inset-left))",
          zIndex: 101,
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "#024628",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 16 }}>←</span> Cadieux
      </Link>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding:
            "calc(64px + env(safe-area-inset-top)) clamp(24px,6vw,80px) 120px",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(48px,11vw,88px)",
            fontWeight: 300,
            color: "#024628",
            letterSpacing: "0.02em",
            lineHeight: 1,
          }}
        >
          Addresses
        </h1>
        <p
          style={{
            margin: "8px 0 36px",
            fontFamily: "var(--font-body)",
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.7)",
          }}
        >
          Saved delivery locations
        </p>

        {loading && (
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 15,
              color: "rgba(2,70,40,0.6)",
              letterSpacing: "0.1em",
            }}
          >
            Loading…
          </p>
        )}

        {!loading && !phone && (
          <div>
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 16,
                fontWeight: 200,
                color: "rgba(2,70,40,0.8)",
                lineHeight: 1.7,
                marginBottom: 24,
              }}
            >
              No account found. Place an order from the cart to save your
              addresses.
            </p>
            <Link
              href="/cart"
              style={{
                display: "inline-block",
                padding: "14px 28px",
                border: "1px solid #024628",
                background: "#024628",
                fontFamily: "var(--font-body)",
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: "#FBF3D4",
                textDecoration: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Go to Cart
            </Link>
          </div>
        )}

        {!loading && phone && (
          <>
            {pageNotice && (
              <div
                style={{
                  padding: "12px 14px",
                  border: "1px solid #991B1B",
                  background: "rgba(153,27,27,0.08)",
                  fontFamily: "var(--font-body)",
                  fontSize: 16,
                  fontWeight: 300,
                  color: "#991B1B",
                  letterSpacing: "0.04em",
                  lineHeight: 1.5,
                  marginBottom: 20,
                }}
              >
                {pageNotice}
              </div>
            )}

            {/* Address List */}
            {formMode === "view" && (
              <>
                {addresses.length === 0 ? (
                  <p
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 16,
                      fontWeight: 200,
                      color: "rgba(2,70,40,0.7)",
                      lineHeight: 1.7,
                      marginBottom: 24,
                    }}
                  >
                    No addresses yet. Place an order to save your delivery
                    details, or add one now.
                  </p>
                ) : (
                  <div style={{ marginBottom: 32 }}>
                    {addresses.map((addr) => (
                      <section
                        key={addr.id}
                        style={{
                          position: "relative",
                          padding: "20px 20px 18px",
                          border: "1px solid #024628",
                          background: "#FBF3D4",
                          marginBottom: 16,
                        }}
                      >
                        {/* Label Badge */}
                        <div
                          style={{
                            position: "absolute",
                            top: 12,
                            left: 20,
                            display: "inline-block",
                            padding: "4px 10px",
                            background: "#024628",
                            borderRadius: 3,
                            fontFamily: "var(--font-body)",
                            fontSize: 14,
                            fontWeight: 500,
                            letterSpacing: "0.2em",
                            textTransform: "uppercase",
                            color: "#FBF3D4",
                          }}
                        >
                          {addr.label}
                          {addr.is_default && " • Default"}
                        </div>

                        {/* Address Content */}
                        <div style={{ paddingTop: 24, paddingRight: 120 }}>
                          <p
                            style={{
                              margin: "0 0 6px",
                              fontFamily: "var(--font-body)",
                              fontSize: 16,
                              fontWeight: 400,
                              color: "#024628",
                              letterSpacing: "0.03em",
                            }}
                          >
                            {addr.full_name}
                          </p>
                          <p
                            style={{
                              margin: "0 0 4px",
                              fontFamily: "var(--font-body)",
                              fontSize: 16,
                              fontWeight: 300,
                              color: "#024628",
                              letterSpacing: "0.04em",
                              lineHeight: 1.5,
                            }}
                          >
                            {addr.line1}
                            {addr.area ? `, ${addr.area}` : ""}
                          </p>
                          <p
                            style={{
                              margin: "0 0 4px",
                              fontFamily: "var(--font-body)",
                              fontSize: 16,
                              fontWeight: 300,
                              color: "rgba(2,70,40,0.75)",
                              letterSpacing: "0.03em",
                            }}
                          >
                            {addr.city}
                            {addr.pincode && `, ${addr.pincode}`}
                          </p>
                          {addr.phone && (
                            <p
                              style={{
                                margin: "6px 0 0",
                                fontFamily: "var(--font-body)",
                                fontSize: 16,
                                fontWeight: 300,
                                color: "rgba(2,70,40,0.6)",
                                letterSpacing: "0.05em",
                              }}
                            >
                              {addr.phone}
                            </p>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div
                          style={{
                            position: "absolute",
                            top: 12,
                            right: 12,
                            display: "flex",
                            gap: 6,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => startEdit(addr)}
                            style={{
                              background: "transparent",
                              border: "1px solid #024628",
                              padding: "4px 10px",
                              cursor: "pointer",
                              fontFamily: "var(--font-body)",
                              fontSize: 14,
                              fontWeight: 500,
                              letterSpacing: "0.3em",
                              textTransform: "uppercase",
                              color: "#024628",
                              WebkitTapHighlightColor: "transparent",
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(addr.id)}
                            style={{
                              background: "transparent",
                              border: "1px solid #991B1B",
                              padding: "4px 10px",
                              cursor: "pointer",
                              fontFamily: "var(--font-body)",
                              fontSize: 14,
                              fontWeight: 500,
                              letterSpacing: "0.3em",
                              textTransform: "uppercase",
                              color: "#991B1B",
                              WebkitTapHighlightColor: "transparent",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </section>
                    ))}
                  </div>
                )}

                {/* Add Address Button */}
                <button
                  type="button"
                  onClick={startAdd}
                  style={{
                    display: "inline-block",
                    padding: "14px 28px",
                    border: "1px solid #024628",
                    background: "#024628",
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: "0.4em",
                    textTransform: "uppercase",
                    color: "#FBF3D4",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  + Add Address
                </button>
              </>
            )}

            {/* Add/Edit Form */}
            {(formMode === "add" || formMode === "edit") && (
              <section
                style={{
                  padding: "24px 22px",
                  border: "1px solid #024628",
                  background: "#FBF3D4",
                  marginBottom: 24,
                }}
              >
                <h2
                  style={{
                    margin: "0 0 20px",
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: 400,
                    letterSpacing: "0.1em",
                    color: "#024628",
                  }}
                >
                  {formMode === "add" ? "Add New Address" : "Edit Address"}
                </h2>

                <div style={{ marginBottom: 16 }}>
                  <label style={fieldLabelStyle}>Label</label>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    {LABEL_PRESETS.map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setLabel(l)}
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          border: "1px solid #024628",
                          background:
                            label.toLowerCase() === l.toLowerCase()
                              ? "#024628"
                              : "transparent",
                          fontFamily: "var(--font-body)",
                          fontSize: 14,
                          fontWeight: 500,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          color:
                            label.toLowerCase() === l.toLowerCase()
                              ? "#FBF3D4"
                              : "#024628",
                          cursor: "pointer",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value.slice(0, 40))}
                    placeholder="Or type a custom label"
                    maxLength={40}
                    style={inputStyle}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={fieldLabelStyle}>Recipient full name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Who's receiving this?"
                    autoComplete="name"
                    style={inputStyle}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={fieldLabelStyle}>
                    Street address (house / building)
                  </label>
                  <input
                    type="text"
                    value={line1}
                    onChange={(e) => setLine1(e.target.value)}
                    placeholder="Flat / house no, street"
                    autoComplete="address-line1"
                    style={inputStyle}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={fieldLabelStyle}>Area / locality</label>
                  <input
                    type="text"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    placeholder="Neighbourhood, landmark"
                    autoComplete="address-line2"
                    style={inputStyle}
                  />
                </div>

                <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={fieldLabelStyle}>City</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="City"
                      autoComplete="address-level2"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={fieldLabelStyle}>Pincode</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={pincode}
                      onChange={(e) =>
                        setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      placeholder="530045"
                      autoComplete="postal-code"
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={fieldLabelStyle}>Contact phone (optional)</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={rowPhone}
                    onChange={(e) =>
                      setRowPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    placeholder="10-digit mobile"
                    autoComplete="tel-national"
                    maxLength={10}
                    style={inputStyle}
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      fontFamily: "var(--font-body)",
                      fontSize: 16,
                      fontWeight: 300,
                      color: "#024628",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)}
                    />
                    Set as default address
                  </label>
                </div>

                {formError && (
                  <div
                    style={{
                      padding: "10px 12px",
                      border: "1px solid #991B1B",
                      background: "rgba(153,27,27,0.08)",
                      fontFamily: "var(--font-body)",
                      fontSize: 16,
                      fontWeight: 300,
                      color: "#991B1B",
                      letterSpacing: "0.04em",
                      lineHeight: 1.5,
                      marginBottom: 16,
                    }}
                  >
                    {formError}
                  </div>
                )}

                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    type="button"
                    onClick={saveAddress}
                    disabled={formLoading}
                    style={{
                      flex: 1,
                      padding: "12px 20px",
                      border: "1px solid #024628",
                      background: "#024628",
                      fontFamily: "var(--font-body)",
                      fontSize: 14,
                      fontWeight: 500,
                      letterSpacing: "0.3em",
                      textTransform: "uppercase",
                      color: "#FBF3D4",
                      cursor: formLoading ? "not-allowed" : "pointer",
                      opacity: formLoading ? 0.5 : 1,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {formLoading
                      ? "Saving…"
                      : formMode === "add"
                        ? "Save Address"
                        : "Update Address"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelForm}
                    style={{
                      padding: "12px 20px",
                      border: "1px solid #024628",
                      background: "transparent",
                      fontFamily: "var(--font-body)",
                      fontSize: 14,
                      fontWeight: 500,
                      letterSpacing: "0.3em",
                      textTransform: "uppercase",
                      color: "#024628",
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
