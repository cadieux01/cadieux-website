import type { Metadata } from "next";

import { getActiveLocations } from "@/lib/pickup-locations";
import FindUsClient from "./FindUsClient";

// Render at request time so the build doesn't try to prerender against
// the pickup_locations table (which may not exist on first deploy) and
// so the singleton Google Maps loader options match across pages.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check Bread Delivery to Your Pincode | Cadieux",
  description:
    "See if Cadieux delivers fresh protein bread to your Visakhapatnam pincode. Same-day delivery across Vizag — enter your PIN to check in one tap.",
};

export default async function FindUsPage() {
  // The map needs the public Google Maps key at runtime; the key is
  // restricted to Cadieux domains in the GCP console, so shipping it
  // to the client is intentional.
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const locations = await getActiveLocations();
  return <FindUsClient apiKey={apiKey} locations={locations} />;
}
