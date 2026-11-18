"use client";

// Campaign detail — edit the fields, save as template, upload
// content / proof / photos. Uploads go through mktUploadViaSignedUrl
// which calls the SAME maybeResizeImageForUpload as the admin lane,
// so no one can accidentally re-open the egress leak on this surface.

import { useCallback, useEffect, useState } from "react";

import { MKT } from "@/components/mkt/theme";
import { mktUploadViaSignedUrl } from "@/lib/mkt-upload";

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

type Asset = {
  id: string;
  campaign_id: string;
  kind: "content" | "proof" | "photo";
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
  signed_url: string | null;
};

const STATUSES: Campaign["status"][] = ["planned", "active", "paused", "done", "cancelled"];
const KINDS: Asset["kind"][] = ["content", "proof", "photo"];

export function CampaignDetailClient({ id }: { id: string }) {
  const [c, setC] = useState<Campaign | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadKind, setUploadKind] = useState<Asset["kind"]>("content");
  const [uploadPending, setUploadPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, a] = await Promise.all([
        fetch(`/api/mkt/campaigns/${id}`, { cache: "no-store" }),
        fetch(`/api/mkt/campaigns/${id}/assets`, { cache: "no-store" }),
      ]);
      if (!r.ok) throw new Error(`campaign ${r.status}`);
      const j = (await r.json()) as { campaign: Campaign };
      setC(j.campaign);
      if (a.ok) {
        const aJ = (await a.json()) as { assets: Asset[] };
        setAssets(aJ.assets ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Partial<Campaign>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/mkt/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const saveAsTemplate = () => patch({ is_template: true });

  const handleUpload = async (file: File) => {
    setError(null);
    setUploadPending(file.name);
    try {
      const prefix = `campaign/${id}`;
      const up = await mktUploadViaSignedUrl(file, {
        bucket: "campaign-assets",
        prefix,
      });
      const res = await fetch(`/api/mkt/campaigns/${id}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage_path: up.path,
          kind: uploadKind,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadPending(null);
    }
  };

  if (error && !c) {
    return (
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
    );
  }
  if (!c) {
    return <p style={{ color: MKT.mute }}>Loading…</p>;
  }

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

      <section
        style={{
          background: "#FFFFFF",
          border: `1px solid ${MKT.ash}`,
          borderRadius: 10,
          padding: "0.8rem 1rem",
          boxShadow: MKT.cardShadow,
          display: "grid",
          gap: "0.5rem",
        }}
      >
        <label style={labelStyle}>
          Name
          <input
            value={c.name}
            onChange={(e) => setC({ ...c, name: e.target.value })}
            onBlur={() => patch({ name: c.name })}
            disabled={busy}
          />
        </label>
        <label style={labelStyle}>
          Objective
          <input
            value={c.objective ?? ""}
            onChange={(e) => setC({ ...c, objective: e.target.value })}
            onBlur={() => patch({ objective: c.objective })}
            disabled={busy}
          />
        </label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "0.4rem",
          }}
        >
          <label style={labelStyle}>
            Status
            <select
              value={c.status}
              onChange={(e) =>
                patch({ status: e.target.value as Campaign["status"] })
              }
              disabled={busy}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Starts
            <input
              type="date"
              value={c.starts_on ?? ""}
              onChange={(e) => patch({ starts_on: e.target.value || null })}
              disabled={busy}
            />
          </label>
          <label style={labelStyle}>
            Ends
            <input
              type="date"
              value={c.ends_on ?? ""}
              onChange={(e) => patch({ ends_on: e.target.value || null })}
              disabled={busy}
            />
          </label>
          <label style={labelStyle}>
            Budget (₹)
            <input
              type="number"
              min={0}
              value={Math.round((c.budget_paise ?? 0) / 100)}
              onChange={(e) =>
                setC({
                  ...c,
                  budget_paise: Math.max(0, Math.round(Number(e.target.value) * 100)),
                })
              }
              onBlur={() => patch({ budget_paise: c.budget_paise })}
              disabled={busy}
            />
          </label>
          <label style={labelStyle}>
            Props (₹)
            <input
              type="number"
              min={0}
              value={Math.round((c.props_cost_paise ?? 0) / 100)}
              onChange={(e) =>
                setC({
                  ...c,
                  props_cost_paise: Math.max(0, Math.round(Number(e.target.value) * 100)),
                })
              }
              onBlur={() => patch({ props_cost_paise: c.props_cost_paise })}
              disabled={busy}
            />
          </label>
          <label style={labelStyle}>
            People needed
            <input
              type="number"
              min={0}
              value={c.headcount_needed}
              onChange={(e) =>
                setC({ ...c, headcount_needed: Math.max(0, Math.round(Number(e.target.value))) })
              }
              onBlur={() => patch({ headcount_needed: c.headcount_needed })}
              disabled={busy}
            />
          </label>
        </div>
        <label style={labelStyle}>
          Detail
          <textarea
            rows={3}
            value={c.detail ?? ""}
            onChange={(e) => setC({ ...c, detail: e.target.value })}
            onBlur={() => patch({ detail: c.detail })}
            disabled={busy}
          />
        </label>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={saveAsTemplate}
            disabled={busy || c.is_template}
            style={btnPrimary}
          >
            {c.is_template ? "Already a template" : "Save as template"}
          </button>
        </div>
      </section>

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
        <h2 style={h2Style}>Assets</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <label style={{ fontSize: "0.86rem", color: MKT.mute }}>
            Kind
            <select
              value={uploadKind}
              onChange={(e) => setUploadKind(e.target.value as Asset["kind"])}
              style={{ marginLeft: "0.3rem" }}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = "";
            }}
          />
          {uploadPending ? (
            <span style={{ color: MKT.mute, fontSize: "0.86rem" }}>
              Uploading {uploadPending}…
            </span>
          ) : null}
        </div>
        {assets.length === 0 ? (
          <p style={{ color: MKT.mute, fontSize: "0.92rem", margin: 0 }}>
            Nothing attached yet.
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: "0.5rem",
            }}
          >
            {assets.map((a) => (
              <li
                key={a.id}
                style={{
                  border: `1px solid ${MKT.ash}`,
                  borderRadius: 6,
                  padding: "0.3rem",
                  display: "grid",
                  gap: "0.2rem",
                  background: "#FFFFFF",
                }}
              >
                {a.signed_url &&
                /\.(jpg|jpeg|png|webp)(\?|$)/i.test(a.storage_path) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.signed_url}
                    alt={a.caption ?? a.kind}
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      objectFit: "cover",
                      borderRadius: 4,
                    }}
                  />
                ) : a.signed_url ? (
                  <a
                    href={a.signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "block",
                      aspectRatio: "1 / 1",
                      background: MKT.hover,
                      borderRadius: 4,
                      textAlign: "center",
                      lineHeight: 1,
                      padding: "1rem",
                      color: MKT.blue,
                    }}
                  >
                    Open PDF ↗
                  </a>
                ) : (
                  <span style={{ color: MKT.mute, fontSize: "0.82rem" }}>
                    No signed URL
                  </span>
                )}
                <span style={{ fontSize: "0.74rem", color: MKT.mute }}>
                  {a.kind}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.2rem",
  fontSize: "0.86rem",
  color: MKT.mute,
};
const h2Style: React.CSSProperties = {
  margin: 0,
  color: MKT.green,
  fontSize: "1.05rem",
  fontWeight: 700,
};
const btnPrimary: React.CSSProperties = {
  background: MKT.green,
  color: MKT.cream,
  border: "none",
  padding: "0.4rem 0.8rem",
  borderRadius: 6,
  fontSize: "0.86rem",
  fontWeight: 600,
  cursor: "pointer",
};
