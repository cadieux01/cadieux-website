// /mkt/money — admin-only money dashboard.
//
// Server-gated by requireMktSession({ requireAdmin: true }). Numbers
// are fetched client-side via /api/mkt/money so the first paint
// renders a skeleton and the data lands as it arrives.

import { MktShell } from "@/components/mkt/MktShell";
import { requireMktSession } from "@/lib/mkt-auth";
import { MoneyClient } from "./MoneyClient";

export default async function MoneyPage() {
  await requireMktSession({ requireAdmin: true });
  return (
    <MktShell title="Money" subtitle="Weekly target, repeat rate, where the money comes in">
      <MoneyClient />
    </MktShell>
  );
}
