"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CustomerAddress,
  LABEL_NAMES,
  fetchAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} from "@/lib/addresses";

const GRAIN = "url(/grain.svg)";

type FormMode = "view" | "add" | "edit";

export default function AddressesPage() {
  const router = useRouter();
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [formMode, setFormMode] = useState<FormMode>("view");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [label, setLabel] = useState<"home" | "work" | "other">("home");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [formLoading, setFormLoading] = useState(false);

  // Initialize phone and fetch addresses
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

  function startAdd() {
    setLabel("home");
    setAddressLine("");
    setCity("");
    setState("");
    setPincode("");
    setIsDefault(addresses.length === 0); // Default if first address
    setEditingId(null);
    setFormMode("add");
  }

  function startEdit(addr: CustomerAddress) {
    setLabel(addr.label);
    setAddressLine(addr.address_line);
    setCity(addr.city);
    setState(addr.state || "");
    setPincode(addr.pincode || "");
    setIsDefault(addr.is_default);
    setEditingId(addr.id);
    setFormMode("edit");
  }

  function cancelForm() {
    setFormMode("view");
    setEditingId(null);
  }

  async function saveAddress() {
    if (!phone || !addressLine || !city) return;

    setFormLoading(true);
    try {
      if (formMode === "add") {
        const newAddr = await createAddress(phone, {
          label,
          address_line: addressLine,
          city,
          state: state || null,
          pincode: pincode || null,
          is_default: isDefault,
        });
        if (newAddr) {
          await loadAddresses(phone);
          setFormMode("view");
        }
      } else if (formMode === "edit" && editingId) {
        const updated = await updateAddress(phone, editingId, {
          label,
          address_line: addressLine,
          city,
          state: state || null,
          pincode: pincode || null,
          is_default: isDefault,
        });
        if (updated) {
          await loadAddresses(phone);
          setFormMode("view");
        }
      }
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!phone) return;
    if (!window.confirm("Delete this address?")) return;

    const success = await deleteAddress(phone, id);
    if (success) {
      await loadAddresses(phone);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #024628",
    background: "#FBF3D4",
    fontFamily: "var(--font-body)",
    fontSize: 13,
    color: "#024628",
    caretColor: "#024628",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: 8,
    fontFamily: "var(--font-body)",
    fontSize: 11,
    fontWeight: 300,
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
          fontSize: 10,
          fontWeight: 200,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "#024628",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "100px clamp(24px,6vw,80px) 120px",
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
            fontSize: 11,
            fontWeight: 200,
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
                fontSize: 15,
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
                fontSize: 11,
                fontWeight: 300,
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
            {/* Address List */}
            {formMode === "view" && (
              <>
                {addresses.length === 0 ? (
                  <p
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 15,
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
                            fontSize: 10,
                            fontWeight: 300,
                            letterSpacing: "0.2em",
                            textTransform: "uppercase",
                            color: "#FBF3D4",
                          }}
                        >
                          {LABEL_NAMES[addr.label]}
                          {addr.is_default && " • Default"}
                        </div>

                        {/* Address Content */}
                        <div style={{ paddingTop: 24, paddingRight: 120 }}>
                          <p
                            style={{
                              margin: "0 0 8px",
                              fontFamily: "var(--font-body)",
                              fontSize: 15,
                              fontWeight: 300,
                              color: "#024628",
                              letterSpacing: "0.04em",
                            }}
                          >
                            {addr.address_line}
                          </p>
                          <p
                            style={{
                              margin: "0 0 4px",
                              fontFamily: "var(--font-body)",
                              fontSize: 13,
                              fontWeight: 300,
                              color: "rgba(2,70,40,0.75)",
                              letterSpacing: "0.03em",
                            }}
                          >
                            {addr.city}
                            {addr.pincode && `, ${addr.pincode}`}
                          </p>
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
                              fontSize: 9,
                              fontWeight: 400,
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
                              fontSize: 9,
                              fontWeight: 400,
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
                    fontSize: 11,
                    fontWeight: 400,
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
                  <label style={labelStyle}>Label</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {(["home", "work", "other"] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setLabel(l)}
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          border: "1px solid #024628",
                          background: label === l ? "#024628" : "transparent",
                          fontFamily: "var(--font-body)",
                          fontSize: 11,
                          fontWeight: 400,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          color: label === l ? "#FBF3D4" : "#024628",
                          cursor: "pointer",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        {LABEL_NAMES[l]}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Address</label>
                  <input
                    type="text"
                    value={addressLine}
                    onChange={(e) => setAddressLine(e.target.value)}
                    placeholder="Enter street address"
                    style={inputStyle}
                  />
                </div>

                <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>City</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="City"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Pincode</label>
                    <input
                      type="text"
                      value={pincode}
                      onChange={(e) => setPincode(e.target.value)}
                      placeholder="Pincode"
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      fontFamily: "var(--font-body)",
                      fontSize: 12,
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
                      fontSize: 11,
                      fontWeight: 400,
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
                      fontSize: 11,
                      fontWeight: 400,
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
