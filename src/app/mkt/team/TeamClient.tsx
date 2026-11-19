"use client";

// Client UI for /mkt/team. The server component next door has already
// gated this surface on admin + active, so this file does no auth
// checks of its own — the admin shape is enforced again on every API
// call it makes, so a middle-of-session role change is caught by the
// next request rather than being papered over client-side.

import { useCallback, useEffect, useMemo, useState } from "react";

import { MKT } from "@/components/mkt/theme";

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  created_at: string;
};

type Team = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

type Member = {
  team_id: string;
  profile_id: string;
  is_leader: boolean;
  added_at: string;
};

const ROLES = ["admin", "marketing", "sales", "partner"] as const;
const STATUSES = ["active", "inactive", "deactivated", "deleted"] as const;

export function TeamClient() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [pRes, tRes] = await Promise.all([
        fetch("/api/mkt/profiles", { cache: "no-store" }),
        fetch("/api/mkt/teams", { cache: "no-store" }),
      ]);
      if (!pRes.ok) throw new Error(`profiles ${pRes.status}`);
      if (!tRes.ok) throw new Error(`teams ${tRes.status}`);
      const pJ = (await pRes.json()) as { profiles: Profile[] };
      const tJ = (await tRes.json()) as { teams: Team[]; members: Member[] };
      setProfiles(pJ.profiles ?? []);
      setTeams(tJ.teams ?? []);
      setMembers(tJ.members ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchProfile = async (
    id: string,
    body: Partial<Pick<Profile, "role" | "status">>,
  ) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/mkt/profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const [newTeamName, setNewTeamName] = useState("");
  const createTeam = async () => {
    if (!newTeamName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/mkt/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewTeamName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleLeader = async (teamId: string, profileId: string, next: boolean) => {
    setBusy(true);
    try {
      const existing = members.find(
        (m) => m.team_id === teamId && m.profile_id === profileId,
      );
      const res = existing
        ? await fetch(`/api/mkt/teams/${teamId}/members`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profile_id: profileId, is_leader: next }),
          })
        : await fetch(`/api/mkt/teams/${teamId}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profile_id: profileId, is_leader: next }),
          });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (teamId: string, profileId: string) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/mkt/teams/${teamId}/members?profile_id=${encodeURIComponent(profileId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  const membersByTeam = useMemo(() => {
    const m = new Map<string, Member[]>();
    for (const row of members) {
      const list = m.get(row.team_id) ?? [];
      list.push(row);
      m.set(row.team_id, list);
    }
    return m;
  }, [members]);

  return (
    <div style={{ display: "grid", gap: "1.6rem" }}>
      {error ? (
        <div
          role="alert"
          style={{
            border: `1px solid ${MKT.error}`,
            background: MKT.errorBg,
            color: MKT.error,
            padding: "0.6rem 0.8rem",
            borderRadius: 8,
            fontSize: "0.9rem",
          }}
        >
          {error}
        </div>
      ) : null}

      {/* New person */}
      <AddPersonCard onCreated={() => void load()} />

      {/* People */}
      <section
        style={{
          background: "#FFFFFF",
          border: `1px solid ${MKT.ash}`,
          borderRadius: 10,
          padding: "0.8rem 1rem",
          boxShadow: MKT.cardShadow,
        }}
      >
        <h2 style={h2Style}>People</h2>
        {profiles.length === 0 ? (
          <p style={{ color: MKT.mute, fontSize: "0.92rem" }}>No profiles yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ textAlign: "left", color: MKT.mute, fontSize: "0.82rem" }}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${MKT.ash}` }}>
                    <td style={tdStyle}>{p.full_name ?? "—"}</td>
                    <td style={tdStyle}>{p.email ?? "—"}</td>
                    <td style={tdStyle}>
                      <select
                        value={p.role}
                        disabled={busy}
                        onChange={(e) => patchProfile(p.id, { role: e.target.value })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={p.status}
                        disabled={busy}
                        onChange={(e) => patchProfile(p.id, { status: e.target.value })}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      {p.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => patchProfile(p.id, { status: "inactive" })}
                          disabled={busy}
                          style={btnQuiet}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => patchProfile(p.id, { status: "active" })}
                          disabled={busy}
                          style={btnPrimary}
                        >
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Teams */}
      <section
        style={{
          background: "#FFFFFF",
          border: `1px solid ${MKT.ash}`,
          borderRadius: 10,
          padding: "0.8rem 1rem",
          boxShadow: MKT.cardShadow,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "0.6rem",
            flexWrap: "wrap",
            marginBottom: "0.5rem",
          }}
        >
          <h2 style={h2Style}>Teams</h2>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="New team name"
            />
            <button
              type="button"
              onClick={createTeam}
              disabled={!newTeamName.trim() || busy}
              style={btnPrimary}
            >
              Create
            </button>
          </div>
        </div>
        {teams.length === 0 ? (
          <p style={{ color: MKT.mute, fontSize: "0.92rem" }}>No teams yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.8rem" }}>
            {teams.map((t) => {
              const tMembers = membersByTeam.get(t.id) ?? [];
              return (
                <div
                  key={t.id}
                  style={{
                    border: `1px solid ${MKT.ash}`,
                    borderRadius: 8,
                    padding: "0.6rem 0.8rem",
                  }}
                >
                  <div style={{ fontWeight: 700, color: MKT.green, marginBottom: "0.3rem" }}>
                    {t.name}
                  </div>
                  <AddMemberRow
                    teamId={t.id}
                    members={tMembers}
                    profiles={profiles}
                    onPick={(profileId, asLeader) =>
                      toggleLeader(t.id, profileId, asLeader)
                    }
                  />
                  {tMembers.length === 0 ? (
                    <p style={{ margin: "0.4rem 0 0", color: MKT.mute, fontSize: "0.88rem" }}>
                      No members yet.
                    </p>
                  ) : (
                    <ul
                      style={{
                        listStyle: "none",
                        padding: 0,
                        margin: "0.4rem 0 0",
                        display: "grid",
                        gap: "0.2rem",
                      }}
                    >
                      {tMembers.map((m) => {
                        const p = profiles.find((pp) => pp.id === m.profile_id);
                        return (
                          <li
                            key={m.profile_id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "0.3rem 0.5rem",
                              borderRadius: 6,
                              background: MKT.hover,
                              fontSize: "0.9rem",
                            }}
                          >
                            <span>
                              {p?.full_name ?? p?.email ?? m.profile_id}
                              {m.is_leader ? (
                                <span
                                  style={{
                                    marginLeft: "0.4rem",
                                    color: MKT.green,
                                    fontSize: "0.72rem",
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.1em",
                                  }}
                                >
                                  Leader
                                </span>
                              ) : null}
                            </span>
                            <span style={{ display: "flex", gap: "0.3rem" }}>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  toggleLeader(t.id, m.profile_id, !m.is_leader)
                                }
                                style={btnQuiet}
                              >
                                {m.is_leader ? "Unset leader" : "Appoint leader"}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => removeMember(t.id, m.profile_id)}
                                style={btnQuiet}
                              >
                                Remove
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function AddMemberRow({
  teamId,
  members,
  profiles,
  onPick,
}: {
  teamId: string;
  members: Member[];
  profiles: Profile[];
  onPick: (profileId: string, asLeader: boolean) => void;
}) {
  // Suppress the teamId unused-prop warning without plumbing — kept
  // in the signature in case a future refactor needs to scope the
  // profile list by membership status per team.
  void teamId;
  const inTeam = new Set(members.map((m) => m.profile_id));
  const [picked, setPicked] = useState("");
  const addable = profiles.filter((p) => !inTeam.has(p.id));
  return (
    <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
      <select
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        style={{ minWidth: 180 }}
      >
        <option value="">Add person…</option>
        {addable.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name ?? p.email ?? p.id}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          if (!picked) return;
          onPick(picked, false);
          setPicked("");
        }}
        disabled={!picked}
        style={btnPrimary}
      >
        Add
      </button>
    </div>
  );
}

const h2Style: React.CSSProperties = {
  margin: "0 0 0.5rem",
  color: MKT.green,
  fontSize: "1.05rem",
  fontWeight: 700,
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.92rem",
};
const thStyle: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
};
const tdStyle: React.CSSProperties = {
  padding: "0.5rem 0.6rem",
  color: MKT.ink,
};
const btnPrimary: React.CSSProperties = {
  background: MKT.green,
  color: MKT.cream,
  border: "none",
  padding: "0.35rem 0.75rem",
  borderRadius: 6,
  fontSize: "0.82rem",
  fontWeight: 600,
  cursor: "pointer",
};
const btnQuiet: React.CSSProperties = {
  background: "transparent",
  color: MKT.blue,
  border: `1px solid ${MKT.ash}`,
  padding: "0.3rem 0.6rem",
  borderRadius: 6,
  fontSize: "0.8rem",
  cursor: "pointer",
};

// ── Add person ─────────────────────────────────────────────────────

// Separate component from the main TeamClient so the one-time password
// state (deliberately scoped to this form) cannot leak via a parent
// re-render when the people list refreshes. The password is SHOWN
// ONCE, with a Copy button and a Clear button; dismissing the card
// drops it from memory. There is no way to re-reveal it — same
// contract the API documents in its module header.
function AddPersonCard({ onCreated }: { onCreated: () => void }) {
  const [full_name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("marketing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    name: string;
    email: string;
    password: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const canSubmit =
    !busy &&
    full_name.trim().length > 0 &&
    email.trim().length > 0 &&
    phone.replace(/\D/g, "").length >= 10;

  const submit = async () => {
    setError(null);
    setCopied(false);
    setBusy(true);
    try {
      const res = await fetch("/api/mkt/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: full_name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.replace(/\D/g, "").slice(-10),
          role,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      setCreated({
        name: full_name.trim(),
        email: email.trim().toLowerCase(),
        password: j.one_time_password,
      });
      // Clear the form so the admin can't accidentally re-submit.
      setName("");
      setEmail("");
      setPhone("");
      setRole("marketing");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create person");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied — operator can select+copy manually */
    }
  };

  return (
    <section
      style={{
        background: "#FFFFFF",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 10,
        padding: "0.8rem 1rem",
        boxShadow: MKT.cardShadow,
      }}
    >
      <h2 style={h2Style}>Add person</h2>
      <p style={{ color: MKT.mute, fontSize: "0.86rem", margin: "0 0 0.5rem" }}>
        Creates a login + a profile. A one-time password appears below —
        share it with the new teammate and have them reset it on first sign-in.
      </p>

      {error ? (
        <div
          role="alert"
          style={{
            border: `1px solid ${MKT.error}`,
            background: MKT.errorBg,
            color: MKT.error,
            padding: "0.5rem 0.7rem",
            borderRadius: 6,
            fontSize: "0.88rem",
            marginBottom: "0.5rem",
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.5rem",
          alignItems: "end",
        }}
      >
        <label style={labelStyle}>
          Name
          <input
            value={full_name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            placeholder="Full name"
          />
        </label>
        <label style={labelStyle}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            placeholder="person@example.com"
            autoComplete="off"
          />
        </label>
        <label style={labelStyle}>
          Phone
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            placeholder="10-digit"
            inputMode="numeric"
          />
        </label>
        <label style={labelStyle}>
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
            disabled={busy}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          style={{
            ...btnPrimary,
            opacity: canSubmit ? 1 : 0.5,
            cursor: canSubmit ? "pointer" : "not-allowed",
            padding: "0.5rem 0.9rem",
          }}
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>

      {created ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: "0.6rem",
            border: `1px solid ${MKT.green}`,
            background: "rgba(2,70,40,0.06)",
            padding: "0.55rem 0.8rem",
            borderRadius: 8,
            display: "grid",
            gap: "0.35rem",
          }}
        >
          <strong style={{ color: MKT.green, fontSize: "0.92rem" }}>
            {created.name} ({created.email}) created
          </strong>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: MKT.mute, fontSize: "0.82rem" }}>
              One-time password:
            </span>
            <code
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: "1rem",
                background: "#FFFFFF",
                padding: "0.2rem 0.5rem",
                border: `1px solid ${MKT.ash}`,
                borderRadius: 4,
                userSelect: "all",
              }}
            >
              {created.password}
            </code>
            <button
              type="button"
              onClick={copy}
              style={{
                ...btnQuiet,
                color: copied ? MKT.green : MKT.blue,
                borderColor: copied ? MKT.green : MKT.ash,
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => setCreated(null)}
              style={btnQuiet}
            >
              Clear
            </button>
          </div>
          <p style={{ color: MKT.mute, fontSize: "0.78rem", margin: 0 }}>
            This is shown ONCE. If you lose it, the new teammate can reset
            their password from /mkt/login.
          </p>
        </div>
      ) : null}
    </section>
  );
}

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.2rem",
  fontSize: "0.84rem",
  color: MKT.mute,
};
