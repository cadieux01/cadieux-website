"use client";

// Feedback — admin view of customer reviews + replies. Mirrors the
// legacy /admin section's FeedbackSection: list of reviews with
// rating stars, product slug tag, like count, body, threaded replies,
// inline "Reply as Cadieux" composer, and per-row delete actions for
// both reviews and replies. Posts to the existing /api/reviews/*
// endpoints with the x-admin-token header so the admin can hard-delete
// and reply on behalf of Cadieux.

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { ADMIN_PASSWORD } from "@/lib/admin-shared";

type Reply = {
  id: string;
  review_id: string;
  author_name: string;
  is_admin: boolean;
  body: string;
  likes_count: number;
  created_at: string;
};

type Review = {
  id: string;
  product_slug: string | null;
  author_name: string;
  rating: number | null;
  body: string;
  likes_count: number;
  created_at: string;
  replies: Reply[];
};

export default function FeedbackPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      // GET /api/reviews is public — no token needed — but we route through
      // adminFetch so error shapes are consistent with the rest of the admin
      // surface (AdminFetchError carries the real HTTP status + message).
      const json = await adminFetch<{ reviews?: Review[] }>("/api/reviews");
      setReviews(json.reviews ?? []);
    } catch (e) {
      setError(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
          ? e.message
          : "Could not load feedback.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 10s polling cadence matches the rest of the admin surface.
  useEffect(() => {
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  const deleteReview = async (id: string) => {
    if (!confirm("Delete this review and all its replies?")) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await adminFetch(`/api/reviews/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      alert(
        `Failed to delete review: ${
          e instanceof AdminFetchError ? e.message : String(e)
        }`,
      );
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const deleteReply = async (reviewId: string, replyId: string) => {
    if (!confirm("Delete this reply?")) return;
    try {
      await adminFetch(`/api/reviews/${reviewId}/replies/${replyId}`, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      alert(
        `Failed to delete reply: ${
          e instanceof AdminFetchError ? e.message : String(e)
        }`,
      );
    }
  };

  const submitReply = async (reviewId: string) => {
    const body = (replyDraft[reviewId] ?? "").trim();
    if (!body) return;
    setBusy((b) => ({ ...b, [`reply-${reviewId}`]: true }));
    try {
      // is_admin only honored when x-admin-token matches — adminFetch
      // sets that header automatically.
      await adminFetch(`/api/reviews/${reviewId}/replies`, {
        method: "POST",
        body: JSON.stringify({
          author_name: "Cadieux",
          body,
          is_admin: true,
        }),
      });
      setReplyDraft((d) => ({ ...d, [reviewId]: "" }));
      await load();
    } catch (e) {
      alert(
        `Failed to post reply: ${
          e instanceof AdminFetchError ? e.message : String(e)
        }`,
      );
    } finally {
      setBusy((b) => ({ ...b, [`reply-${reviewId}`]: false }));
    }
  };

  // Keep ADMIN_PASSWORD referenced so future direct fetches stay in
  // sync with adminFetch's expectation. (Unused otherwise — adminFetch
  // already pulls it.) — Intentionally not used here.
  void ADMIN_PASSWORD;

  return (
    <AdminShell title="Feedback" subtitle="Reviews · replies">
      {loading ? (
        <p style={mutedText}>Loading feedback…</p>
      ) : error ? (
        <p style={{ ...mutedText, color: "#ef4444" }}>{error}</p>
      ) : reviews.length === 0 ? (
        <p style={mutedText}>No feedback yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {reviews.map((rev) => (
            <div
              key={rev.id}
              style={{
                padding: 18,
                background: "rgba(10,8,5,0.5)",
                border: "1px solid rgba(245,158,11,0.18)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <strong
                    style={{
                      color: "#fbf3d4",
                      fontFamily: "var(--font-heading)",
                      fontSize: "1rem",
                      fontWeight: 500,
                    }}
                  >
                    {rev.author_name}
                  </strong>
                  {rev.product_slug && (
                    <span
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "0.6rem",
                        letterSpacing: "0.25em",
                        textTransform: "uppercase",
                        color: "#c9a96e",
                        border: "1px solid rgba(201,169,110,0.4)",
                        borderRadius: 99,
                        padding: "2px 8px",
                      }}
                    >
                      {rev.product_slug}
                    </span>
                  )}
                  {rev.rating != null && (
                    <span
                      style={{
                        color: "#c9a96e",
                        fontFamily: "var(--font-body)",
                        fontSize: "0.85rem",
                      }}
                    >
                      {"★".repeat(rev.rating)}
                      {"☆".repeat(5 - rev.rating)}
                    </span>
                  )}
                  <span
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: "0.7rem",
                      color: "rgba(192,200,206,0.5)",
                    }}
                  >
                    ♥ {rev.likes_count}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: "0.7rem",
                      color: "rgba(192,200,206,0.5)",
                    }}
                  >
                    {new Date(rev.created_at).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <button
                    onClick={() => deleteReview(rev.id)}
                    disabled={busy[rev.id]}
                    className="uppercase"
                    style={dangerButton}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p
                style={{
                  margin: 0,
                  color: "rgba(251,243,212,0.85)",
                  fontFamily: "var(--font-body)",
                  fontSize: "0.85rem",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {rev.body}
              </p>

              {rev.replies.length > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    paddingLeft: 14,
                    borderLeft: "1px solid rgba(245,158,11,0.2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {rev.replies.map((rp) => (
                    <div
                      key={rp.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 10,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            flexWrap: "wrap",
                            marginBottom: 2,
                          }}
                        >
                          <strong
                            style={{
                              color: "#fbf3d4",
                              fontFamily: "var(--font-heading)",
                              fontSize: "0.85rem",
                            }}
                          >
                            {rp.author_name}
                          </strong>
                          {rp.is_admin && (
                            <span
                              style={{
                                fontFamily: "var(--font-body)",
                                fontSize: "0.55rem",
                                letterSpacing: "0.25em",
                                textTransform: "uppercase",
                                color: "#FBF3D4",
                                background: "rgba(201,169,110,0.22)",
                                border: "1px solid rgba(201,169,110,0.5)",
                                borderRadius: 99,
                                padding: "1px 7px",
                              }}
                            >
                              Cadieux Team
                            </span>
                          )}
                          <span
                            style={{
                              fontFamily: "var(--font-body)",
                              fontSize: "0.65rem",
                              color: "rgba(192,200,206,0.4)",
                            }}
                          >
                            ♥ {rp.likes_count}
                          </span>
                          <span
                            style={{
                              fontFamily: "var(--font-body)",
                              fontSize: "0.65rem",
                              color: "rgba(192,200,206,0.4)",
                            }}
                          >
                            {new Date(rp.created_at).toLocaleString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p
                          style={{
                            margin: 0,
                            color: "rgba(251,243,212,0.78)",
                            fontFamily: "var(--font-body)",
                            fontSize: "0.78rem",
                            lineHeight: 1.55,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {rp.body}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteReply(rev.id, rp.id)}
                        className="uppercase"
                        style={dangerButtonSmall}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <textarea
                  value={replyDraft[rev.id] ?? ""}
                  onChange={(e) =>
                    setReplyDraft((d) => ({ ...d, [rev.id]: e.target.value }))
                  }
                  placeholder="Reply as Cadieux..."
                  rows={2}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    background: "rgba(6,4,2,0.6)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    borderRadius: 4,
                    color: "#fbf3d4",
                    fontFamily: "var(--font-body)",
                    fontSize: "0.8rem",
                    resize: "vertical",
                  }}
                />
                <button
                  onClick={() => submitReply(rev.id)}
                  disabled={busy[`reply-${rev.id}`]}
                  className="uppercase"
                  style={primaryButton}
                >
                  Reply
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

const mutedText: React.CSSProperties = {
  color: "rgba(192,200,206,0.5)",
  fontFamily: "var(--font-body)",
  fontSize: "0.85rem",
};

const dangerButton: React.CSSProperties = {
  border: "1px solid rgba(239,68,68,0.5)",
  color: "#ef4444",
  fontFamily: "var(--font-body)",
  fontSize: "0.6rem",
  letterSpacing: "0.2em",
  padding: "4px 10px",
  background: "transparent",
  cursor: "pointer",
};

const dangerButtonSmall: React.CSSProperties = {
  border: "1px solid rgba(239,68,68,0.4)",
  color: "#ef4444",
  fontFamily: "var(--font-body)",
  fontSize: "0.55rem",
  letterSpacing: "0.2em",
  padding: "2px 8px",
  background: "transparent",
  cursor: "pointer",
  flexShrink: 0,
};

const primaryButton: React.CSSProperties = {
  border: "1px solid rgba(245,158,11,0.5)",
  color: "#f59e0b",
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.25em",
  padding: "8px 14px",
  background: "transparent",
  cursor: "pointer",
};
