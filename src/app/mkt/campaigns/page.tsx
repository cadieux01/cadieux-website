// /mkt/campaigns — list view for the marketing campaigns surface.
//
// Server-gated by requireMktSession() — any active profile may land
// here; the row-level visibility (admin sees all, owner sees theirs,
// team member sees team) is RLS on the campaigns table.

import { requireMktSession } from "@/lib/mkt-auth";
import { MktShell } from "@/components/mkt/MktShell";
import { CampaignsClient } from "./CampaignsClient";

export default async function CampaignsPage() {
  await requireMktSession();
  return (
    <MktShell title="Campaigns" subtitle="Plan, run, and keep what worked">
      <CampaignsClient />
    </MktShell>
  );
}
