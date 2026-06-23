"use client";

import React, { useState, useEffect } from "react";
import { CustomerAddress, LABEL_NAMES, fetchAddresses } from "@/lib/addresses";

type CheckoutAddressSelectorProps = {
  phone: string;
  onAddressSelected: (address: CustomerAddress | null) => void;
  onAddNewClick: () => void;
};

export default function CheckoutAddressSelector({
  phone,
  onAddressSelected,
  onAddNewClick,
}: CheckoutAddressSelectorProps) {
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load addresses on mount
  useEffect(() => {
    (async () => {
      const addrs = await fetchAddresses(phone);
      setAddresses(addrs);
      const defaultAddr = addrs.find((a) => a.is_default);
      if (defaultAddr) {
        setSelectedId(defaultAddr.id);
        onAddressSelected(defaultAddr);
      } else if (addrs.length > 0) {
        setSelectedId(addrs[0].id);
        onAddressSelected(addrs[0]);
      }
      setLoading(false);
    })();
  }, [phone, onAddressSelected]);

  function handleSelect(id: string) {
    setSelectedId(id);
    const selected = addresses.find((a) => a.id === id);
    if (selected) {
      onAddressSelected(selected);
    }
  }

  if (loading) {
    return (
      <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "rgba(240,223,200,0.4)" }}>
        Loading addresses…
      </p>
    );
  }

  if (addresses.length === 0) {
    return null; // Checkout will show inline address form
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <label
        style={{
          display: "block",
          marginBottom: 12,
          fontFamily: "var(--font-body)",
          fontSize: 11,
          fontWeight: 300,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "rgba(240,223,200,0.6)",
        }}
      >
        Select Delivery Address
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {addresses.map((addr) => (
          <label
            key={addr.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "12px 12px",
              border:
                selectedId === addr.id
                  ? "1px solid #93c5fd"
                  : "1px solid rgba(240,223,200,0.15)",
              background:
                selectedId === addr.id
                  ? "rgba(67,105,178,0.1)"
                  : "rgba(240,223,200,0.02)",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <input
              type="radio"
              name="delivery_address"
              value={addr.id}
              checked={selectedId === addr.id}
              onChange={() => handleSelect(addr.id)}
              style={{ marginTop: 3, cursor: "pointer" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  margin: "0 0 4px",
                  fontFamily: "var(--font-body)",
                  fontSize: 12,
                  fontWeight: 300,
                  color: "#FBF3D4",
                  letterSpacing: "0.05em",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 6px",
                    marginRight: 6,
                    background:
                      addr.label === "home"
                        ? "rgba(2,70,40,0.3)"
                        : addr.label === "work"
                          ? "rgba(67,105,178,0.2)"
                          : "rgba(100,100,100,0.2)",
                    fontSize: 9,
                    fontWeight: 300,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color:
                      addr.label === "home"
                        ? "#7ee8c1"
                        : addr.label === "work"
                          ? "#93c5fd"
                          : "rgba(200,200,200,0.7)",
                  }}
                >
                  {LABEL_NAMES[addr.label]}
                </span>
              </p>
              <p
                style={{
                  margin: 0,
                  fontFamily: "var(--font-body)",
                  fontSize: 12,
                  fontWeight: 200,
                  color: "rgba(240,223,200,0.65)",
                  lineHeight: 1.5,
                }}
              >
                {addr.address_line}
              </p>
              {(addr.city || addr.pincode) && (
                <p
                  style={{
                    margin: "4px 0 0",
                    fontFamily: "var(--font-body)",
                    fontSize: 11,
                    fontWeight: 200,
                    color: "rgba(240,223,200,0.5)",
                  }}
                >
                  {addr.city}
                  {addr.pincode && `, ${addr.pincode}`}
                </p>
              )}
            </div>
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={onAddNewClick}
        style={{
          marginTop: 12,
          padding: "8px 12px",
          border: "1px solid rgba(200,144,58,0.35)",
          background: "transparent",
          fontFamily: "var(--font-body)",
          fontSize: 10,
          fontWeight: 300,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "rgba(200,144,58,0.7)",
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        + Use Different Address
      </button>
    </div>
  );
}
