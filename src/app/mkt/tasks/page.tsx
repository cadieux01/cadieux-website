// /mkt/tasks — everyone with an active profile can see their tasks.
// Goals sit above; the view is "goals (ongoing) → tasks (actionable)".
//
// Server-side gate: requireMktSession() without requireAdmin, so a
// marketing teammate can land here. Admin sees everyone's work via RLS.

import { requireMktSession } from "@/lib/mkt-auth";
import { MktShell } from "@/components/mkt/MktShell";
import { TasksClient } from "./TasksClient";

export default async function TasksPage() {
  await requireMktSession();

  return (
    <MktShell title="Tasks" subtitle="Goals and the work that pushes them">
      <TasksClient />
    </MktShell>
  );
}
