import type { Metadata } from "next";

import { getActiveLocations } from "@/lib/pickup-locations";
import FindUsClient from "./FindUsClient";

// Render at request time so the build doesn't try to prerender against
// the pickup_locations table (which may not exist on first deploy) and
// so the singleton Google Maps loader options match across pages.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Store Locator | Cadieux",
  description:
    "Find your nearest Cadieux kitchen, stall or partner pickup point in Visakhapatnam. Check whether we deliver to your pincode in one tap.",
};

export default async function FindUsPage() {
  // The map needs the public Google Maps key at runtime; the key is
  // restricted to Cadieux domains in the GCP console, so shipping it
  // to the client is intentional.
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const locations = await getActiveLocations();
  return <FindUsClient apiKey={apiKey} locations={locations} />;
}
