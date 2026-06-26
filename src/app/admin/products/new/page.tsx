"use client";

// Create-product page. POSTs to /api/admin/products and redirects to
// the editor on success.

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  ProductForm,
  ProductFormValues,
  emptyFormValues,
  valuesToPayload,
} from "@/components/admin/ProductForm";
import { usePinGate } from "@/components/admin/PinGateModal";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { AdminProductRow } from "@/lib/admin-shared";

export default function NewProductPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PIN gate — creating a product writes to the live catalogue.
  const { requirePin, modal: pinModal } = usePinGate();

  async function submit(values: ProductFormValues) {
    setError(null);

    // Require the security PIN before creating a live catalogue entry.
    const grant = await requirePin();
    if (!grant) return; // operator cancelled

    setBusy(true);
    try {
      // For create, omit slug entirely when blank so the server can
      // derive it from name. Empty string would fail validation.
      const payload = valuesToPayload(values);
      if (!values.slug.trim()) delete payload.slug;
      const res = await adminFetch<{ product: AdminProductRow }>(
        "/api/admin/products",
        {
          method: "POST",
          body: JSON.stringify(payload),
          headers: { "x-pin-grant": grant },
        },
      );
      router.push(`/admin/products/${res.product.id}`);
    } catch (e) {
      const msg =
        e instanceof AdminFetchError ? e.message : "Failed to create product";
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <AdminShell title="New product" subtitle="Add to catalogue">
      <ProductForm
        initial={emptyFormValues()}
        submitLabel="Create"
        onSubmit={submit}
        busy={busy}
        error={error}
      />
      {pinModal}
    </AdminShell>
  );
}
