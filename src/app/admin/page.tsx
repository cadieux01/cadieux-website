// /admin is the unified entry point — redirect to the new Overview page.
// Everything else (Orders, Customers, Subscriptions, Products, Legacy) is
// reachable from the AdminShell top nav.

import { redirect } from "next/navigation";

export default function AdminRoot(): never {
  redirect("/admin/overview");
}
