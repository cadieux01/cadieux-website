"use client";

// Task detail — header + comment thread. Comments are newest-LAST
// (chat convention) and append-only; there is no edit UI.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { MKT } from "@/components/mkt/theme";
import { useMktProfile } from "@/components/mkt/MktProfileContext";

type Comment = {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author: { full_name: string | null; email: string | null } | null;
};

type Task = {
  id: string;
  title: string;
  detail: string | null;
  assignee_id: string | null;
  team_id: string | null;
  due_date: string | null;
  cadence: "one-off" | "daily" | "weekly" | "monthly";
  status: "todo" | "in_progress" | "done" | "blocked";
  progress: number;
};

export function TaskDetailClient({ id }: { id: string }) {
  const me = useMktProfile();
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [tRes, cRes] = await Promise.all([
        fetch("/api/mkt/tasks", { cache: "no-store" }),
        fetch(`/api/mkt/tasks/${id}/comments`, { cache: "no-store" }),
      ]);
      if (!tRes.ok) throw new Error(`tasks ${tRes.status}`);
      const tJ = (await tRes.json()) as { tasks: Task[] };
      const match = (tJ.tasks ?? []).find((t) => t.id === id) ?? null;
      setTask(match);
      if (cRes.ok) {
        const cJ = (await cRes.json()) as { comments: Comment[] };
        setComments(cJ.comments ?? []);
      } else {
        setError(`comments ${cRes.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const res = await fetch(`/api/mkt/tasks/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setDraft("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Post failed");
    } finally {
      setSending(false);
    }
  };

  if (!task && !error) {
    return <p style={{ color: MKT.mute }}>Loading…</p>;
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <Link href="/mkt/tasks" style={{ color: MKT.blue, fontSize: "0.88rem" }}>
          ← All tasks
        </Link>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            border: `1px solid ${MKT.error}`,
            background: MKT.errorBg,
            color: MKT.error,
            padding: "0.6rem 0.8rem",
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      ) : null}

      {task ? (
        <section
          style={{
            background: "#FFFFFF",
            border: `1px solid ${MKT.ash}`,
            borderRadius: 10,
            padding: "0.8rem 1rem",
            boxShadow: MKT.cardShadow,
            display: "grid",
            gap: "0.3rem",
          }}
        >
          <strong style={{ fontSize: "1.1rem" }}>{task.title}</strong>
          {task.detail ? (
            <p style={{ margin: 0, color: MKT.ink }}>{task.detail}</p>
          ) : null}
          <div style={{ display: "flex", gap: "0.6rem", color: MKT.mute, fontSize: "0.86rem" }}>
            <span>status: {task.status}</span>
            <span>progress: {task.progress}%</span>
            <span>due: {task.due_date ?? "—"}</span>
            <span>cadence: {task.cadence}</span>
          </div>
        </section>
      ) : null}

      <section
        style={{
          background: "#FFFFFF",
          border: `1px solid ${MKT.ash}`,
          borderRadius: 10,
          padding: "0.8rem 1rem",
          boxShadow: MKT.cardShadow,
          display: "grid",
          gap: "0.6rem",
        }}
      >
        <h2 style={{ margin: 0, color: MKT.green, fontSize: "1.05rem", fontWeight: 700 }}>
          Comments
        </h2>
        {comments.length === 0 ? (
          <p style={{ color: MKT.mute, margin: 0, fontSize: "0.92rem" }}>
            No comments yet.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
            {comments.map((c) => {
              const name =
                c.author?.full_name ??
                c.author?.email ??
                (c.author_id === me.id ? "You" : "Someone");
              return (
                <li
                  key={c.id}
                  style={{
                    border: `1px solid ${MKT.ash}`,
                    borderRadius: 8,
                    padding: "0.5rem 0.7rem",
                    background: c.author_id === me.id ? MKT.hover : "#FFFFFF",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      fontSize: "0.82rem",
                      color: MKT.mute,
                      marginBottom: "0.2rem",
                    }}
                  >
                    <strong style={{ color: MKT.ink }}>{name}</strong>
                    <span>{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  <p style={{ margin: 0, whiteSpace: "pre-wrap", color: MKT.ink, fontSize: "0.92rem" }}>
                    {c.body}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-end" }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Add a comment"
            style={{ flex: 1 }}
            maxLength={4000}
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !draft.trim()}
            style={{
              background: MKT.green,
              color: MKT.cream,
              border: "none",
              padding: "0.5rem 0.9rem",
              borderRadius: 6,
              fontWeight: 600,
              cursor: "pointer",
              opacity: sending || !draft.trim() ? 0.6 : 1,
            }}
          >
            Post
          </button>
        </div>
      </section>
    </div>
  );
}
