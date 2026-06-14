// Relocated: the COD order delivery + item change-request queue now lives on
// the combined /admin/requests page under the "Order Changes" tab. This route
// redirects so old links/bookmarks don't 404.

import { redirect } from "next/navigation";

export default function OrderChangesRedirect() {
  redirect("/admin/requests");
}
