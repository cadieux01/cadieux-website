"use client";

import { useRouter } from "next/navigation";
import SetupShell, { inputStyle, labelStyle } from "../SetupShell";

export default function AddressStep() {
  const router = useRouter();
  return (
    <SetupShell
      step="address"
      title="Delivery address"
      subtitle="Where should we drop off your bread?"
      render={(draft, update) => {
        const a = draft.address;
        const valid = !!(a.name && a.phone && a.line1 && a.city && a.pincode);
        const set = (k: keyof typeof a) => (e: React.ChangeEvent<HTMLInputElement>) =>
          update({ address: { ...a, [k]: e.target.value } });
        return {
          canContinue: valid,
          onContinue: () => router.push("/subscriptions/setup/review"),
          body: (
            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <label style={labelStyle}>Full name</label>
                <input value={a.name} onChange={set("name")} style={inputStyle} placeholder="Your name" />
              </div>
              <div>
                <label style={labelStyle}>Phone</label>
                <input value={a.phone} onChange={set("phone")} style={inputStyle} placeholder="10-digit mobile" />
              </div>
              <div>
                <label style={labelStyle}>Address line 1</label>
                <input value={a.line1} onChange={set("line1")} style={inputStyle} placeholder="House/flat, building" />
              </div>
              <div>
                <label style={labelStyle}>Address line 2 (optional)</label>
                <input value={a.line2} onChange={set("line2")} style={inputStyle} placeholder="Area, landmark" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>City</label>
                  <input value={a.city} onChange={set("city")} style={inputStyle} placeholder="Visakhapatnam" />
                </div>
                <div>
                  <label style={labelStyle}>Pincode</label>
                  <input value={a.pincode} onChange={set("pincode")} style={inputStyle} placeholder="530000" />
                </div>
              </div>
            </div>
          ),
        };
      }}
    />
  );
}
