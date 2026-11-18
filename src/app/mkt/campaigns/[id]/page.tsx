import { requireMktSession } from "@/lib/mkt-auth";
import { MktShell } from "@/components/mkt/MktShell";
import { CampaignDetailClient } from "./CampaignDetailClient";

export default async function CampaignDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireMktSession();
  return (
    <MktShell title="Campaign" subtitle="Edit, upload, save as template">
      <CampaignDetailClient id={params.id} />
    </MktShell>
  );
}
