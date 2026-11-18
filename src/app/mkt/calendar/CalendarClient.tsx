"use client";

// /mkt/calendar — weekly / monthly views over logistics.tasks
// (due_date) and logistics.campaigns ([starts_on, ends_on]).
//
// Read-only. Today is highlighted. Overdue tasks render in red.
// Clicking a task jumps to /mkt/tasks; clicking a campaign jumps to
// /mkt/campaigns/[id]. The grid works at phone width (the week-row
// collapses to one column, cells grow to full width).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MKT } from "@/components/mkt/theme";
import {
  addDays,
  daysInMonthGrid,
  daysInWeek,
  isOverdue,
  parseIsoLocalDate,
  sameMonth,
  startOfMonthGrid,
  startOfWeek,
  toIsoLocalDate,
  type CalendarCampaign,
  type CalendarTask,
  type CalendarView,
} from "@/lib/mkt-calendar";

export function CalendarClient() {
  const [view, setView] = useState<CalendarView>("week");
  const [cursor, setCursor] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [campaigns, setCampaigns] = useState<CalendarCampaign[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return toIsoLocalDate(d);
  }, []);

  // The range the backend should return. Week view fetches 7 days;
  // month view fetches the 42-cell grid (6 weeks) so neighbouring
  // months' spillover is populated.
  const [from, to] = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(cursor);
      return [toIsoLocalDate(start), toIsoLocalDate(addDays(start, 6))];
    }
    const start = startOfMonthGrid(cursor);
    return [toIsoLocalDate(start), toIsoLocalDate(addDays(start, 41))];
  }, [cursor, view]);

  const load = useCallback(async () => {
    setTasksError(null);
    setCampaignsError(null);
    try {
      const res = await fetch(
        `/api/mkt/calendar?from=${from}&to=${to}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as {
        tasks: CalendarTask[];
        tasks_error: string | null;
        campaigns: CalendarCampaign[];
        campaigns_error: string | null;
      };
      setTasks(j.tasks ?? []);
      setCampaigns(j.campaigns ?? []);
      if (j.tasks_error) setTasksError(j.tasks_error);
      if (j.campaigns_error) setCampaignsError(j.campaigns_error);
    } catch (e) {
      setTasksError(e instanceof Error ? e.message : "Load failed");
    }
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  const tasksByDay = useMemo(() => {
    const m = new Map<string, CalendarTask[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      const bucket = m.get(t.due_date) ?? [];
      bucket.push(t);
      m.set(t.due_date, bucket);
    }
    return m;
  }, [tasks]);

  const campaignsByDay = useMemo(() => {
    const m = new Map<string, CalendarCampaign[]>();
    for (const c of campaigns) {
      let d = parseIsoLocalDate(c.starts_on);
      const end = parseIsoLocalDate(c.ends_on);
      if (!d || !end) continue;
      while (d <= end) {
        const iso = toIsoLocalDate(d);
        const bucket = m.get(iso) ?? [];
        bucket.push(c);
        m.set(iso, bucket);
        d = addDays(d, 1);
      }
    }
    return m;
  }, [campaigns]);

  const title = useMemo(() => {
    const d = cursor;
    if (view === "week") {
      const start = startOfWeek(d);
      const end = addDays(start, 6);
      const fmt = (x: Date) =>
        x.toLocaleDateString(undefined, { day: "numeric", month: "short" });
      return `${fmt(start)} – ${fmt(end)}`;
    }
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [cursor, view]);

  const shift = (dir: 1 | -1) => {
    if (view === "week") {
      setCursor((c) => addDays(c, 7 * dir));
    } else {
      setCursor(
        (c) =>
          new Date(c.getFullYear(), c.getMonth() + dir, 1, 0, 0, 0, 0),
      );
    }
  };

  const goToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setCursor(d);
  };

  const days = view === "week" ? daysInWeek(cursor) : daysInMonthGrid(cursor);

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div style={{ display: "flex", gap: "0.3rem" }}>
          <button type="button" style={btnQuiet} onClick={() => shift(-1)}>
            ←
          </button>
          <button type="button" style={btnQuiet} onClick={goToday}>
            Today
          </button>
          <button type="button" style={btnQuiet} onClick={() => shift(1)}>
            →
          </button>
        </div>
        <strong style={{ color: MKT.green, fontSize: "1.1rem" }}>{title}</strong>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          <button
            type="button"
            style={view === "week" ? btnActive : btnQuiet}
            onClick={() => setView("week")}
          >
            Week
          </button>
          <button
            type="button"
            style={view === "month" ? btnActive : btnQuiet}
            onClick={() => setView("month")}
          >
            Month
          </button>
        </div>
      </div>

      {tasksError ? (
        <div style={errBox}>Tasks slice failed: {tasksError}</div>
      ) : null}
      {campaignsError ? (
        <div style={errBox}>
          Campaigns slice failed: {campaignsError}
          <br />
          <small>
            The calendar still works for tasks. The campaigns table may not be
            deployed to this environment yet (feat/mkt-campaigns branch).
          </small>
        </div>
      ) : null}

      <div
        className="mkt-cal-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: "0.3rem",
        }}
      >
        {/* Weekday headers */}
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((wd) => (
          <div
            key={wd}
            style={{
              color: MKT.mute,
              fontSize: "0.78rem",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontWeight: 700,
              padding: "0.2rem 0.3rem",
            }}
          >
            {wd}
          </div>
        ))}

        {days.map((d) => {
          const iso = toIsoLocalDate(d);
          const isToday = iso === today;
          const inMonth = view === "week" || sameMonth(d, cursor);
          const dayTasks = tasksByDay.get(iso) ?? [];
          const dayCampaigns = campaignsByDay.get(iso) ?? [];
          return (
            <div
              key={iso}
              style={{
                background: "#FFFFFF",
                border: isToday
                  ? `2px solid ${MKT.green}`
                  : `1px solid ${MKT.ash}`,
                borderRadius: 8,
                padding: "0.4rem",
                minHeight: view === "week" ? 160 : 100,
                opacity: inMonth ? 1 : 0.5,
                boxShadow: isToday ? MKT.cardShadow : "none",
                display: "grid",
                gap: "0.2rem",
                alignContent: "start",
              }}
            >
              <div
                style={{
                  color: isToday ? MKT.green : MKT.ink,
                  fontWeight: isToday ? 700 : 500,
                  fontSize: "0.86rem",
                  marginBottom: "0.1rem",
                }}
              >
                {d.getDate()}
                {isToday ? (
                  <span
                    style={{
                      marginLeft: "0.3rem",
                      color: MKT.green,
                      fontSize: "0.7rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Today
                  </span>
                ) : null}
              </div>
              {dayCampaigns.slice(0, 2).map((c) => (
                <Link
                  key={`c-${c.id}`}
                  href={`/mkt/campaigns/${c.id}`}
                  style={{
                    background: "rgba(67,105,178,0.12)",
                    color: MKT.blue,
                    padding: "0.15rem 0.4rem",
                    borderRadius: 4,
                    fontSize: "0.76rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={c.name}
                >
                  ▸ {c.name}
                </Link>
              ))}
              {dayCampaigns.length > 2 ? (
                <span style={{ color: MKT.mute, fontSize: "0.72rem" }}>
                  +{dayCampaigns.length - 2} more campaigns
                </span>
              ) : null}
              {dayTasks.slice(0, view === "week" ? 10 : 3).map((t) => {
                const overdue = isOverdue(t, today);
                return (
                  <Link
                    key={`t-${t.id}`}
                    href="/mkt/tasks"
                    style={{
                      background: overdue
                        ? "rgba(179,38,30,0.1)"
                        : "rgba(2,70,40,0.08)",
                      color: overdue ? MKT.error : MKT.green,
                      padding: "0.15rem 0.4rem",
                      borderRadius: 4,
                      fontSize: "0.76rem",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      fontWeight: overdue ? 700 : 400,
                    }}
                    title={t.title}
                  >
                    {overdue ? "⚠ " : "• "}
                    {t.title}
                  </Link>
                );
              })}
              {dayTasks.length > (view === "week" ? 10 : 3) ? (
                <span style={{ color: MKT.mute, fontSize: "0.72rem" }}>
                  +{dayTasks.length - (view === "week" ? 10 : 3)} more tasks
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (max-width: 700px) {
              .mkt-cal-grid { grid-template-columns: 1fr !important; }
            }
          `,
        }}
      />
    </div>
  );
}

const btnQuiet: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${MKT.ash}`,
  padding: "0.3rem 0.65rem",
  borderRadius: 6,
  color: MKT.ink,
  fontSize: "0.86rem",
  cursor: "pointer",
};
const btnActive: React.CSSProperties = {
  ...btnQuiet,
  background: MKT.green,
  color: MKT.cream,
  borderColor: MKT.green,
  fontWeight: 600,
};
const errBox: React.CSSProperties = {
  border: `1px solid ${MKT.error}`,
  background: MKT.errorBg,
  color: MKT.error,
  padding: "0.5rem 0.7rem",
  borderRadius: 8,
  fontSize: "0.88rem",
};
