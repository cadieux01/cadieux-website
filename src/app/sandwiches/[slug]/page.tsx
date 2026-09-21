// Sandwich PDP, gated by the kitchen switch.
//
// 404 when the switch is off (same reason as /sandwiches — the feature is
// invisible until Sunny flips it). 404 when the slug does not exist. 404
// when the sandwich exists but has zero available variants — a sandwich with
// no orderable bread is not a page a customer should land on.
//
// Add-to-cart lives on the client half. This server component just fetches
// the sandwich, the kitchen state, and the openNow verdict, and hands them
// down.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSandwichKitchenState } from "@/lib/sandwich-kitchen";
import { getSandwichBySlug } from "@/lib/sandwich-menu";
import { isKitchenOpenNow, formatHour12 } from "@/lib/sandwich-kitchen-hours";
import SandwichDetailClient from "./SandwichDetailClient";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const kitchen = await getSandwichKitchenState();
  if (!kitchen.enabled) return { title: "Not found" };
  const sandwich = await getSandwichBySlug(params.slug);
  if (!sandwich) return { title: "Not found" };
  return {
    title: `${sandwich.name} | Cadieux Sandwiches`,
    description:
      sandwich.description ??
      `${sandwich.name} on Cadieux protein bread — Plain or Multigrain.`,
    alternates: { canonical: `/sandwiches/${sandwich.slug}` },
  };
}

export default async function SandwichDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const kitchen = await getSandwichKitchenState();
  if (!kitchen.enabled) notFound();

  const sandwich = await getSandwichBySlug(params.slug);
  if (!sandwich) notFound();

  const openNow = isKitchenOpenNow(kitchen);

  return (
    <SandwichDetailClient
      sandwich={sandwich}
      openNow={openNow}
      opensAt={formatHour12(kitchen.open)}
      closesAt={formatHour12(kitchen.close)}
    />
  );
}
