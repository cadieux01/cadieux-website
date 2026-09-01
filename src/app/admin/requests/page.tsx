"use client";

// Combined "Requests" admin page. Folds the two previously separate queues
// into one place under two tabs, so there is a single sidebar entry and one
// place to check:
//   • Serviceability Requests — customer "deliver here please" requests from
//     unserviceable pincodes (was /admin/delivery-requests).
//   • Order Changes — COD order delivery + item change-requests (was
//     /admin/order-changes).
//
// Each tab renders its original panel component unchanged (same state,
// polling, and API calls); only the AdminShell wrapper is shared here.

import { useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { OrderChangesPanel } from "./OrderChangesPanel";
import { ServiceabilityPanel } from "./ServiceabilityPanel";

type Tab = "serviceability" | "order-changes";

const TABS: { value: Tab; label: string; subtitle: string }[] = [
  {
    value: "serviceability",
    label: "Serviceability Requests",
    subtitle: "Pincode serviceability requests",
  },
  {
    value: "order-changes",
    label: "Order Changes",
    subtitle: "COD delivery & item change queue",
  },
];

const CREAM = "#FBF3D4";

export default function RequestsPage() {
  const [tab, setTab] = useState<Tab>("serviceability");
  const active = TABS.find((t) => t.value === tab) ?? TABS[0];

  return (
    <AdminShell title="Requests" subtitle={active.subtitle}>
      <div
        role="tablist"
        aria-label="Request queues"
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 24,
          borderBottom: "1px solid rgba(251,243,212,0.18)",
          paddingBottom: 0,
        }}
      >
        {TABS.map((t) => {
          const isActive = t.value === tab;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.value)}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.22em",
                padding: "10px 18px",
                background: isActive ? "rgba(251,243,212,0.12)" : "transparent",
                border: "none",
                borderBottom: `2px solid ${isActive ? CREAM : "transparent"}`,
                color: isActive ? CREAM : "rgba(251,243,212,0.55)",
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "serviceability" ? (
        <ServiceabilityPanel />
      ) : (
        <OrderChangesPanel />
      )}
    </AdminShell>
  );
}
