// CSV builder for admin exports. Stays client-side because every list
// page already holds the filtered+sorted rows in component state — no
// reason to round-trip through the server just to format them.
//
// Three concerns covered here:
//   1) CSV injection: cells starting with =, +, -, @, tab, or CR are
//      prefixed with a single quote so spreadsheet apps don't execute
//      them as formulas.
//   2) Escaping: cells containing comma, double-quote, newline, or CR
//      are wrapped in double quotes with embedded quotes doubled.
//   3) Filename: cadieux-{kind}-YYYYMMDD-HHmm.csv in local time, which
//      matches how the operator thinks about "today's orders".

const DANGEROUS_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function escapeCell(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let s = typeof raw === "string" ? raw : String(raw);

  if (s.length > 0 && DANGEROUS_LEADERS.has(s[0]!)) {
    s = `'${s}`;
  }

  const mustQuote =
    s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r");
  if (mustQuote) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => unknown;
};

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const headerLine = columns.map((c) => escapeCell(c.header)).join(",");
  const lines = rows.map((r) =>
    columns.map((c) => escapeCell(c.value(r))).join(","),
  );
  // Excel and Numbers both default to UTF-8 only when a BOM is present.
  // Without it, accented characters in customer names render as mojibake.
  return `\ufeff${headerLine}\n${lines.join("\n")}\n`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function csvFilename(kind: string, now: Date = new Date()): string {
  const stamp =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  return `cadieux-${kind}-${stamp}.csv`;
}

export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick before revoking — some Safari builds drop
  // the download if the URL is freed in the same microtask.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
