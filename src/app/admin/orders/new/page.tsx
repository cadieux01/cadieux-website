"use client";

// Manual admin order-entry ("Register New Order") — Phase 3b.
//
// This page is a thin wrapper around the shared <RegisterOrderForm/>
// used by BOTH the admin dashboard here AND the team-PIN link at
// /register. The one-time path is byte-identical to a customer-placed
// order (shared prepareOneTimeOrder + orderInsertColumns). The
// subscription path goes through the same shared helpers as the public
// checkout multi-variant branch, so an admin-registered subscription
// writes byte-identical rows to a customer-created one.
//
// Customer linking is the same in both modes: phone → 10-digit local →
// upsert public.customers by customers_phone_unique → never overwrite
// existing name/city. Both endpoints populate BOTH customer_id AND
// customer_phone so the tracking page / mobile app history match on
// the phone LIKE fallback too.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { RegisterOrderForm } from "@/components/RegisterOrderForm";

export default function RegisterNewOrderPage() {
  const router = useRouter();

  const onSuccessOneTime = useCallback(() => {
    // Small delay so the operator sees the success banner before the
    // route changes.
    setTimeout(() => router.push("/admin/orders"), 900);
  }, [router]);

  const onSuccessSubscription = useCallback(() => {
    setTimeout(() => router.push("/admin/subscriptions"), 900);
  }, [router]);

  return (
    <AdminShell
      title="Register new order"
      subtitle="Manual entry (phone call / walk-in)"
      actions={
        <Link
          href="/admin/orders"
          style={backLink}
          className="uppercase"
        >
          Back to orders
        </Link>
      }
    >
      <RegisterOrderForm
        authMode="admin"
        onSuccessOneTime={onSuccessOneTime}
        onSuccessSubscription={onSuccessSubscription}
        cancelHref="/admin/orders"
      />
    </AdminShell>
  );
}

// Header action link — matches the form's cream-on-green chip idiom
// so the header + form read as one page.
const backLink: React.CSSProperties = {
  padding: "0.4rem 0.9rem",
  border: "1px solid #FBF3D4",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  background: "transparent",
  color: "#FBF3D4",
  display: "inline-block",
  textDecoration: "none",
};
