"use client";

// Client-side mirror of each product's BAKING DAYS — the union of
// products.available_from and its product_open_dates rows — for the cart and
// checkout, both pure client components with no server data of their own.
//
// PRESENTATION ONLY. The days are enforced server-side by enforceDeliveryDays
// on every order and subscription path, so an empty map here (fetch failed,
// hook not mounted, old bundle) degrades to "the server refuses the date",
// never to "a closed day is bookable".

import { useCallback, useEffect, useMemo, useState } from "react";

import { cachedJson } from "@/lib/client-json-cache";
import { PRODUCTS } from "@/lib/data";
import {
  cartOpenDays,
  type AvailabilityRow,
  type CartOpenDays,
  type PreorderInfo,
} from "@/lib/product-availability";

export type FloorsBySlug = Record<string, PreorderInfo>;

/** Matches usePreorderMode. A floor moves when an admin edits a product, which
 *  is rare relative to a checkout session. */
const TTL_MS = 30_000;

export function useProductFloors(): { floors: FloorsBySlug; loading: boolean } {
  const [floors, setFloors] = useState<FloorsBySlug>({});
  const [loading, setLoading] = useState(true);

  // Shared client cache: /checkout mounts this hook twice (checkout page and
  // cart summary) and useCartFloor mounts it again, so without dedupe one page
  // load fired the same request two or three times.
  const load = useCallback(async () => {
    try {
      const json = await cachedJson<{ floors?: FloorsBySlug }>(
        "/api/product-floors",
        TTL_MS,
      );
      setFloors(json.floors ?? {});
    } catch (err) {
      console.warn("[useProductFloors] fetch failed:", err);
      setFloors({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Unlike usePreorderMode, floors still listen for focus: stock can land
    // while a tab sits open, and a stale floor shows a loaf as unorderable
    // that we could have sold. What made the old listener expensive was that
    // EVERY focus event cost a round trip — an alt-tab to read an OTP paid for
    // one. It goes through the TTL cache now, so a focus inside the window is
    // free and only a genuinely old map is re-read.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  return { floors, loading };
}

/** Turn cart lines into availability rows. Cart lines carry a `productIndex`
 *  into the bundled PRODUCTS array, which is how we get back to the slug the
 *  map is keyed on.
 *
 *  Note what is passed: the DTO's RAW halves, `from` and `openDates`, never
 *  its resolved `date`. A single date cannot represent `{16} ∪ [19, ∞)`, and
 *  handing `date` back in as `available_from` — which is what this did while
 *  the model was a floor — would silently turn the 16th into a closed day.
 *
 *  A slug absent from the map is unrestricted, so it gets `open_dates: []`
 *  and no ray: unrestricted either way, and it cannot be mistaken for a
 *  product whose schedule failed to load. */
function toRows(
  items: { productIndex: number; name: string }[],
  floors: FloorsBySlug,
): AvailabilityRow[] {
  return items.map((item) => {
    const info = floors[PRODUCTS[item.productIndex]?.slug ?? ""];
    return {
      name: item.name,
      available_from: info?.from ?? null,
      open_dates: info?.openDates ?? [],
    };
  });
}

/** The deliverable days for the CART as a whole — the INTERSECTION across its
 *  lines, not the max of their ray starts. See intersectOpenSets. */
export function useCartFloor(
  items: { productIndex: number; name: string }[],
): CartOpenDays {
  const { floors } = useProductFloors();
  const key = items.map((i) => `${i.productIndex}`).join(",");
  return useMemo(
    () => cartOpenDays(toRows(items, floors)),
    // `items` is a fresh array on every render; key it on the product indices
    // so the memo survives unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, floors],
  );
}

/** The per-line rows themselves, for surfaces that need to say WHICH loaf
 *  closed a given day (closedBy / closedDayNote) rather than just whether the
 *  cart as a whole admits it. */
export function useCartAvailabilityRows(
  items: { productIndex: number; name: string }[],
): AvailabilityRow[] {
  const { floors } = useProductFloors();
  const key = items.map((i) => `${i.productIndex}`).join(",");
  return useMemo(
    () => toRows(items, floors),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, floors],
  );
}
