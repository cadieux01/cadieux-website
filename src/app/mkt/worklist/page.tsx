// /mkt/worklist?segment=<name> — a one-card-at-a-time queue over a CRM
// segment. Server gate requires an active profile (NOT admin-only);
// the brief says the team needs to work this.
//
// WHY ONE AT A TIME and not a compact list: the operator's loop is
// "pick up the phone, log the outcome, next". A compact list splits
// attention across rows and makes an outcome click ambiguous. Showing
// one card at a time with Next/Prev + outcome buttons that auto-advance
// mirrors the physical workflow — a stack of index cards.

import { MktShell } from "@/components/mkt/MktShell";
import { requireMktSession } from "@/lib/mkt-auth";
import { parseSegment, SEGMENT_LABEL } from "@/lib/mkt-crm";
import { WorklistClient } from "./WorklistClient";

export default async function WorklistPage({
  searchParams,
}: {
  searchParams: { segment?: string };
}) {
  await requireMktSession();
  const segment = parseSegment(searchParams?.segment ?? null);
  return (
    <MktShell
      title={`Worklist · ${SEGMENT_LABEL[segment]}`}
      subtitle="One customer at a time. Log an outcome; the queue moves on."
    >
      <WorklistClient segment={segment} />
    </MktShell>
  );
}
