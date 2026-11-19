"use client";

// Campaigns list + create. Templates are shown in a separate pane so
// "Run again" has something to click. Money is displayed in rupees
// (paise ÷ 100) but every SUM accumulates in paise — same convention
// as the rest of /mkt and /admin, so the reader does not have to
// guess which direction a value is in.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MKT } from "@/components/mkt/theme";
import { mktFetch, mktPost } from "@/lib/mkt-fetch";

type Campaign = {
  id: string;
  name: string;
  objective: string | null;
  status: "planned" | "active" | "paused" | "done" | "cancelled";
  starts_on: string | null;
  ends_on: string | null;
  budget_paise: number;
  props_cost_paise: number;
  headcount_needed: number;
  detail: string | null;
  owner_id: string | null;
  team_id: string | null;
  is_template: boolean;
  cloned_from_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const STATUSES: Array<Campaign["status"]> = [
  "planned",
  "active",
  "paused",
  "done",
  "cancelled",
];

export function CampaignsClient() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rJ, tJ] = await Promise.all([
        mktFetch<{ campaigns: Campaign[] }>("/api/mkt/campaigns?template=0"),
        mktFetch<{ campaigns: Campaign[] }>("/api/mkt/campaigns?template=1"),
      ]);
      setRows(rJ.campaigns ?? []);
      setTemplates(tJ.campaigns ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const [newName, setNewName] = useState("");
  const [newStarts, setNewStarts] = useState("");
  const [newEnds, setNewEnds] = useState("");
  const createCampaign = async () => {
    if (busy || !newName.trim()) return; // double-click guard
    setBusy(true);
    try {
      await mktPost("/api/mkt/campaigns", {
        name: newName.trim(),
        starts_on: newStarts || null,
        ends_on: newEnds || null,
      });
      setNewName("");
      setNewStarts("");
      setNewEnds("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const runAgain = async (template: Campaign) => {
    if (busy) return;
    setBusy(true);
    try {
      await mktPost(`/api/mkt/campaigns/${template.id}/clone`, {
        name: `${template.name} (new run)`,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clone failed");
    } finally {
      setBusy(false);
    }
  };

  const totals = useMemo(() => {
    // Accumulate money in PAISE; divide once for display.
    const budget = rows.reduce((s, c) => s + (c.budget_paise ?? 0), 0);
    const props = rows.reduce((s, c) => s + (c.props_cost_paise ?? 0), 0);
    return {
      budget_rupees: budget / 100,
      props_rupees: props / 100,
    };
  }, [rows]);

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
          }}
        >
          {error}
        </div>
      ) : null}

      {/* New campaign */}
      <section
        style={{
          background: "#FFFFFF",
          border: `1px solid ${MKT.ash}`,
          borderRadius: 10,
          padding: "0.8rem 1rem",
          boxShadow: MKT.cardShadow,
        }}
      >
        <h2 style={h2Style}>New campaign</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "0.5rem",
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Campaign name"
          />
          <input
            type="date"
            value={newStarts}
            onChange={(e) => setNewStarts(e.target.value)}
          />
          <input
            type="date"
            value={newEnds}
            onChange={(e) => setNewEnds(e.target.value)}
          />
          <button
            type="button"
            onClick={createCampaign}
            disabled={busy || !newName.trim()}
            style={btnPrimary}
          >
            Create
          </button>
        </div>
      </section>

      {/* Totals strip */}
      <section
        style={{
          display: "flex",
          gap: "1.4rem",
          flexWrap: "wrap",
          color: MKT.mute,
          fontSize: "0.92rem",
        }}
      >
        <span>
          {rows.length} campaign{rows.length === 1 ? "" : "s"}
        </span>
        <span>
          Budget total{" "}
          <strong style={{ color: MKT.ink }}>
            {new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
              maximumFractionDigits: 0,
            }).format(totals.budget_rupees)}
          </strong>
        </span>
        <span>
          Props total{" "}
          <strong style={{ color: MKT.ink }}>
            {new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
              maximumFractionDigits: 0,
            }).format(totals.props_rupees)}
          </strong>
        </span>
      </section>

      {/* Campaigns */}
      <section
        style={{
          background: "#FFFFFF",
          border: `1px solid ${MKT.ash}`,
          borderRadius: 10,
          padding: "0.8rem 1rem",
          boxShadow: MKT.cardShadow,
        }}
      >
        <h2 style={h2Style}>Campaigns</h2>
        {rows.length === 0 ? (
          <p style={{ color: MKT.mute, fontSize: "0.92rem" }}>
            No campaigns yet.
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
            {rows.map((c) => (
              <CampaignRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </section>

      {/* Templates */}
      <section
        style={{
          background: "#FFFFFF",
          border: `1px solid ${MKT.ash}`,
          borderRadius: 10,
          padding: "0.8rem 1rem",
          boxShadow: MKT.cardShadow,
        }}
      >
        <h2 style={h2Style}>Templates</h2>
        {templates.length === 0 ? (
          <p style={{ color: MKT.mute, fontSize: "0.92rem" }}>
            No templates yet. Save a campaign as a template from its page to run
            it again later.
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
            {templates.map((t) => (
              <li
                key={t.id}
                style={{
                  border: `1px solid ${MKT.ash}`,
                  borderRadius: 8,
                  padding: "0.6rem 0.8rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: "0.6rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <strong>{t.name}</strong>
                  {t.objective ? (
                    <span style={{ color: MKT.mute, marginLeft: "0.5rem" }}>
                      · {t.objective}
                    </span>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <Link
                    href={`/mkt/campaigns/${t.id}`}
                    style={{ color: MKT.blue, fontSize: "0.9rem" }}
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runAgain(t)}
                    style={btnPrimary}
                  >
                    Run again
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CampaignRow({ c }: { c: Campaign }) {
  return (
    <li
      style={{
        border: `1px solid ${MKT.ash}`,
        borderRadius: 8,
        padding: "0.6rem 0.8rem",
        background: "#FFFFFF",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: "0.6rem",
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Link
          href={`/mkt/campaigns/${c.id}`}
          style={{ color: MKT.ink, fontWeight: 600 }}
        >
          {c.name}
        </Link>
        {c.objective ? (
          <span style={{ color: MKT.mute, marginLeft: "0.5rem" }}>
            · {c.objective}
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          color: MKT.mute,
          fontSize: "0.88rem",
          flexWrap: "wrap",
        }}
      >
        <StatusBadge status={c.status} />
        <span>
          {c.starts_on ?? "no start"}
          {" · "}
          {c.ends_on ?? "no end"}
        </span>
        <span>
          Budget{" "}
          {new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 0,
          }).format((c.budget_paise ?? 0) / 100)}
        </span>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: Campaign["status"] }) {
  const palette: Record<Campaign["status"], { bg: string; fg: string }> = {
    planned: { bg: "rgba(67,105,178,0.1)", fg: MKT.blue },
    active: { bg: "rgba(2,70,40,0.12)", fg: MKT.green },
    paused: { bg: "rgba(29,29,31,0.1)", fg: MKT.mute },
    done: { bg: "rgba(2,70,40,0.1)", fg: MKT.green },
    cancelled: { bg: "rgba(179,38,30,0.1)", fg: MKT.error },
  };
  const p = palette[status];
  return (
    <span
      style={{
        padding: "0.1rem 0.5rem",
        borderRadius: 999,
        background: p.bg,
        color: p.fg,
        fontSize: "0.78rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {status}
    </span>
  );
}

const h2Style: React.CSSProperties = {
  margin: "0 0 0.5rem",
  color: MKT.green,
  fontSize: "1.05rem",
  fontWeight: 700,
};
const btnPrimary: React.CSSProperties = {
  background: MKT.green,
  color: MKT.cream,
  border: "none",
  padding: "0.6rem 0.9rem",
  minHeight: 44,
  borderRadius: 6,
  fontSize: "0.92rem",
  fontWeight: 600,
  cursor: "pointer",
};

// Reference STATUSES so an un-used import doesn't lint-fail; it's
// here to pin the type-level set used by the API.
void STATUSES;
