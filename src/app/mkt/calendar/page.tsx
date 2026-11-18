import { requireMktSession } from "@/lib/mkt-auth";
import { MktShell } from "@/components/mkt/MktShell";
import { CalendarClient } from "./CalendarClient";

export default async function CalendarPage() {
  await requireMktSession();
  return (
    <MktShell title="Calendar" subtitle="Tasks by due date, campaigns by run window">
      <CalendarClient />
    </MktShell>
  );
}
