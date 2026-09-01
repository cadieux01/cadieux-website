"use client";

// Feedback — super-admin moderation of customer reviews + replies. Reviews
// and replies live in the shared Supabase tables that BOTH the website and
// the mobile app read, so every change here syncs to both surfaces with no
// rebuild. Admin can edit a review's body / rating / author name, soft-delete
// and restore it, add a "Cadieux" reply, and edit / soft-delete / restore any
// reply. Everything posts to the existing /api/reviews/* endpoints through
// adminFetch (which sends the x-admin-token bearer); all mutations are
// server-side and soft-delete only (never hard-delete).

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";

type Reply = {
  id: string;
  review_id: string;
  author_name: string;
  is_admin: boolean;
  body: string;
  likes_count: number;
  created_at: string;
  edited_at: string | null;
  is_edited: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
};

type Review = {
  id: string;
  product_slug: string | null;
  author_name: string;
  rating: number | null;
  body: string;
  likes_count: number;
  created_at: string;
  edited_at: string | null;
  is_edited: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  replies: Reply[];
};

type ProductFilter = "all" | "high-protein" | "multigrain";

type ReviewDraft = {
  body: string;
  rating: number | null;
  author_name: string;
};

export default function FeedbackPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // Inline review edit state.
  const [editReviewId, setEditReviewId] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>({
    body: "",
    rating: null,
    author_name: "",
  });

  // Inline reply edit state.
  const [editReplyId, setEditReplyId] = useState<string | null>(null);
  const [replyEditDraft, setReplyEditDraft] = useState<string>("");

  const load = useCallback(async () => {
    setError(null);
    try {
      // adminFetch sends the x-admin-token bearer, so the GET returns the
      // moderation view: soft-deleted rows are INCLUDED (so they can be
      // restored) and author names are raw (so edits round-trip).
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEditReview = (rev: Review) => {
    setEditReplyId(null);
    setEditReviewId(rev.id);
    setReviewDraft({
      body: rev.body,
      rating: rev.rating,
      author_name: rev.author_name,
    });
  };

  const cancelEditReview = () => {
    setEditReviewId(null);
  };

  const saveReview = async (id: string) => {
    const body = reviewDraft.body.trim();
    const author_name = reviewDraft.author_name.trim();
    if (!body || body.length > 1000) {
      alert("Review body must be 1–1000 characters.");
      return;
    }
    if (!author_name || author_name.length > 40) {
      alert("Author name must be 1–40 characters.");
      return;
    }
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await adminFetch(`/api/reviews/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          body,
          author_name,
          rating: reviewDraft.rating,
        }),
      });
      setEditReviewId(null);
      await load();
    } catch (e) {
      alert(
        `Failed to save review: ${
          e instanceof AdminFetchError ? e.message : String(e)
        }`,
      );
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const toggleDeleteReview = async (rev: Review) => {
    const deleting = !rev.is_deleted;
    if (deleting && !confirm("Hide this review from the website and app?")) {
      return;
    }
    setBusy((b) => ({ ...b, [rev.id]: true }));
    try {
      await adminFetch(`/api/reviews/${rev.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_deleted: deleting }),
      });
      await load();
    } catch (e) {
      alert(
        `Failed to ${deleting ? "delete" : "restore"} review: ${
          e instanceof AdminFetchError ? e.message : String(e)
        }`,
      );
    } finally {
      setBusy((b) => ({ ...b, [rev.id]: false }));
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

  const startEditReply = (rp: Reply) => {
    setEditReviewId(null);
    setEditReplyId(rp.id);
    setReplyEditDraft(rp.body);
  };

  const cancelEditReply = () => {
    setEditReplyId(null);
  };

  const saveReply = async (reviewId: string, replyId: string) => {
    const body = replyEditDraft.trim();
    if (!body || body.length > 1000) {
      alert("Reply must be 1–1000 characters.");
      return;
    }
    setBusy((b) => ({ ...b, [`reply-edit-${replyId}`]: true }));
    try {
      await adminFetch(`/api/reviews/${reviewId}/replies/${replyId}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
      setEditReplyId(null);
      await load();
    } catch (e) {
      alert(
        `Failed to save reply: ${
          e instanceof AdminFetchError ? e.message : String(e)
        }`,
      );
    } finally {
      setBusy((b) => ({ ...b, [`reply-edit-${replyId}`]: false }));
    }
  };

  const toggleDeleteReply = async (
    reviewId: string,
    rp: Reply,
  ) => {
    const deleting = !rp.is_deleted;
    if (deleting && !confirm("Hide this reply from the website and app?")) {
      return;
    }
    setBusy((b) => ({ ...b, [`reply-del-${rp.id}`]: true }));
    try {
      await adminFetch(`/api/reviews/${reviewId}/replies/${rp.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_deleted: deleting }),
      });
      await load();
    } catch (e) {
      alert(
        `Failed to ${deleting ? "delete" : "restore"} reply: ${
          e instanceof AdminFetchError ? e.message : String(e)
        }`,
      );
    } finally {
      setBusy((b) => ({ ...b, [`reply-del-${rp.id}`]: false }));
    }
  };

  const visibleReviews = reviews.filter(
    (r) => productFilter === "all" || r.product_slug === productFilter,
  );

  return (
    <AdminShell
      title="Feedback"
      subtitle="Reviews · replies · moderation"
      actions={
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.25em",
            color: "#FBF3D4",
            border: "1px solid #FBF3D4",
            padding: "0.45rem 0.9rem",
            background: "transparent",
            cursor: refreshing ? "wait" : "pointer",
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        {(
          [
            ["all", "All products"],
            ["high-protein", "Plain"],
            ["multigrain", "Multi-Grain"],
          ] as [ProductFilter, string][]
        ).map(([key, label]) => {
          const active = productFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setProductFilter(key)}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.22em",
                padding: "6px 12px",
                borderRadius: 99,
                cursor: "pointer",
                color: active ? "#1D1D1F" : "#FBF3D4",
                background: active ? "#FBF3D4" : "transparent",
                border: "1px solid rgba(251,243,212,0.5)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p style={mutedText}>Loading feedback…</p>
      ) : error ? (
        <p style={{ ...mutedText, color: "#EF4444" }}>{error}</p>
      ) : visibleReviews.length === 0 ? (
        <p style={mutedText}>No feedback yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {visibleReviews.map((rev) => {
            const editing = editReviewId === rev.id;
            return (
              <div
                key={rev.id}
                style={{
                  padding: 18,
                  background: rev.is_deleted
                    ? "rgba(239,68,68,0.4)"
                    : "rgba(29,29,31,0.5)",
                  border: rev.is_deleted
                    ? "1px solid rgba(239,68,68,0.45)"
                    : "1px solid rgba(251,243,212,0.18)",
                  borderRadius: 8,
                  opacity: rev.is_deleted ? 0.85 : 1,
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
                        color: "#FBF3D4",
                        fontFamily: "var(--font-heading)",
                        fontSize: "1rem",
                        fontWeight: 500,
                      }}
                    >
                      {rev.author_name}
                    </strong>
                    {rev.product_slug && (
                      <span style={tagPill}>{rev.product_slug}</span>
                    )}
                    {rev.rating != null && (
                      <span
                        style={{
                          color: "#FBF3D4",
                          fontFamily: "var(--font-body)",
                          fontSize: "1rem",
                        }}
                      >
                        {"★".repeat(rev.rating)}
                        {"☆".repeat(5 - rev.rating)}
                      </span>
                    )}
                    <span
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "1rem",
                        color: "rgba(251,243,212,0.5)",
                      }}
                    >
                      ♥ {rev.likes_count}
                    </span>
                    {rev.is_edited && <span style={statusBadge}>edited</span>}
                    {rev.is_deleted && (
                      <span style={deletedBadge}>deleted</span>
                    )}
                  </div>
                  <div
                    style={{ display: "flex", gap: 10, alignItems: "center" }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "1rem",
                        color: "rgba(251,243,212,0.5)",
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
                    {!editing && !rev.is_deleted && (
                      <button
                        onClick={() => startEditReview(rev)}
                        className="uppercase"
                        style={secondaryButtonSmall}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => toggleDeleteReview(rev)}
                      disabled={busy[rev.id]}
                      className="uppercase"
                      style={rev.is_deleted ? restoreButton : dangerButton}
                    >
                      {rev.is_deleted ? "Restore" : "Delete"}
                    </button>
                  </div>
                </div>

                {editing ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      marginTop: 6,
                    }}
                  >
                    <div>
                      <label style={fieldLabel}>Author name</label>
                      <input
                        value={reviewDraft.author_name}
                        onChange={(e) =>
                          setReviewDraft((d) => ({
                            ...d,
                            author_name: e.target.value,
                          }))
                        }
                        maxLength={40}
                        style={textInput}
                      />
                    </div>
                    <div>
                      <label style={fieldLabel}>Rating</label>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() =>
                              setReviewDraft((d) => ({ ...d, rating: n }))
                            }
                            style={{
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              color: "#FBF3D4",
                              fontSize: "1.2rem",
                              lineHeight: 1,
                              padding: 0,
                            }}
                            aria-label={`${n} star`}
                          >
                            {reviewDraft.rating != null &&
                            n <= reviewDraft.rating
                              ? "★"
                              : "☆"}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setReviewDraft((d) => ({ ...d, rating: null }))
                          }
                          className="uppercase"
                          style={{
                            ...secondaryButtonSmall,
                            opacity: reviewDraft.rating == null ? 1 : 0.6,
                          }}
                        >
                          No rating
                        </button>
                      </div>
                    </div>
                    <div>
                      <label style={fieldLabel}>Review body</label>
                      <textarea
                        value={reviewDraft.body}
                        onChange={(e) =>
                          setReviewDraft((d) => ({
                            ...d,
                            body: e.target.value,
                          }))
                        }
                        rows={4}
                        maxLength={1000}
                        style={{ ...textInput, resize: "vertical" }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => saveReview(rev.id)}
                        disabled={busy[rev.id]}
                        className="uppercase"
                        style={primaryButton}
                      >
                        {busy[rev.id] ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={cancelEditReview}
                        className="uppercase"
                        style={secondaryButton}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p
                    style={{
                      margin: 0,
                      color: "rgba(251,243,212,0.85)",
                      fontFamily: "var(--font-body)",
                      fontSize: "1rem",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {rev.body}
                  </p>
                )}

                {rev.replies.length > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      paddingLeft: 14,
                      borderLeft: "1px solid rgba(251,243,212,0.2)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {rev.replies.map((rp) => {
                      const editingReply = editReplyId === rp.id;
                      return (
                        <div
                          key={rp.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 10,
                            opacity: rp.is_deleted ? 0.7 : 1,
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
                                  color: "#FBF3D4",
                                  fontFamily: "var(--font-heading)",
                                  fontSize: "1rem",
                                }}
                              >
                                {rp.author_name}
                              </strong>
                              {rp.is_admin && (
                                <span style={teamPill}>Cadieux Team</span>
                              )}
                              <span
                                style={{
                                  fontFamily: "var(--font-body)",
                                  fontSize: "1rem",
                                  color: "rgba(251,243,212,0.4)",
                                }}
                              >
                                ♥ {rp.likes_count}
                              </span>
                              <span
                                style={{
                                  fontFamily: "var(--font-body)",
                                  fontSize: "1rem",
                                  color: "rgba(251,243,212,0.4)",
                                }}
                              >
                                {new Date(rp.created_at).toLocaleString(
                                  "en-IN",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </span>
                              {rp.is_edited && (
                                <span style={statusBadge}>edited</span>
                              )}
                              {rp.is_deleted && (
                                <span style={deletedBadge}>deleted</span>
                              )}
                            </div>
                            {editingReply ? (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 6,
                                  marginTop: 4,
                                }}
                              >
                                <textarea
                                  value={replyEditDraft}
                                  onChange={(e) =>
                                    setReplyEditDraft(e.target.value)
                                  }
                                  rows={2}
                                  maxLength={1000}
                                  style={{ ...textInput, resize: "vertical" }}
                                />
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button
                                    onClick={() => saveReply(rev.id, rp.id)}
                                    disabled={busy[`reply-edit-${rp.id}`]}
                                    className="uppercase"
                                    style={primaryButton}
                                  >
                                    {busy[`reply-edit-${rp.id}`]
                                      ? "Saving…"
                                      : "Save"}
                                  </button>
                                  <button
                                    onClick={cancelEditReply}
                                    className="uppercase"
                                    style={secondaryButton}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p
                                style={{
                                  margin: 0,
                                  color: "rgba(251,243,212,0.78)",
                                  fontFamily: "var(--font-body)",
                                  fontSize: "1rem",
                                  lineHeight: 1.55,
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                {rp.body}
                              </p>
                            )}
                          </div>
                          {!editingReply && (
                            <div
                              style={{
                                display: "flex",
                                gap: 6,
                                flexShrink: 0,
                              }}
                            >
                              {!rp.is_deleted && (
                                <button
                                  onClick={() => startEditReply(rp)}
                                  className="uppercase"
                                  style={secondaryButtonSmall}
                                >
                                  Edit
                                </button>
                              )}
                              <button
                                onClick={() => toggleDeleteReply(rev.id, rp)}
                                disabled={busy[`reply-del-${rp.id}`]}
                                className="uppercase"
                                style={
                                  rp.is_deleted
                                    ? restoreButtonSmall
                                    : dangerButtonSmall
                                }
                              >
                                {rp.is_deleted ? "Restore" : "Delete"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
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
                      background: "rgba(29,29,31,0.6)",
                      border: "1px solid rgba(251,243,212,0.25)",
                      borderRadius: 4,
                      color: "#FBF3D4",
                      fontFamily: "var(--font-body)",
                      fontSize: "1rem",
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
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}

const mutedText: React.CSSProperties = {
  color: "rgba(251,243,212,0.5)",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "rgba(251,243,212,0.6)",
  marginBottom: 4,
};

const textInput: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "rgba(29,29,31,0.6)",
  border: "1px solid rgba(251,243,212,0.25)",
  borderRadius: 4,
  color: "#FBF3D4",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
};

const tagPill: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.25em",
  textTransform: "uppercase",
  color: "#FBF3D4",
  border: "1px solid rgba(251,243,212,0.4)",
  borderRadius: 99,
  padding: "2px 8px",
};

const teamPill: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.25em",
  textTransform: "uppercase",
  color: "#FBF3D4",
  background: "rgba(251,243,212,0.22)",
  border: "1px solid rgba(251,243,212,0.5)",
  borderRadius: 99,
  padding: "1px 7px",
};

const statusBadge: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "rgba(251,243,212,0.7)",
  border: "1px solid rgba(251,243,212,0.3)",
  borderRadius: 99,
  padding: "1px 7px",
};

const deletedBadge: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "#EF4444",
  border: "1px solid rgba(239,68,68,0.5)",
  borderRadius: 99,
  padding: "1px 7px",
};

const dangerButton: React.CSSProperties = {
  border: "1px solid rgba(239,68,68,0.5)",
  color: "#EF4444",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.2em",
  padding: "4px 10px",
  background: "transparent",
  cursor: "pointer",
};

const dangerButtonSmall: React.CSSProperties = {
  border: "1px solid rgba(239,68,68,0.4)",
  color: "#EF4444",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.2em",
  padding: "2px 8px",
  background: "transparent",
  cursor: "pointer",
  flexShrink: 0,
};

const restoreButton: React.CSSProperties = {
  border: "1px solid rgba(251,243,212,0.5)",
  color: "#FBF3D4",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.2em",
  padding: "4px 10px",
  background: "transparent",
  cursor: "pointer",
};

const restoreButtonSmall: React.CSSProperties = {
  border: "1px solid rgba(251,243,212,0.4)",
  color: "#FBF3D4",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.2em",
  padding: "2px 8px",
  background: "transparent",
  cursor: "pointer",
  flexShrink: 0,
};

const secondaryButton: React.CSSProperties = {
  border: "1px solid rgba(251,243,212,0.3)",
  color: "rgba(251,243,212,0.8)",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.2em",
  padding: "8px 14px",
  background: "transparent",
  cursor: "pointer",
};

const secondaryButtonSmall: React.CSSProperties = {
  border: "1px solid rgba(251,243,212,0.3)",
  color: "rgba(251,243,212,0.8)",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.2em",
  padding: "2px 8px",
  background: "transparent",
  cursor: "pointer",
  flexShrink: 0,
};

const primaryButton: React.CSSProperties = {
  border: "1px solid rgba(251,243,212,0.5)",
  color: "#FBF3D4",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.25em",
  padding: "8px 14px",
  background: "transparent",
  cursor: "pointer",
};
