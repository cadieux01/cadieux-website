"use client";

// Admin: the "Zone rules" panel.
//
// Two tables: LEARNED RULES (the ones the resolver reads at priority 3 and
// 4) and ROW PINS (single-row overrides for addresses with no keyable
// content). Delete on either runs the same server-side preview the popover
// runs, so removing a rule from here always shows the operator what will
// move before the write.

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { AdminFetchError } from "@/lib/admin-client";
import {
  ZONE_LABELS,
  normaliseLocalityKey,
  normalisePincodeKey,
} from "@/lib/delivery-zones";
import {
  deleteRowOverride,
  deleteRule,
  fetchAllRules,
  previewRule,
  type PreviewResponse,
  type ZoneRulesResponse,
} from "@/lib/zone-rules-client";

const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.18)";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ZoneRulesPage() {
  const [data, setData] = useState<ZoneRulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    kind: "rule";
    id: string;
    label: string;
    p: PreviewResponse;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAllRules();
      setData(res);
    } catch (err) {
      const msg = err instanceof AdminFetchError ? err.message : "Failed to load.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const askDeleteRule = useCallback(
    async (rule: ZoneRulesResponse["rules"][number]) => {
      setBusy(true);
      setError(null);
      try {
        const p = await previewRule({
          key_type: rule.key_type,
          key_input: rule.key_input,
          zone: "clear",
        });
        setPreview({ kind: "rule", id: rule.id, label: rule.key_input, p });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const confirmDeleteRule = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await deleteRule(preview.id);
      setPreview(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [preview, load]);

  const removePin = useCallback(
    async (id: string) => {
      if (!confirm("Remove this pin? The row will fall back to the built-in map.")) return;
      setBusy(true);
      try {
        await deleteRowOverride(id);
        await load();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const rules = data?.rules ?? [];
  const overrides = data?.overrides ?? [];

  // Drift detector. `key_input` is stored so a change to the normaliser
  // becomes VISIBLE — the value under `key_value` was computed by the OLD
  // normaliser, and re-running today's normaliser on the raw input tells
  // us whether the two still agree. If they don't, the resolver is now
  // reading a stale key: the rule exists but the resolver's lookup misses
  // it. Insurance nobody claims on is not insurance, so flag the row.
  const driftByRuleId = useMemo(() => {
    const m = new Map<string, string>(); // rule.id -> expected key_value
    for (const r of rules) {
      const expected =
        r.key_type === "pincode"
          ? normalisePincodeKey(r.key_input)
          : normaliseLocalityKey(r.key_input);
      if (expected !== r.key_value) m.set(r.id, expected);
    }
    return m;
  }, [rules]);

  const subtitle = useMemo(() => {
    const base = `${rules.length} rule${rules.length === 1 ? "" : "s"} · ${overrides.length} pin${overrides.length === 1 ? "" : "s"}`;
    return driftByRuleId.size > 0
      ? `${base} · ${driftByRuleId.size} drifted`
      : base;
  }, [rules.length, overrides.length, driftByRuleId.size]);

  return (
    <AdminShell title="Zone rules" subtitle={subtitle}>
      {error ? (
        <div style={{ color: "#F59E0B", marginBottom: "1rem" }}>{error}</div>
      ) : null}

      {loading ? (
        <div style={{ opacity: 0.7 }}>Loading…</div>
      ) : (
        <>
          <section style={{ marginBottom: "2rem" }}>
            <h2
              style={{
                fontFamily: "var(--font-body)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontSize: "0.9rem",
                marginBottom: "0.75rem",
              }}
            >
              Learned rules
            </h2>
            {driftByRuleId.size > 0 ? (
              <div
                style={{
                  background: "rgba(245,158,11,0.12)",
                  border: "1px solid rgba(245,158,11,0.55)",
                  color: "#F59E0B",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.35rem",
                  marginBottom: "0.75rem",
                  fontSize: "0.85rem",
                  lineHeight: 1.4,
                }}
              >
                {driftByRuleId.size === 1 ? "1 rule has" : `${driftByRuleId.size} rules have`}{" "}
                drifted: today&rsquo;s normaliser produces a different key
                than the one stored. The resolver is now looking these rules
                up under the new key and missing them. Delete + re-add each
                flagged row to re-sync, or update the code that changed the
                normaliser.
              </div>
            ) : null}
            {rules.length === 0 ? (
              <div style={{ opacity: 0.65 }}>None yet.</div>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.9rem",
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", color: FADED }}>
                    <th style={th}>Key</th>
                    <th style={th}>Zone</th>
                    <th style={th}>By</th>
                    <th style={th}>Learned</th>
                    <th style={th}>Last changed</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => {
                    const driftedTo = driftByRuleId.get(r.id);
                    return (
                    <tr
                      key={r.id}
                      style={{
                        borderTop: `1px solid ${driftedTo ? "rgba(245,158,11,0.55)" : BORDER}`,
                        background: driftedTo ? "rgba(245,158,11,0.06)" : undefined,
                      }}
                    >
                      <td style={td}>
                        <span style={{ opacity: 0.7 }}>
                          {r.key_type === "pincode" ? "pincode" : "locality"}
                        </span>{" "}
                        <b>{r.key_input}</b>
                        {r.key_type === "locality" && r.key_value !== r.key_input.toLowerCase() ? (
                          <span style={{ opacity: 0.5, marginLeft: 6 }}>
                            → {r.key_value}
                          </span>
                        ) : null}
                        {driftedTo ? (
                          <div
                            style={{
                              color: "#F59E0B",
                              fontSize: "0.75rem",
                              marginTop: 4,
                              lineHeight: 1.35,
                            }}
                          >
                            drift: stored key <code>{r.key_value}</code> ≠ today&rsquo;s <code>{driftedTo}</code>
                          </div>
                        ) : null}
                      </td>
                      <td style={td}>{ZONE_LABELS[r.zone]}</td>
                      <td style={td}>{r.created_by}</td>
                      <td style={td}>{formatDate(r.created_at)}</td>
                      <td style={td}>{formatDate(r.updated_at)}</td>
                      <td style={td}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => askDeleteRule(r)}
                          style={linkBtn}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2
              style={{
                fontFamily: "var(--font-body)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontSize: "0.9rem",
                marginBottom: "0.75rem",
              }}
            >
              Row pins
            </h2>
            {overrides.length === 0 ? (
              <div style={{ opacity: 0.65 }}>None.</div>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.9rem",
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", color: FADED }}>
                    <th style={th}>Row</th>
                    <th style={th}>Zone</th>
                    <th style={th}>By</th>
                    <th style={th}>Pinned</th>
                    <th style={th}>Last changed</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((o) => (
                    <tr key={o.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td style={td}>
                        {o.order_id ? (
                          <>
                            order{" "}
                            <a
                              href={`/admin/orders?query=${o.order_id}`}
                              style={{ color: CREAM, textDecoration: "underline" }}
                            >
                              {o.order_id.slice(0, 8)}
                            </a>
                          </>
                        ) : o.subscription_id ? (
                          <>
                            subscription{" "}
                            <a
                              href={`/admin/subscriptions?query=${o.subscription_id}`}
                              style={{ color: CREAM, textDecoration: "underline" }}
                            >
                              {o.subscription_id.slice(0, 8)}
                            </a>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={td}>{ZONE_LABELS[o.zone]}</td>
                      <td style={td}>{o.created_by}</td>
                      <td style={td}>{formatDate(o.created_at)}</td>
                      <td style={td}>{formatDate(o.updated_at)}</td>
                      <td style={td}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => removePin(o.id)}
                          style={linkBtn}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {preview ? (
        <div
          role="dialog"
          aria-label="Confirm delete"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => (busy ? null : setPreview(null))}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 420,
              maxWidth: "90vw",
              background: "#0F1A18",
              color: CREAM,
              border: `1px solid ${BORDER}`,
              borderRadius: "0.5rem",
              padding: "1.25rem",
            }}
          >
            <div style={{ marginBottom: "0.75rem", lineHeight: 1.4 }}>
              Remove the rule for <b>{preview.label}</b>? This moves{" "}
              <b>{preview.p.moved}</b>{" "}
              {preview.p.moved === 1 ? "order" : "orders"} back to the built-in map
              and reverts every future order keyed on {preview.label}.
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={busy}
                style={{ ...linkBtn, flex: 1, padding: "0.55rem", border: `1px solid ${BORDER}`, borderRadius: "0.35rem" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteRule}
                disabled={busy}
                style={{
                  flex: 1,
                  padding: "0.55rem",
                  border: `1px solid ${CREAM}`,
                  borderRadius: "0.35rem",
                  background: CREAM,
                  color: "#0F1A18",
                  fontWeight: 600,
                  cursor: busy ? "wait" : "pointer",
                }}
              >
                Remove rule
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}

const th: React.CSSProperties = {
  padding: "0.5rem 0.6rem",
  fontWeight: 600,
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
};
const td: React.CSSProperties = {
  padding: "0.55rem 0.6rem",
  verticalAlign: "top",
};
const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: CREAM,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "inherit",
  textDecoration: "underline",
  padding: 0,
};
