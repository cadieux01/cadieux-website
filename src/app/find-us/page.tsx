import type { Metadata } from "next";
import FindUsClient from "./FindUsClient";

export const metadata: Metadata = {
  title:
    "Find Cadieux Near You — 10 Stalls + 50 Communities + 100 Gyms in Visakhapatnam",
  description:
    "Find your nearest Cadieux stall, check if we deliver to your gated community, or pick up at one of 100 top-rated Vizag gyms. We cover 10 stalls, 50+ premium residential communities and 100 fitness partners across Visakhapatnam.",
};

export default function FindUsPage() {
  // The map needs the public Google Maps key at runtime; the key is
  // restricted to Cadieux domains in the GCP console, so shipping it to the
  // client is intentional.
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  return <FindUsClient apiKey={apiKey} />;
}
