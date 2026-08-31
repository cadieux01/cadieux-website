"use client";

// Admin: manage which pincodes Cadieux currently delivers to. A pincode
// can hold multiple area labels (one-to-many) so a single 530017 row can
// surface as "MVP Colony" + "Lawson's Bay Colony" depending on which
// gated community the customer is in.
//
// This page also supports bulk activate/deactivate via a checkbox per
// row + a sticky action bar at the bottom of the viewport. Tabs split
// the list into Active / History (deactivated) / All so the operator
// can dial in the right scope before bulk-acting.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJsApiLoader } from "@react-google-maps/api";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import {
  GOOGLE_MAPS_LIBRARIES,
  GOOGLE_MAPS_LOADER_ID,
} from "@/lib/google-maps-loader";

// Vizag-centric bias for the area-name autocomplete. Bounds rather
// than strictBounds so unusual neighborhoods that fall outside this
// box still surface; the operator can also free-type without picking
// a suggestion.
const VIZAG_AUTOCOMPLETE_BOUNDS = {
  south: 17.2,
  west: 82.8,
  north: 18.1,
  east: 83.7,
};

type ServiceAreaRow = {
  pincode: string;
  area_name: string;
  is_active: boolean;
  added_at: string;
  added_by: string | null;
};

type GroupedRow = {
  pincode: string;
  area_names: string[];
  is_active: boolean;
  added_at: string;
};

type Tab = "active" | "history" | "all";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";
const DARK_GREEN = "#024628";

export default function ServiceAreasPage() {
  const [rows, setRows] = useState<ServiceAreaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<Tab>("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const [newPincode, setNewPincode] = useState("");
  const [newAreas, setNewAreas] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);

  // Bulk import modal state
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState("");
  const [bulkImportBusy, setBulkImportBusy] = useState(false);
  const [bulkImportError, setBulkImportError] = useState<string | null>(null);

  // Google Places — custom dropdown driven by AutocompleteService
  // (not the @react-google-maps <Autocomplete> widget). Reason: the
  // widget binds to a native <input>, and the browser's address /
  // contacts autofill heuristic targets that input regardless of
  // attribute tricks (autoComplete="new-password", neutral name,
  // role=combobox, decoys, readonly-on-mount — all failed in prior
  // commits a7ea2f6 and e4c7ee0). Rendering predictions ourselves
  // into a custom <ul> listbox sidesteps that entirely: the input
  // is a plain combobox the browser doesn't recognize as a name or
  // address field, and we own the dropdown so Chrome/Safari can't
  // overlay their own UI on top of it.
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const { isLoaded: mapsLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const autocompleteReady = mapsLoaded && apiKey.length > 0;

  // Set to true when a prediction is picked so the area-name onBlur
  // lookup skips itself. Reset on the next keystroke.
  const placePickedRef = useRef<boolean>(false);
  const areaInputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLUListElement | null>(null);

  // Readonly-until-focus trick — browsers (Safari especially) skip
  // autofill on readonly inputs. We start readonly and clear the
  // flag on first focus (synchronously via state). 150ms fallback
  // covers the autoFocus edge case where focus fires before mount
  // completes.
  const [areaReadOnly, setAreaReadOnly] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setAreaReadOnly(false), 150);
    return () => window.clearTimeout(t);
  }, []);

  // Randomized field name regenerated on every mount. Browsers can
  // only learn / autofill fields by stable name — a fresh random
  // suffix every page load means the contacts/address heuristic
  // has nothing to latch onto.
  const [areaInputName] = useState(
    () => `area-${Math.random().toString(36).slice(2, 10)}`,
  );

  // Custom prediction dropdown state.
  type Prediction = google.maps.places.AutocompletePrediction;
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showPredictions, setShowPredictions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const autocompleteServiceRef =
    useRef<google.maps.places.AutocompleteService | null>(null);
  const sessionTokenRef =
    useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  // Initialize Places SDK objects once the loader resolves.
  useEffect(() => {
    if (!autocompleteReady) return;
    if (typeof google === "undefined" || !google.maps?.places) return;
    autocompleteServiceRef.current =
      new google.maps.places.AutocompleteService();
    sessionTokenRef.current =
      new google.maps.places.AutocompleteSessionToken();
    geocoderRef.current = new google.maps.Geocoder();
  }, [autocompleteReady]);

  // Debounced prediction fetch as the user types. 150ms is below the
  // human-perception threshold yet still coalesces fast typing so we
  // don't burn quota on every keystroke.
  useEffect(() => {
    const svc = autocompleteServiceRef.current;
    if (!autocompleteReady || !svc) return;
    const query = newAreas.trim();
    if (query.length < 2) {
      setPredictions([]);
      setHighlightIdx(-1);
      return;
    }
    const handle = window.setTimeout(() => {
      svc.getPlacePredictions(
        {
          input: query,
          bounds: VIZAG_AUTOCOMPLETE_BOUNDS,
          componentRestrictions: { country: "in" },
          types: ["geocode"],
          sessionToken: sessionTokenRef.current ?? undefined,
        },
        (results) => {
          setPredictions(results ?? []);
          setHighlightIdx(-1);
        },
      );
    }, 150);
    return () => window.clearTimeout(handle);
  }, [newAreas, autocompleteReady]);

  // Resolve a picked prediction → set area name + pincode using the
  // existing 3-step chain (postal_code → reverse geocode → suggest).
  // We use Geocoder.geocode({ placeId }) instead of PlacesService
  // because it returns address_components + geometry directly and
  // doesn't require an attribution DOM element.
  const pickPrediction = useCallback(
    async (p: Prediction) => {
      const pickedName =
        p.structured_formatting?.main_text?.trim() || p.description;
      placePickedRef.current = true;
      setNewAreas(pickedName);
      setPredictions([]);
      setShowPredictions(false);
      setHighlightIdx(-1);

      const geocoder = geocoderRef.current;
      if (!geocoder) return;

      setSuggestBusy(true);
      try {
        const res = await geocoder.geocode({ placeId: p.place_id });
        const r = res.results?.[0];

        // Step 1: postal_code from address_components.
        const postal = r?.address_components
          ?.find((c) => c.types.includes("postal_code"))
          ?.long_name?.replace(/\D/g, "");
        if (postal && /^\d{6}$/.test(postal)) {
          setNewPincode(postal);
          showNotice(`Picked "${pickedName}" → pincode ${postal}`);
          return;
        }

        // Step 2: client-side reverse geocode on coords.
        const loc = r?.geometry?.location;
        const lat = loc?.lat?.();
        const lng = loc?.lng?.();
        if (typeof lat === "number" && typeof lng === "number") {
          const reversed = await clientReverseGeocode(lat, lng);
          if (reversed) {
            setNewPincode(reversed);
            showNotice(`Picked "${pickedName}" → pincode ${reversed}`);
            return;
          }
        }

        // Step 3: server suggest-pincode (chains its own reverse-
        // geocode fallback for tricky localities).
        const lookup = await adminFetch<{ pincode: string | null }>(
          `/api/admin/service-areas/suggest-pincode?area=${encodeURIComponent(pickedName)}`,
        );
        const resolved = (lookup.pincode ?? "").replace(/\D/g, "");
        if (/^\d{6}$/.test(resolved)) {
          setNewPincode(resolved);
          showNotice(`Picked "${pickedName}" → pincode ${resolved}`);
        }
      } catch {
        // Silent — admin can still type the pincode manually.
      } finally {
        setSuggestBusy(false);
        // Rotate the session token after a selection — Google bills
        // by session, and a session ends on the first details call.
        if (
          typeof google !== "undefined" &&
          google.maps?.places?.AutocompleteSessionToken
        ) {
          sessionTokenRef.current =
            new google.maps.places.AutocompleteSessionToken();
        }
      }
    },
    // showNotice + clientReverseGeocode are stable refs in this file;
    // see definitions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!showPredictions) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (
        areaInputRef.current?.contains(t) ||
        dropdownRef.current?.contains(t)
      ) {
        return;
      }
      setShowPredictions(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showPredictions]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await adminFetch<{ rows: ServiceAreaRow[] }>(
        "/api/admin/service-areas",
      );
      setRows(res.rows ?? []);
    } catch (e) {
      setError(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
          ? e.message
          : "Failed to load service areas.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped: GroupedRow[] = useMemo(() => {
    const map = new Map<string, GroupedRow>();
    for (const r of rows) {
      const g = map.get(r.pincode);
      if (g) {
        g.area_names.push(r.area_name);
        // a pincode is "active" if any of its rows are active.
        if (r.is_active) g.is_active = true;
        if (r.added_at > g.added_at) g.added_at = r.added_at;
      } else {
        map.set(r.pincode, {
          pincode: r.pincode,
          area_names: [r.area_name],
          is_active: r.is_active,
          added_at: r.added_at,
        });
      }
    }
    const out = Array.from(map.values());
    out.sort((a, b) => a.pincode.localeCompare(b.pincode));
    return out;
  }, [rows]);

  const counts = useMemo(() => {
    let active = 0;
    let history = 0;
    for (const g of grouped) {
      if (g.is_active) active++;
      else history++;
    }
    return { active, history, all: grouped.length };
  }, [grouped]);

  // Tab filter first, then text search. We keep both independent so the
  // operator can land on "History" tab and still search a specific pincode.
  const filtered = useMemo(() => {
    const tabFiltered =
      tab === "active"
        ? grouped.filter((g) => g.is_active)
        : tab === "history"
          ? grouped.filter((g) => !g.is_active)
          : grouped;
    const q = search.trim().toLowerCase();
    if (!q) return tabFiltered;
    return tabFiltered.filter(
      (g) =>
        g.pincode.includes(q) ||
        g.area_names.some((a) => a.toLowerCase().includes(q)),
    );
  }, [grouped, tab, search]);

  // Reset selection whenever the visible set changes — selecting on a
  // different tab and acting elsewhere would be confusing.
  useEffect(() => {
    setSelected(new Set());
  }, [tab]);

  const visiblePincodes = useMemo(
    () => filtered.map((g) => g.pincode),
    [filtered],
  );
  const allVisibleSelected =
    visiblePincodes.length > 0 &&
    visiblePincodes.every((p) => selected.has(p));
  const someVisibleSelected =
    !allVisibleSelected && visiblePincodes.some((p) => selected.has(p));

  const toggleOne = (pincode: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pincode)) next.delete(pincode);
      else next.add(pincode);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const p of visiblePincodes) next.delete(p);
      } else {
        for (const p of visiblePincodes) next.add(p);
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const showNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  };

  // Look up the pincode for the first area name in the field via the
  // suggest-pincode endpoint (Google Geocoding under the hood). Used by
  // both the manual "Auto-fill Pincode" button and the area-name input's
  // onBlur — the latter only fires when the pincode is still empty so
  // we don't clobber an admin's manual override.
  //
  // `silent=true` (used by the onBlur path) suppresses the user-facing
  // toast and the inline error so tabbing out feels lightweight. The
  // manual button still gets full feedback.
  const suggestPincode = async (silent = false) => {
    const firstArea = newAreas.split(",").map((s) => s.trim()).find(Boolean);
    if (!firstArea) {
      if (!silent) setAddError("Type an area name first so we can look it up.");
      return;
    }
    if (!silent) setAddError(null);
    setSuggestBusy(true);
    try {
      const res = await adminFetch<{ pincode: string | null }>(
        `/api/admin/service-areas/suggest-pincode?area=${encodeURIComponent(firstArea)}`,
      );
      if (res.pincode && /^\d{6}$/.test(res.pincode)) {
        setNewPincode(res.pincode);
        if (!silent) showNotice(`Filled pincode ${res.pincode} from "${firstArea}"`);
      } else if (!silent) {
        setAddError(`Could not find a pincode for "${firstArea}".`);
      }
    } catch (e) {
      if (!silent) {
        setAddError(
          e instanceof AdminFetchError ? e.message : "Lookup failed",
        );
      }
    } finally {
      setSuggestBusy(false);
    }
  };

  // Auto-fill the pincode when the admin tabs/clicks out of the area
  // name field, but only if the pincode is currently empty. Prevents
  // accidentally overwriting an operator's correction. Also skipped
  // when a Places suggestion was just picked — the place-changed
  // handler already filled (or is filling) the pincode itself.
  const handleAreaBlur = () => {
    if (placePickedRef.current) {
      placePickedRef.current = false;
      return;
    }
    if (newPincode.replace(/\D/g, "").length === 6) return;
    if (!newAreas.trim()) return;
    void suggestPincode(true);
  };

  // Client-side reverse geocode using the JS Maps SDK that's already
  // loaded for autocomplete. Walks every returned result for the
  // first `postal_code` component — Google reliably surfaces it on
  // coordinate-based lookups even when forward (name) lookups omit it.
  const clientReverseGeocode = useCallback(
    (lat: number, lng: number): Promise<string | null> => {
      return new Promise((resolve) => {
        if (typeof google === "undefined" || !google.maps?.Geocoder) {
          resolve(null);
          return;
        }
        try {
          new google.maps.Geocoder().geocode(
            { location: { lat, lng } },
            (results, status) => {
              if (status !== "OK" || !results) {
                resolve(null);
                return;
              }
              for (const r of results) {
                const pc = r.address_components
                  ?.find((c) => c.types.includes("postal_code"))
                  ?.long_name?.replace(/\D/g, "");
                if (pc && /^\d{6}$/.test(pc)) {
                  resolve(pc);
                  return;
                }
              }
              resolve(null);
            },
          );
        } catch {
          resolve(null);
        }
      });
    },
    [],
  );

  const submitNew = async () => {
    setAddError(null);
    const area_names = newAreas
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (area_names.length === 0) {
      setAddError("Area name required");
      return;
    }

    setAddBusy(true);
    try {
      // Resolve the pincode. Admin override (anything already in the
      // field) wins — we only hit Google when the field is blank/short.
      // This is the single source of truth for the activate path; the
      // onBlur lookup is a convenience and can be skipped (e.g. the
      // admin clicks Activate immediately after typing).
      let pincode = newPincode.replace(/\D/g, "");
      if (pincode.length !== 6) {
        const firstArea = area_names[0]!;
        try {
          const lookup = await adminFetch<{ pincode: string | null }>(
            `/api/admin/service-areas/suggest-pincode?area=${encodeURIComponent(firstArea)}`,
          );
          const resolved = (lookup.pincode ?? "").replace(/\D/g, "");
          if (/^\d{6}$/.test(resolved)) {
            pincode = resolved;
            // Reflect the resolved value back into the field so the
            // operator sees what we used (and can correct + re-submit
            // if Google guessed wrong).
            setNewPincode(resolved);
          } else {
            setAddError(
              `Couldn't find a pincode for "${firstArea}". Please enter it manually.`,
            );
            return;
          }
        } catch (e) {
          setAddError(
            e instanceof AdminFetchError
              ? `Pincode lookup failed: ${e.message}`
              : `Couldn't find a pincode for "${firstArea}". Please enter it manually.`,
          );
          return;
        }
      }

      const res = await adminFetch<{
        ok: boolean;
        geocoded?: number;
        geocoded_failed?: number;
      }>("/api/admin/service-areas", {
        method: "POST",
        body: JSON.stringify({ pincode, area_names }),
      });
      setNewPincode("");
      setNewAreas("");
      const geo = res.geocoded ?? 0;
      const failed = res.geocoded_failed ?? 0;
      showNotice(
        failed === 0
          ? `Activated pincode ${pincode} (${geo} geocoded)`
          : `Activated pincode ${pincode} — ${failed} area${failed === 1 ? "" : "s"} could not be geocoded (proximity won't apply)`,
      );
      await load();
    } catch (e) {
      setAddError(
        e instanceof AdminFetchError ? e.message : "Failed to activate area",
      );
    } finally {
      setAddBusy(false);
    }
  };

  // Parse pasted lines into { pincode, area_name? } entries + tally
  // invalid lines. Tolerates blank lines and trims surrounding
  // whitespace; splits on the first tab or comma so commas inside the
  // area_name survive (e.g. "530017, MVP Colony, Block A" becomes
  // pincode 530017 with area "MVP Colony, Block A").
  const parsedBulk = useMemo(() => {
    const text = bulkImportText;
    if (!text.trim()) {
      return {
        entries: [] as { pincode: string; area_name: string }[],
        invalidLines: [] as string[],
        newCount: 0,
        existingCount: 0,
        invalidCount: 0,
      };
    }

    // Existing (pincode, area_name) pairs — used to bucket each parsed
    // entry into "new" vs "already exists" for the preview.
    const existingKeys = new Set(
      rows.map((r) => `${r.pincode}|${r.area_name.toLowerCase()}`),
    );

    const entries: { pincode: string; area_name: string }[] = [];
    const invalidLines: string[] = [];
    const seenInPaste = new Set<string>();
    let existingCount = 0;

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      // Split on the first tab or comma only.
      const splitIdx = (() => {
        const t = line.indexOf("\t");
        const c = line.indexOf(",");
        if (t === -1) return c;
        if (c === -1) return t;
        return Math.min(t, c);
      })();
      const rawPincode = splitIdx === -1 ? line : line.slice(0, splitIdx);
      const rawArea = splitIdx === -1 ? "" : line.slice(splitIdx + 1);

      const pincode = rawPincode.replace(/\D/g, "");
      if (!/^\d{6}$/.test(pincode)) {
        invalidLines.push(line);
        continue;
      }

      const area_name = (rawArea.trim() || "Vizag").slice(0, 80);
      const key = `${pincode}|${area_name.toLowerCase()}`;

      // Skip in-paste duplicates silently — same as the server does.
      if (seenInPaste.has(key)) continue;
      seenInPaste.add(key);

      if (existingKeys.has(key)) {
        existingCount++;
        continue;
      }
      entries.push({ pincode, area_name });
    }

    return {
      entries,
      invalidLines,
      newCount: entries.length,
      existingCount,
      invalidCount: invalidLines.length,
    };
  }, [bulkImportText, rows]);

  const submitBulkImport = async () => {
    setBulkImportError(null);
    if (parsedBulk.entries.length === 0) {
      setBulkImportError(
        "Nothing to import — all lines are either duplicates or invalid.",
      );
      return;
    }
    setBulkImportBusy(true);
    try {
      const res = await adminFetch<{
        added: number;
        geocoded: number;
        geocode_failed: number;
        skipped_existing: number;
        invalid: number;
      }>("/api/admin/service-areas/bulk-import", {
        method: "POST",
        body: JSON.stringify({ entries: parsedBulk.entries }),
      });
      const skipped = res.skipped_existing + parsedBulk.existingCount;
      const parts = [
        `Added ${res.added}`,
        `${res.geocoded} geocoded`,
      ];
      if (res.geocode_failed > 0) {
        parts.push(`${res.geocode_failed} pending coords`);
      }
      if (skipped > 0) {
        parts.push(`${skipped} skipped (existing)`);
      }
      if (parsedBulk.invalidCount > 0) {
        parts.push(`${parsedBulk.invalidCount} invalid lines`);
      }
      showNotice(parts.join(" · "));
      setBulkImportOpen(false);
      setBulkImportText("");
      await load();
    } catch (e) {
      setBulkImportError(
        e instanceof AdminFetchError ? e.message : "Bulk import failed",
      );
    } finally {
      setBulkImportBusy(false);
    }
  };

  const backfillGeocodes = async () => {
    if (
      !confirm(
        "Run one-time geocode backfill for every row missing coords? This calls Google Geocoding once per row (~150ms apart).",
      )
    )
      return;
    setBackfillBusy(true);
    try {
      const res = await adminFetch<{
        processed: number;
        geocoded: number;
        failed: number;
        failed_rows: { pincode: string; area_name: string }[];
      }>("/api/admin/service-areas/backfill-geocodes", { method: "POST" });
      if (res.processed === 0) {
        showNotice("Nothing to backfill — every row already has coords.");
      } else if (res.failed === 0) {
        showNotice(
          `Backfilled ${res.geocoded}/${res.processed} rows (all succeeded).`,
        );
      } else {
        const sample = res.failed_rows
          .slice(0, 3)
          .map((r) => `${r.pincode}/${r.area_name}`)
          .join(", ");
        const extra = res.failed_rows.length > 3 ? "…" : "";
        showNotice(
          `Backfilled ${res.geocoded}/${res.processed} — ${res.failed} failed (${sample}${extra}). See server logs for details.`,
        );
      }
      await load();
    } catch (e) {
      showNotice(
        e instanceof AdminFetchError ? e.message : "Backfill failed",
      );
    } finally {
      setBackfillBusy(false);
    }
  };

  const deactivate = async (pincode: string) => {
    if (
      !confirm(
        `Deactivate pincode ${pincode}? Customers will no longer be able to check out.`,
      )
    )
      return;
    setBusy((b) => ({ ...b, [pincode]: true }));
    try {
      await adminFetch(`/api/admin/service-areas/${pincode}/deactivate`, {
        method: "POST",
      });
      showNotice(`Deactivated ${pincode}`);
      await load();
    } catch (e) {
      showNotice(
        e instanceof AdminFetchError ? e.message : "Failed to deactivate",
      );
    } finally {
      setBusy((b) => ({ ...b, [pincode]: false }));
    }
  };

  const reactivate = async (pincode: string) => {
    setBusy((b) => ({ ...b, [pincode]: true }));
    try {
      await adminFetch(`/api/admin/service-areas/${pincode}/reactivate`, {
        method: "POST",
      });
      showNotice(`Reactivated ${pincode}`);
      await load();
    } catch (e) {
      showNotice(
        e instanceof AdminFetchError ? e.message : "Failed to reactivate",
      );
    } finally {
      setBusy((b) => ({ ...b, [pincode]: false }));
    }
  };

  const runBulk = async (action: "activate" | "deactivate") => {
    const pincodes = Array.from(selected);
    if (pincodes.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await adminFetch<{
        succeeded: string[];
        failed: string[];
      }>("/api/admin/service-areas/bulk", {
        method: "POST",
        body: JSON.stringify({ action, pincodes }),
      });
      const ok = res.succeeded?.length ?? 0;
      const fail = res.failed?.length ?? 0;
      showNotice(
        fail === 0
          ? `${action === "activate" ? "Reactivated" : "Deactivated"} ${ok} pincode${ok === 1 ? "" : "s"}`
          : `${action} succeeded for ${ok}, failed for ${fail}`,
      );
      setSelected(new Set());
      setConfirmDeactivate(false);
      await load();
    } catch (e) {
      showNotice(
        e instanceof AdminFetchError ? e.message : `Bulk ${action} failed`,
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const startBulkDeactivate = () => {
    if (selected.size === 0) return;
    setConfirmDeactivate(true);
  };

  return (
    <AdminShell
      title="Areas We Serve"
      subtitle={`${counts.active} active · ${counts.history} paused`}
      actions={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setBulkImportOpen(true)}
            title="Paste many pincodes/areas at once"
            className="uppercase"
            style={primaryBtn}
          >
            Bulk Import
          </button>
          <button
            type="button"
            onClick={() => void backfillGeocodes()}
            disabled={backfillBusy}
            title="One-time: geocode all rows missing latitude/longitude"
            className="uppercase"
            style={{
              ...primaryBtn,
              cursor: backfillBusy ? "wait" : "pointer",
              opacity: backfillBusy ? 0.6 : 1,
            }}
          >
            {backfillBusy ? "Backfilling…" : "Backfill geocodes (one-time)"}
          </button>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="uppercase"
            style={{
              ...primaryBtn,
              cursor: refreshing ? "wait" : "pointer",
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      }
    >
      {notice && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "rgba(34,197,94,0.12)",
            border: "1px solid rgba(34,197,94,0.45)",
            color: "#bbf7d0",
            fontFamily: "var(--font-body)",
            fontSize: 16,
            letterSpacing: "0.05em",
          }}
        >
          {notice}
        </div>
      )}

      {/* Add new pincode */}
      <div
        style={{
          marginBottom: 28,
          padding: 18,
          background: "rgba(29,29,31,0.5)",
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
        }}
      >
        <div
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.3em",
            color: GOLD,
            marginBottom: 12,
          }}
        >
          Activate new area
        </div>
        <p
          style={{
            margin: "0 0 12px",
            color: FADED,
            fontFamily: "var(--font-body)",
            fontSize: 16,
            lineHeight: 1.5,
          }}
        >
          Type the area name first — pincode auto-fills via Google Maps when
          you tab out. Edit the pincode if Google guessed wrong.
        </p>
        {/*
          Wrap the row in a <form autoComplete="off"> with a swallowed
          onSubmit so the browser sees a form-level "no autofill"
          signal. The Activate button is type="button" so this never
          submits via Enter — the form is purely a hint to the
          autofill heuristic.
        */}
        <form
          autoComplete="off"
          onSubmit={(e) => e.preventDefault()}
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          {/*
            Decoy username/password inputs. The autofill heuristic in
            Chrome + Safari latches onto the FIRST credential-shaped
            field in a form and applies its contact/credential
            dropdown there. By putting two invisible decoys BEFORE
            the real area input, the heuristic targets the decoys
            and leaves the real input alone. We use off-screen
            positioning (not display:none) because Chrome explicitly
            ignores display:none decoys. aria-hidden + tabIndex=-1
            keep them out of the a11y tree and tab order.
          */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            tabIndex={-1}
            aria-hidden="true"
            defaultValue=""
            style={{
              position: "absolute",
              top: -9999,
              left: -9999,
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: "none",
            }}
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            tabIndex={-1}
            aria-hidden="true"
            defaultValue=""
            style={{
              position: "absolute",
              top: -9999,
              left: -9999,
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: "none",
            }}
          />
          <div
            style={{ flex: 1, minWidth: 240, position: "relative" }}
          >
            {/*
              Custom combobox: a plain <input> (not bound to Google's
              Autocomplete widget) plus a self-rendered listbox below.
              The browser sees a generic search-style input with a
              randomized name — no address/name heuristic matches —
              and the dropdown lives in our DOM where Chrome/Safari
              cannot overlay contact suggestions on top of it.
            */}
            <input
              ref={areaInputRef}
              type="search"
              name={areaInputName}
              id={areaInputName}
              placeholder="Area name — required (e.g. Madhurawada)"
              aria-label="Area name (required)"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showPredictions && predictions.length > 0}
              aria-controls="cdx-area-listbox"
              aria-activedescendant={
                highlightIdx >= 0
                  ? `cdx-area-opt-${highlightIdx}`
                  : undefined
              }
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
              readOnly={areaReadOnly}
              onFocus={() => {
                setAreaReadOnly(false);
                if (predictions.length > 0) setShowPredictions(true);
              }}
              value={newAreas}
              onChange={(e) => {
                placePickedRef.current = false;
                setNewAreas(e.target.value);
                setShowPredictions(true);
              }}
              onKeyDown={(e) => {
                if (!showPredictions || predictions.length === 0) {
                  if (e.key === "ArrowDown" && predictions.length > 0) {
                    setShowPredictions(true);
                    setHighlightIdx(0);
                    e.preventDefault();
                  }
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlightIdx((i) =>
                    Math.min(predictions.length - 1, i + 1),
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter") {
                  if (highlightIdx >= 0 && predictions[highlightIdx]) {
                    e.preventDefault();
                    void pickPrediction(predictions[highlightIdx]);
                  }
                } else if (e.key === "Escape") {
                  setShowPredictions(false);
                  setHighlightIdx(-1);
                }
              }}
              onBlur={handleAreaBlur}
              autoFocus
              style={{ ...inputBase, width: "100%" }}
            />
            {autocompleteReady &&
              showPredictions &&
              predictions.length > 0 && (
                <ul
                  ref={dropdownRef}
                  id="cdx-area-listbox"
                  role="listbox"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    zIndex: 50,
                    margin: 0,
                    padding: 4,
                    listStyle: "none",
                    background: "#1D1D1F",
                    border: `1px solid ${BORDER}`,
                    borderRadius: 6,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
                    maxHeight: 280,
                    overflowY: "auto",
                  }}
                >
                  {predictions.map((p, i) => {
                    const main =
                      p.structured_formatting?.main_text ?? p.description;
                    const secondary =
                      p.structured_formatting?.secondary_text ?? "";
                    const isActive = i === highlightIdx;
                    return (
                      <li
                        key={p.place_id}
                        id={`cdx-area-opt-${i}`}
                        role="option"
                        aria-selected={isActive}
                        // mousedown (not click) so the input's
                        // onBlur fires AFTER the pick — otherwise
                        // the dropdown closes before the click
                        // registers.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          void pickPrediction(p);
                        }}
                        onMouseEnter={() => setHighlightIdx(i)}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 4,
                          cursor: "pointer",
                          background: isActive
                            ? "rgba(245,158,11,0.15)"
                            : "transparent",
                          color: CREAM,
                          fontFamily: "var(--font-body)",
                          fontSize: 16,
                          lineHeight: 1.35,
                        }}
                      >
                        <div style={{ fontWeight: 500 }}>{main}</div>
                        {secondary && (
                          <div
                            style={{
                              color: FADED,
                              fontSize: 16,
                              marginTop: 2,
                            }}
                          >
                            {secondary}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
          </div>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder={suggestBusy ? "Looking up…" : "Pincode (auto-fills)"}
            aria-label="Pincode (auto-fills from area name)"
            value={newPincode}
            onChange={(e) =>
              setNewPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            style={inputBase}
          />
          <button
            type="button"
            onClick={() => void suggestPincode(false)}
            disabled={suggestBusy || addBusy}
            title="Re-run Google lookup for the first area name"
            className="uppercase"
            style={{
              ...primaryBtn,
              opacity: suggestBusy ? 0.6 : 1,
              cursor: suggestBusy ? "wait" : "pointer",
            }}
          >
            {suggestBusy ? "Looking…" : "↧ Pincode"}
          </button>
          <button
            type="button"
            onClick={submitNew}
            disabled={addBusy}
            className="uppercase"
            style={primaryBtn}
          >
            {addBusy ? "Activating…" : "Activate Area"}
          </button>
        </form>
        {addError && (
          <p
            style={{
              margin: "10px 0 0",
              color: "#ef4444",
              fontFamily: "var(--font-body)",
              fontSize: 16,
            }}
          >
            {addError}
          </p>
        )}
      </div>

      {/* Tab chips */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 12,
        }}
      >
        {(["active", "history", "all"] as Tab[]).map((t) => {
          const active = tab === t;
          const label = t === "active" ? "Active" : t === "history" ? "History" : "All";
          const c = counts[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="uppercase"
              style={{
                background: active ? "rgba(245,158,11,0.15)" : "transparent",
                border: `1px solid ${active ? "rgba(245,158,11,0.7)" : "rgba(245,158,11,0.25)"}`,
                color: active ? CREAM : "rgba(251,243,212,0.55)",
                padding: "6px 14px",
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.22em",
                cursor: "pointer",
              }}
            >
              {label}
              <span style={{ marginLeft: 8, opacity: 0.7 }}>{c}</span>
            </button>
          );
        })}
      </div>

      <input
        type="text"
        placeholder="Search by pincode or area…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ ...inputBase, width: "100%", marginBottom: 16 }}
      />

      {loading ? (
        <p style={mutedText}>Loading…</p>
      ) : error ? (
        <p style={{ ...mutedText, color: "#ef4444" }}>{error}</p>
      ) : filtered.length === 0 ? (
        <p style={mutedText}>No pincodes match.</p>
      ) : (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            overflow: "hidden",
            // Leave breathing room for the sticky bulk bar.
            marginBottom: selected.size > 0 ? 80 : 0,
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 640,
              }}
            >
              <thead>
                <tr style={{ background: "rgba(29,29,31,0.6)" }}>
                  <th style={{ ...th, width: 40, paddingRight: 6 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all visible"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected;
                      }}
                      onChange={toggleAllVisible}
                    />
                  </th>
                  <th style={th}>Pincode</th>
                  <th style={th}>Areas</th>
                  <th style={th}>Added</th>
                  <th style={th}>Status</th>
                  <th style={{ ...th, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => {
                  const checked = selected.has(g.pincode);
                  return (
                    <tr
                      key={g.pincode}
                      style={{
                        borderTop: `1px solid ${BORDER}`,
                        background: checked
                          ? "rgba(245,158,11,0.06)"
                          : "transparent",
                      }}
                    >
                      <td style={{ ...td, paddingRight: 6 }}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${g.pincode}`}
                          checked={checked}
                          onChange={() => toggleOne(g.pincode)}
                        />
                      </td>
                      <td style={{ ...td, fontWeight: 500, color: CREAM }}>
                        {g.pincode}
                      </td>
                      <td style={td}>{g.area_names.join(", ")}</td>
                      <td style={{ ...td, color: FADED, whiteSpace: "nowrap" }}>
                        {new Date(g.added_at).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td style={td}>
                        <span
                          className="uppercase"
                          style={{
                            fontFamily: "var(--font-body)",
                            fontSize: "0.875rem",
                            letterSpacing: "0.25em",
                            padding: "2px 8px",
                            borderRadius: 99,
                            border: g.is_active
                              ? "1px solid rgba(34,197,94,0.5)"
                              : "1px solid rgba(192,200,206,0.3)",
                            color: g.is_active ? "#bbf7d0" : FADED,
                            background: g.is_active
                              ? "rgba(34,197,94,0.12)"
                              : "transparent",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {g.is_active ? "Active" : "Paused"}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {g.is_active ? (
                          <button
                            onClick={() => deactivate(g.pincode)}
                            disabled={busy[g.pincode]}
                            className="uppercase"
                            style={dangerBtn}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => reactivate(g.pincode)}
                            disabled={busy[g.pincode]}
                            className="uppercase"
                            style={primaryBtn}
                          >
                            Reactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 200,
            background: "rgba(29,29,31,0.96)",
            borderTop: `1px solid ${DARK_GREEN}`,
            padding:
              "0.9rem clamp(1rem, 4vw, 1.5rem) calc(0.9rem + env(safe-area-inset-bottom))",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "space-between",
            }}
          >
            <div
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.22em",
                color: CREAM,
              }}
            >
              {selected.size} selected
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={clearSelection}
                disabled={bulkBusy}
                className="uppercase"
                style={{
                  ...primaryBtn,
                  color: FADED,
                  borderColor: "rgba(192,200,206,0.4)",
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void runBulk("activate")}
                disabled={bulkBusy}
                className="uppercase"
                style={{
                  ...primaryBtn,
                  cursor: bulkBusy ? "wait" : "pointer",
                  opacity: bulkBusy ? 0.6 : 1,
                }}
              >
                {bulkBusy ? "Working…" : "Activate"}
              </button>
              <button
                type="button"
                onClick={startBulkDeactivate}
                disabled={bulkBusy}
                className="uppercase"
                style={{
                  ...dangerBtn,
                  padding: "8px 16px",
                  fontSize: "0.875rem",
                  cursor: bulkBusy ? "wait" : "pointer",
                  opacity: bulkBusy ? 0.6 : 1,
                }}
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk deactivate confirmation */}
      {confirmDeactivate && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !bulkBusy && setConfirmDeactivate(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 400,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgb(6,4,2)",
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              maxWidth: 420,
              width: "100%",
              fontFamily: "var(--font-body)",
              color: CREAM,
              // 3-zone scrollable layout
              display: "flex",
              flexDirection: "column",
              maxHeight: "min(90vh, calc(100dvh - 2rem))",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                flexShrink: 0,
                padding: "1.25rem 1.5rem 1rem",
                background: "rgb(6,4,2)",
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <h3
                className="uppercase"
                style={{
                  margin: 0,
                  fontFamily: "var(--font-heading)",
                  fontWeight: 300,
                  fontSize: "1.1rem",
                  letterSpacing: "0.18em",
                  color: CREAM,
                }}
              >
                Confirm bulk deactivate
              </h3>
            </div>
            <div
              style={{
                flex: "1 1 auto",
                minHeight: 0,
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
                padding: "1rem 1.5rem",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: "1rem",
                  color: "rgba(251,243,212,0.75)",
                  lineHeight: 1.5,
                }}
              >
                You&rsquo;re about to deactivate{" "}
                <strong>{selected.size} pincode{selected.size === 1 ? "" : "s"}</strong>.
                Customers in these pincodes won&rsquo;t be able to check out until
                they&rsquo;re reactivated.
              </p>
            </div>
            <div
              style={{
                flexShrink: 0,
                padding: "1rem 1.5rem 1.25rem",
                background: "rgb(6,4,2)",
                borderTop: `1px solid ${BORDER}`,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => setConfirmDeactivate(false)}
                disabled={bulkBusy}
                className="uppercase"
                style={{
                  ...primaryBtn,
                  color: FADED,
                  borderColor: "rgba(192,200,206,0.4)",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runBulk("deactivate")}
                disabled={bulkBusy}
                className="uppercase"
                style={{
                  ...dangerBtn,
                  padding: "8px 16px",
                  fontSize: "0.875rem",
                  cursor: bulkBusy ? "wait" : "pointer",
                  opacity: bulkBusy ? 0.6 : 1,
                }}
              >
                {bulkBusy ? "Working…" : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk import modal */}
      {bulkImportOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !bulkImportBusy && setBulkImportOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 400,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgb(6,4,2)",
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              maxWidth: 640,
              width: "100%",
              fontFamily: "var(--font-body)",
              color: CREAM,
              display: "flex",
              flexDirection: "column",
              maxHeight: "min(90vh, calc(100dvh - 2rem))",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                flexShrink: 0,
                padding: "1.25rem 1.5rem 1rem",
                background: "rgb(6,4,2)",
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <h3
                className="uppercase"
                style={{
                  margin: 0,
                  fontFamily: "var(--font-heading)",
                  fontWeight: 300,
                  fontSize: "1.1rem",
                  letterSpacing: "0.18em",
                  color: CREAM,
                }}
              >
                Bulk import pincodes
              </h3>
              <p
                style={{
                  margin: "0.5rem 0 0",
                  fontSize: "1rem",
                  color: FADED,
                  lineHeight: 1.5,
                }}
              >
                Paste pincodes from a verified source like India Post
                (indiapost.gov.in). One per line, optionally{" "}
                <span style={{ color: CREAM }}>pincode, area name</span>.
                Missing area names default to &ldquo;Vizag&rdquo;.
              </p>
            </div>

            {/* Body */}
            <div
              style={{
                flex: "1 1 auto",
                minHeight: 0,
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
                padding: "1rem 1.5rem",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <textarea
                value={bulkImportText}
                onChange={(e) => setBulkImportText(e.target.value)}
                placeholder={
                  "530001\n530002, Dabagardens\n530017, MVP Colony"
                }
                spellCheck={false}
                rows={12}
                style={{
                  ...inputBase,
                  width: "100%",
                  resize: "vertical",
                  minHeight: 200,
                  fontFamily: "var(--font-mono, ui-monospace, monospace)",
                  fontSize: 16,
                  lineHeight: 1.5,
                  whiteSpace: "pre",
                }}
              />

              {/* Preview counts — only meaningful once the operator has
                  pasted something. */}
              {bulkImportText.trim().length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    padding: "10px 12px",
                    background: "rgba(245,158,11,0.06)",
                    border: `1px solid ${BORDER}`,
                    borderRadius: 6,
                    fontSize: 16,
                  }}
                >
                  <span style={{ color: "#bbf7d0" }}>
                    Will add <strong>{parsedBulk.newCount}</strong> new
                    {parsedBulk.newCount === 1 ? " area" : " areas"}
                  </span>
                  <span style={{ color: FADED }}>·</span>
                  <span style={{ color: FADED }}>
                    {parsedBulk.existingCount} already exist
                  </span>
                  <span style={{ color: FADED }}>·</span>
                  <span
                    style={{
                      color:
                        parsedBulk.invalidCount > 0 ? "#ef4444" : FADED,
                    }}
                  >
                    {parsedBulk.invalidCount} invalid line
                    {parsedBulk.invalidCount === 1 ? "" : "s"}
                  </span>
                </div>
              )}

              {/* Surface up to a handful of bad lines so the operator
                  can spot typos without scrolling the textarea. */}
              {parsedBulk.invalidLines.length > 0 && (
                <div
                  style={{
                    fontSize: 16,
                    color: "rgba(239,68,68,0.85)",
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    background: "rgba(239,68,68,0.05)",
                    border: "1px solid rgba(239,68,68,0.25)",
                    borderRadius: 6,
                    padding: "8px 10px",
                    maxHeight: 120,
                    overflowY: "auto",
                  }}
                >
                  <div
                    className="uppercase"
                    style={{
                      letterSpacing: "0.2em",
                      fontSize: 14,
                      marginBottom: 4,
                      color: "#ef4444",
                    }}
                  >
                    Invalid lines (skipped)
                  </div>
                  {parsedBulk.invalidLines.slice(0, 10).map((l, i) => (
                    <div key={i}>{l || "(blank)"}</div>
                  ))}
                  {parsedBulk.invalidLines.length > 10 && (
                    <div style={{ opacity: 0.7 }}>
                      …and {parsedBulk.invalidLines.length - 10} more
                    </div>
                  )}
                </div>
              )}

              {bulkImportError && (
                <p
                  style={{
                    margin: 0,
                    color: "#ef4444",
                    fontFamily: "var(--font-body)",
                    fontSize: 16,
                  }}
                >
                  {bulkImportError}
                </p>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                flexShrink: 0,
                padding: "1rem 1.5rem 1.25rem",
                background: "rgb(6,4,2)",
                borderTop: `1px solid ${BORDER}`,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setBulkImportOpen(false);
                  setBulkImportError(null);
                }}
                disabled={bulkImportBusy}
                className="uppercase"
                style={{
                  ...primaryBtn,
                  color: FADED,
                  borderColor: "rgba(192,200,206,0.4)",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitBulkImport()}
                disabled={bulkImportBusy || parsedBulk.newCount === 0}
                className="uppercase"
                style={{
                  ...primaryBtn,
                  cursor: bulkImportBusy ? "wait" : "pointer",
                  opacity:
                    bulkImportBusy || parsedBulk.newCount === 0 ? 0.6 : 1,
                }}
              >
                {bulkImportBusy
                  ? "Importing…"
                  : `Import ${parsedBulk.newCount} area${parsedBulk.newCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

const inputBase: React.CSSProperties = {
  background: "rgba(29,29,31,0.6)",
  border: `1px solid ${BORDER}`,
  borderRadius: 4,
  padding: "8px 12px",
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: 16,
  letterSpacing: "0.04em",
  outline: "none",
};

const primaryBtn: React.CSSProperties = {
  border: `1px solid ${GOLD}`,
  color: GOLD,
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.25em",
  padding: "8px 16px",
  background: "transparent",
  cursor: "pointer",
};

const dangerBtn: React.CSSProperties = {
  border: "1px solid rgba(239,68,68,0.5)",
  color: "#ef4444",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.25em",
  padding: "6px 12px",
  background: "transparent",
  cursor: "pointer",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.25em",
  color: FADED,
  textTransform: "uppercase",
  fontWeight: 500,
};

const td: React.CSSProperties = {
  padding: "10px 14px",
  fontFamily: "var(--font-body)",
  fontSize: 16,
  color: "rgba(251,243,212,0.85)",
  verticalAlign: "middle",
};

const mutedText: React.CSSProperties = {
  color: FADED,
  fontFamily: "var(--font-body)",
  fontSize: 16,
};
