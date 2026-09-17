// Hand-rolled formatting helpers. We deliberately don't install
// date-fns or dayjs — the surface area we need is tiny, and the
// existing admin code already formats dates with toLocaleDateString.

import { MONTH_SHORT } from "@/lib/date-names";

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

const IST = "Asia/Kolkata";
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Y/M/D as they land in IST, as numbers rather than a formatted string —
 *  the month comes back as a number so the caller can name it from
 *  MONTH_SHORT instead of letting ICU render September as "Sept". */
export function istDateParts(d: Date): {
  day: number;
  month: number;
  year: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { day: get("day"), month: get("month"), year: get("year") };
}

/** "17 Sep 2026".
 *
 *  Two shapes arrive here and they are not the same kind of thing:
 *
 *  - `delivery_date` / `scheduled_date` are IST CALENDAR DATES ("2026-09-17"),
 *    not instants. They are rendered digit-for-digit. Putting them through a
 *    timezone is how a delivery lands on the board a day early.
 *  - `created_at` and friends are real timestamps, rendered in IST so the
 *    board reads the same from a laptop in another zone.
 *
 *  The month is spelled from MONTH_SHORT, not Intl month:"short", which
 *  renders September as "Sept" on current ICU. */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  if (typeof iso === "string") {
    const m = CALENDAR_DATE_RE.exec(iso.trim());
    if (m) {
      const month = Number(m[2]);
      if (month < 1 || month > 12) return "—";
      return `${Number(m[3])} ${MONTH_SHORT[month - 1]} ${m[1]}`;
    }
  }
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const { day, month, year } = istDateParts(d);
  return `${day} ${MONTH_SHORT[month - 1]} ${year}`;
}

/** "17 Sep 2026, 10:30 am", in IST. Only ever called with real timestamps. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const { day, month, year } = istDateParts(d);
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${day} ${MONTH_SHORT[month - 1]} ${year}, ${time}`;
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
