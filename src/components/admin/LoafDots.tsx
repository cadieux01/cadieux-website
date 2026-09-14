// One dot per loaf, under the OLF number on every order row.
//
// Green = Plain, red = Multigrain. Two plain + two multigrain reads as
// two green dots and two red dots, so the operator sees the bag contents
// without opening the order. These are the ONLY colours in admin outside
// the cream/green two-colour palette — deliberate, and scoped to here.
//
// A variant we don't recognise gets a hollow cream dot rather than being
// silently counted as Plain.

import type { AdminOrderItemSnapshot } from "@/lib/admin-shared";

const PLAIN = "#3FBF6A";
const MULTIGRAIN = "#D6453F";

type LoafKind = "plain" | "multigrain" | "other";

function loafKind(name: string | null | undefined): LoafKind {
  const n = String(name ?? "").toLowerCase();
  if (n.includes("multigrain")) return "multigrain";
  if (n.includes("plain")) return "plain";
  return "other";
}

function qtyOf(it: AdminOrderItemSnapshot): number {
  const q = Number(it.quantity ?? it.qty ?? 0);
  if (!Number.isFinite(q) || q <= 0) return 0;
  // Guard against a bad row painting thousands of nodes.
  return Math.min(Math.floor(q), 99);
}

export function LoafDots({
  items,
}: {
  items: AdminOrderItemSnapshot[] | null | undefined;
}) {
  if (!items || items.length === 0) return null;

  const dots: { kind: LoafKind; label: string }[] = [];
  for (const it of items) {
    const kind = loafKind(it.name);
    const label = String(it.name ?? "Item").trim() || "Item";
    for (let i = 0; i < qtyOf(it); i++) dots.push({ kind, label });
  }
  if (dots.length === 0) return null;

  const summary = dots.map((d) => d.label).join(", ");

  return (
    <div
      className="flex flex-wrap items-center gap-1"
      style={{ marginTop: 6 }}
      title={summary}
      aria-label={`Loaves: ${summary}`}
    >
      {dots.map((d, i) => (
        <span
          key={i}
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            display: "inline-block",
            background:
              d.kind === "plain"
                ? PLAIN
                : d.kind === "multigrain"
                  ? MULTIGRAIN
                  : "transparent",
            border:
              d.kind === "other"
                ? "1px solid rgba(251,243,212,0.6)"
                : "none",
          }}
        />
      ))}
    </div>
  );
}
