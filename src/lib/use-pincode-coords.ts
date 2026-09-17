"use client";

// pincode → centroid, fetched once per board mount (263 rows, ~20 KB).
// Powers the fallback leg of the area sort for rows that have no saved
// coordinates but do carry a 6-digit pincode.
//
// FAILURE IS NON-FATAL BY DESIGN. If the fetch dies the map stays empty,
// distanceFrom falls through to 'none' for pincode-only rows, and the
// sort quietly downgrades to GPS-only. That is a worse sort, not a
// broken board — and these boards are what Sunny runs the morning on.

import { useEffect, useState } from "react";

import { adminFetch } from "@/lib/admin-client";

export type PincodeCoords = Map<string, { latitude: number; longitude: number }>;

export function usePincodeCoords(): PincodeCoords {
  const [coords, setCoords] = useState<PincodeCoords>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch<{
          rows: { pincode: string; latitude: number; longitude: number }[];
        }>("/api/admin/pincode-geocache");
        if (cancelled) return;
        const m: PincodeCoords = new Map();
        for (const r of res.rows ?? []) {
          m.set(r.pincode, { latitude: r.latitude, longitude: r.longitude });
        }
        setCoords(m);
      } catch {
        // See the note above — the sort degrades, nothing throws.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return coords;
}
