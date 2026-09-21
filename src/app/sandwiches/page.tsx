// Customer sandwich menu, gated by the kitchen switch.
//
// Hard rule from the storefront spec: while sandwich_kitchen_enabled = false,
// this route must 404. Any user reaching /sandwiches directly, with or
// without the drawer entry, sees the ordinary Next 404. Rendering an empty
// "closed" page instead would leak the feature's existence — cheap to fix
// and worth doing.
//
// When the kitchen is ON we still render whatever state we're in — the
// closed-window banner (before 1 PM / after 11 PM IST) lives on the client
// so the page can update on refresh without a redeploy.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSandwichKitchenState } from "@/lib/sandwich-kitchen";
import { getSandwichMenu } from "@/lib/sandwich-menu";
import { isKitchenOpenNow, formatHour12 } from "@/lib/sandwich-kitchen-hours";
import SandwichesListClient from "./SandwichesListClient";

export const metadata: Metadata = {
  title: "Sandwiches | Cadieux",
  description:
    "Fresh sandwiches on Cadieux protein bread — pick your bread, we bake and deliver.",
  alternates: { canonical: "/sandwiches" },
};

export default async function SandwichesPage() {
  const kitchen = await getSandwichKitchenState();
  if (!kitchen.enabled) {
    // 404, not a redirect. See file header — the feature is dark until Sunny
    // flips the switch.
    notFound();
  }

  const menu = await getSandwichMenu();
  const openNow = isKitchenOpenNow(kitchen);

  return (
    <SandwichesListClient
      menu={menu}
      openNow={openNow}
      opensAt={formatHour12(kitchen.open)}
      closesAt={formatHour12(kitchen.close)}
    />
  );
}
