"use client";

// Client-side mirror of products.available_from, for the cart and checkout —
// both pure client components with no server data of their own.
//
// PRESENTATION ONLY. The floor is enforced server-side by enforceDeliveryFloor
// on every order and subscription path, so an empty map here (fetch failed,
// hook not mounted, old bundle) degrades to "the server refuses the date",
// never to "an early date is bookable".

import { useCallback, useEffect, useMemo, useState } from "react";

import { PRODUCTS } from "@/lib/data";
import {
  cartFloor,
  type CartFloor,
  type PreorderInfo,
} from "@/lib/product-availability";

export type FloorsBySlug = Record<string, PreorderInfo>;

export function useProductFloors(): { floors: FloorsBySlug; loading: boolean } {
  const [floors, setFloors] = useState<FloorsBySlug>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/product-floors", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { floors?: FloorsBySlug };
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
    // Unlike usePreorderMode (fetched once per page load), floors DO refresh
    // on focus: stock can land while a tab sits open, and a stale floor shows
    // a loaf as unorderable that we could have sold.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  return { floors, loading };
}

/** The floor for the CART as a whole — MAX(available_from) across its lines.
 *  Cart lines carry a `productIndex` into the bundled PRODUCTS array, which is
 *  how we get back to the slug the floors map is keyed on. */
export function useCartFloor(
  items: { productIndex: number; name: string }[],
): CartFloor {
  const { floors } = useProductFloors();
  const key = items.map((i) => `${i.productIndex}`).join(",");
  return useMemo(
    () =>
      cartFloor(
        items.map((item) => ({
          name: item.name,
          available_from: floors[PRODUCTS[item.productIndex]?.slug ?? ""]?.date,
        })),
      ),
    // `items` is a fresh array on every render; key it on the product indices
    // so the memo survives unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, floors],
  );
}
