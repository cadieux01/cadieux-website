// /mkt/team — admin-only roster + team management.
//
// This is a SERVER component that runs requireMktSession({
// requireAdmin: true }) before anything renders. A non-admin landing
// here is redirected to /mkt?denied=admin so the shell can surface
// the reason. No client-side gate because that would show the page
// chrome briefly to a non-admin.
//
// The data (profiles, teams, membership) hydrates in the client
// component below from /api/mkt/profiles + /api/mkt/teams, both
// of which re-check the admin shape on every request.

import { requireMktSession } from "@/lib/mkt-auth";
import { MktShell } from "@/components/mkt/MktShell";
import { TeamClient } from "./TeamClient";

export default async function TeamPage() {
  // Server-side gate — redirects on inactive / non-admin / absent.
  await requireMktSession({ requireAdmin: true });

  return (
    <MktShell title="Team" subtitle="People, roles, and leadership">
      <TeamClient />
    </MktShell>
  );
}
