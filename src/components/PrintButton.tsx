"use client";

// The only client-side code on any receipt. window.print() needs a browser,
// so this is a leaf component rather than a reason to make a whole page a
// client component — a receipt's name, phone and address are fetched and
// authorised on the server and must stay there.
//
// No PDF library. The browser's own print dialog already produces a PDF via
// "Save as PDF" on every platform the customer might be on, so shipping a
// renderer would add a dependency to re-implement a feature the OS has.
//
// `.no-print` is hidden by the @media print block in ReceiptShell.
//
// Lives in components/ rather than beside one route because three documents
// use it now: the order receipt, the subscription summary and the
// per-delivery note.

export default function PrintButton({ label }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print"
      style={{
        appearance: "none",
        border: "1px solid rgba(2,70,40,0.25)",
        background: "#024628",
        color: "#FBF3D4",
        borderRadius: 2,
        padding: "12px 22px",
        fontSize: 12,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {label ?? "Download receipt"}
    </button>
  );
}
