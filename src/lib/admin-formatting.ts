// Hand-rolled formatting helpers. We deliberately don't install
// date-fns or dayjs — the surface area we need is tiny, and the
// existing admin code already formats dates with toLocaleDateString.

export function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "—";
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "+91 98765 43210" → tel-friendly link payload.
 * Anything that already starts with + is preserved; otherwise we
 * assume Indian numbers and prepend +91 to the 10-digit local form.
 */
export function telHref(phone: string | null | undefined): string {
  if (!phone) return "";
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return `tel:${cleaned}`;
  const tail = cleaned.slice(-10);
  return tail.length === 10 ? `tel:+91${tail}` : `tel:${cleaned}`;
}

/**
 * https://wa.me/<phone> requires a digit-only number, no + or spaces.
 * Mirrors telHref's normalisation rule (assume +91 if missing).
 */
export function whatsAppHref(phone: string | null | undefined): string {
  if (!phone) return "";
  const cleaned = phone.replace(/\D/g, "");
  // If 10 digits, assume Indian and prepend 91. If 11+, take as-is.
  const final = cleaned.length === 10 ? `91${cleaned}` : cleaned;
  return `https://wa.me/${final}`;
}

/** YYYY-MM-DD in the local timezone — used for date-range filters. */
export function isoLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add `days` calendar days to an ISO YYYY-MM-DD string. UTC math. */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
