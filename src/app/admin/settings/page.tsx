"use client";

// Admin settings — global toggles that change site-wide behaviour.
// Currently: pre-order mode. Adding more toggles → same page, more cards.

import { AdminShell } from "@/components/admin/AdminShell";
import PreorderModeToggle from "./PreorderModeToggle";

export default function AdminSettingsPage() {
  return (
    <AdminShell title="Settings" subtitle="Site-wide toggles">
      <PreorderModeToggle />
    </AdminShell>
  );
}
