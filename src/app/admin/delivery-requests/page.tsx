// Relocated: the serviceability ("deliver here please") queue now lives on
// the combined /admin/requests page under the "Serviceability Requests" tab.
// This route redirects so old links/bookmarks don't 404.

import { redirect } from "next/navigation";

export default function DeliveryRequestsRedirect() {
  redirect("/admin/requests");
}
