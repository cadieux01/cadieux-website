import { requireMktSession } from "@/lib/mkt-auth";
import { MktShell } from "@/components/mkt/MktShell";
import { TaskDetailClient } from "./TaskDetailClient";

export default async function TaskDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireMktSession();
  return (
    <MktShell title="Task" subtitle="Comments and progress">
      <TaskDetailClient id={params.id} />
    </MktShell>
  );
}
