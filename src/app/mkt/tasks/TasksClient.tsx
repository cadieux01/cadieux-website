"use client";

// Client UI for /mkt/tasks. Pulls goals + tasks from /api/mkt/*, lets
// the caller filter by cadence or "overdue", assign + reassign, change
// status, drag progress. Everything is client-side after the initial
// fetch — the dataset is small and RLS already keeps rows scoped to
// what the caller can see.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MKT } from "@/components/mkt/theme";
import { useMktProfile } from "@/components/mkt/MktProfileContext";

type Task = {
  id: string;
  title: string;
  detail: string | null;
  assignee_id: string | null;
  created_by: string | null;
  team_id: string | null;
  goal_id: string | null;
  due_date: string | null;
  cadence: "one-off" | "daily" | "weekly" | "monthly";
  status: "todo" | "in_progress" | "done" | "blocked";
  progress: number;
  created_at: string;
  updated_at: string;
};
type Goal = {
  id: string;
  title: string;
  detail: string | null;
  horizon: "short" | "long";
  target_date: string | null;
  owner_id: string | null;
  team_id: string | null;
};
type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
};

const CADENCES = ["one-off", "daily", "weekly", "monthly"] as const;
const STATUSES = ["todo", "in_progress", "done", "blocked"] as const;
type Filter = "mine" | "all" | "overdue" | (typeof CADENCES)[number];
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "mine", label: "My tasks" },
  { key: "all", label: "All tasks" },
  { key: "overdue", label: "Overdue" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

export function TasksClient() {
  const me = useMktProfile();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("mine");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, p] = await Promise.all([
        fetch("/api/mkt/tasks", { cache: "no-store" }),
        // profiles endpoint is admin-only; fall back silently for
        // non-admin callers who can't assign across people they don't
        // administer.
        fetch("/api/mkt/profiles", { cache: "no-store" }),
      ]);
      if (!t.ok) throw new Error(`tasks ${t.status}`);
      const tJ = (await t.json()) as {
        tasks: Task[];
        goals: Goal[];
        me: string;
      };
      setTasks(tJ.tasks ?? []);
      setGoals(tJ.goals ?? []);
      if (p.ok) {
        const pJ = (await p.json()) as { profiles: Profile[] };
        setProfiles(pJ.profiles ?? []);
      } else {
        // Non-admin: minimum viable — at least show the signed-in
        // user as an assignee option so they can own tasks.
        setProfiles([{ id: me.id, full_name: me.full_name, email: me.email }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [me]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchTask = async (id: string, body: Partial<Task>) => {
    try {
      const res = await fetch(`/api/mkt/tasks/${id}`, {
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
    }
  };

  // New-task form
  const [newTitle, setNewTitle] = useState("");
  const [newCadence, setNewCadence] = useState<(typeof CADENCES)[number]>("one-off");
  const [newDue, setNewDue] = useState("");
  const [newAssignee, setNewAssignee] = useState(me.id);
  const [newGoalId, setNewGoalId] = useState("");
  const createTask = async () => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch("/api/mkt/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          cadence: newCadence,
          due_date: newDue || null,
          assignee_id: newAssignee || null,
          goal_id: newGoalId || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewTitle("");
      setNewDue("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  // New-goal form
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalHorizon, setNewGoalHorizon] = useState<"short" | "long">("short");
  const [newGoalTarget, setNewGoalTarget] = useState("");
  const createGoal = async () => {
    if (!newGoalTitle.trim()) return;
    try {
      const res = await fetch("/api/mkt/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newGoalTitle.trim(),
          horizon: newGoalHorizon,
          target_date: newGoalTarget || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewGoalTitle("");
      setNewGoalTarget("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const visible = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return tasks.filter((t) => {
      if (filter === "mine") return t.assignee_id === me.id;
      if (filter === "all") return true;
      if (filter === "overdue") {
        if (!t.due_date) return false;
        if (t.status === "done") return false;
        const d = new Date(t.due_date);
        return d.getTime() < today.getTime();
      }
      return t.cadence === filter;
    });
  }, [tasks, filter, me.id]);

  const nameOf = (id: string | null): string => {
    if (!id) return "—";
    const p = profiles.find((pp) => pp.id === id);
    return p?.full_name ?? p?.email ?? id.slice(0, 8);
  };

  return (
    <div style={{ display: "grid", gap: "1.4rem" }}>
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

      {/* Goals */}
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
            flexWrap: "wrap",
            gap: "0.6rem",
            marginBottom: "0.6rem",
          }}
        >
          <h2 style={h2Style}>Goals</h2>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <input
              value={newGoalTitle}
              onChange={(e) => setNewGoalTitle(e.target.value)}
              placeholder="New goal"
            />
            <select
              value={newGoalHorizon}
              onChange={(e) => setNewGoalHorizon(e.target.value as "short" | "long")}
            >
              <option value="short">Short</option>
              <option value="long">Long</option>
            </select>
            <input
              type="date"
              value={newGoalTarget}
              onChange={(e) => setNewGoalTarget(e.target.value)}
            />
            <button
              type="button"
              onClick={createGoal}
              disabled={!newGoalTitle.trim()}
              style={btnPrimary}
            >
              Add goal
            </button>
          </div>
        </div>
        {goals.length === 0 ? (
          <p style={{ color: MKT.mute, fontSize: "0.92rem", margin: 0 }}>
            No goals yet.
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gap: "0.4rem",
            }}
          >
            {goals.map((g) => (
              <li
                key={g.id}
                style={{
                  border: `1px solid ${MKT.ash}`,
                  borderRadius: 8,
                  padding: "0.5rem 0.7rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span
                    style={{
                      color: MKT.green,
                      fontSize: "0.72rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      fontWeight: 700,
                      marginRight: "0.4rem",
                    }}
                  >
                    {g.horizon}
                  </span>
                  <strong>{g.title}</strong>
                </div>
                <span style={{ color: MKT.mute, fontSize: "0.86rem" }}>
                  {g.target_date ?? "no target"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            style={{
              padding: "0.35rem 0.75rem",
              borderRadius: 999,
              border: `1px solid ${filter === f.key ? MKT.green : MKT.ash}`,
              background: filter === f.key ? MKT.green : "#FFFFFF",
              color: filter === f.key ? MKT.cream : MKT.ink,
              fontSize: "0.86rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* New task */}
      <section
        style={{
          background: "#FFFFFF",
          border: `1px solid ${MKT.ash}`,
          borderRadius: 10,
          padding: "0.8rem 1rem",
          boxShadow: MKT.cardShadow,
        }}
      >
        <h2 style={h2Style}>New task</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "0.5rem",
          }}
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title"
          />
          <select
            value={newCadence}
            onChange={(e) => setNewCadence(e.target.value as (typeof CADENCES)[number])}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
          />
          <select
            value={newAssignee}
            onChange={(e) => setNewAssignee(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? p.email ?? p.id.slice(0, 8)}
              </option>
            ))}
          </select>
          <select
            value={newGoalId}
            onChange={(e) => setNewGoalId(e.target.value)}
          >
            <option value="">No goal</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={createTask}
            disabled={!newTitle.trim()}
            style={btnPrimary}
          >
            Create
          </button>
        </div>
      </section>

      {/* Tasks */}
      {visible.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${MKT.ash}`,
            borderRadius: 8,
            padding: "1.4rem 1rem",
            textAlign: "center",
            color: MKT.mute,
            background: "#FFFFFF",
          }}
        >
          Nothing matches this filter.
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
          {visible.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              profiles={profiles}
              assigneeName={nameOf(t.assignee_id)}
              onPatch={(body) => patchTask(t.id, body)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskRow({
  task,
  profiles,
  assigneeName,
  onPatch,
}: {
  task: Task;
  profiles: Profile[];
  assigneeName: string;
  onPatch: (body: Partial<Task>) => Promise<void>;
}) {
  const overdue =
    task.status !== "done" &&
    !!task.due_date &&
    new Date(task.due_date).getTime() < new Date().setHours(0, 0, 0, 0);
  return (
    <li
      style={{
        border: `1px solid ${overdue ? MKT.error : MKT.ash}`,
        borderRadius: 8,
        padding: "0.6rem 0.8rem",
        background: "#FFFFFF",
        display: "grid",
        gap: "0.35rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <Link
          href={`/mkt/tasks/${task.id}`}
          style={{ color: MKT.ink, fontSize: "1rem", fontWeight: 700 }}
        >
          {task.title}
        </Link>
        <span style={{ color: MKT.mute, fontSize: "0.82rem" }}>
          {task.due_date ? (
            <span style={{ color: overdue ? MKT.error : MKT.mute, fontWeight: overdue ? 700 : 400 }}>
              {task.due_date}
            </span>
          ) : (
            "no date"
          )}{" "}
          · {task.cadence}
        </span>
      </div>
      {task.detail ? (
        <p style={{ margin: 0, color: MKT.ink, fontSize: "0.92rem" }}>{task.detail}</p>
      ) : null}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          flexWrap: "wrap",
          alignItems: "center",
          fontSize: "0.85rem",
        }}
      >
        <label style={{ color: MKT.mute }}>
          Status{" "}
          <select
            value={task.status}
            onChange={(e) => onPatch({ status: e.target.value as Task["status"] })}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ color: MKT.mute }}>
          Assignee{" "}
          <select
            value={task.assignee_id ?? ""}
            onChange={(e) =>
              onPatch({ assignee_id: e.target.value || null })
            }
          >
            <option value="">unassigned</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? p.email ?? p.id.slice(0, 8)}
              </option>
            ))}
          </select>
          {task.assignee_id ? (
            <span style={{ color: MKT.mute, marginLeft: 6 }}>({assigneeName})</span>
          ) : null}
        </label>
        <label style={{ color: MKT.mute }}>
          Due{" "}
          <input
            type="date"
            value={task.due_date ?? ""}
            onChange={(e) => onPatch({ due_date: e.target.value || null })}
          />
        </label>
        <label style={{ color: MKT.mute, display: "flex", alignItems: "center", gap: "0.3rem" }}>
          Progress{" "}
          <input
            type="range"
            min={0}
            max={100}
            value={task.progress}
            onChange={(e) => onPatch({ progress: Number(e.target.value) })}
            style={{ padding: 0, background: "transparent", border: 0 }}
          />
          <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "right" }}>
            {task.progress}%
          </span>
        </label>
      </div>
    </li>
  );
}

const h2Style: React.CSSProperties = {
  margin: "0 0 0.3rem",
  color: MKT.green,
  fontSize: "1.05rem",
  fontWeight: 700,
};
const btnPrimary: React.CSSProperties = {
  background: MKT.green,
  color: MKT.cream,
  border: "none",
  padding: "0.4rem 0.75rem",
  borderRadius: 6,
  fontSize: "0.86rem",
  fontWeight: 600,
  cursor: "pointer",
};
