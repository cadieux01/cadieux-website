"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TurnstileWidget, { type TurnstileHandle } from "./TurnstileWidget";
import Select from "./ui/Select";

type Reply = {
  id: string;
  review_id: string;
  author_name: string;
  is_admin: boolean;
  body: string;
  likes_count: number;
  created_at: string;
  edited_at: string | null;
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
  // Server-computed: true when the requesting user (OTP-verified) is the
  // review's author. Drives the Edit / Delete UI. Anonymous viewers and
  // non-author viewers always see false.
  is_owner?: boolean;
  replies: Reply[];
};

// Mirrors REVIEW_EDIT_WINDOW_MS in src/lib/review-display.ts. Re-declared
// here so the client doesn't need to import the server helper.
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function isWithinEditWindow(createdAt: string): boolean {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < EDIT_WINDOW_MS;
}

type Props = {
  productSlug?: string | null;
  scope: "product" | "all";
};

const PRODUCT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "General feedback" },
  { value: "multigrain", label: "Multigrain" },
  { value: "plain", label: "Plain" },
];

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function Stars({ rating, size = 14, onChange }: { rating: number; size?: number; onChange?: (n: number) => void }) {
  const interactive = !!onChange;
  return (
    <div style={{ display: "inline-flex", gap: 2, color: "#024628", fontSize: size, lineHeight: 1 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          onClick={interactive ? () => onChange!(i + 1) : undefined}
          style={{
            opacity: rating >= i + 1 ? 1 : 0.3,
            cursor: interactive ? "pointer" : "default",
          }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? "#024628" : "none"} stroke="#024628" strokeWidth="1.6">
      <path d="M12 21s-7-4.35-7-10a4.5 4.5 0 0 1 8-2.83A4.5 4.5 0 0 1 19 11c0 5.65-7 10-7 10z" />
    </svg>
  );
}

export default function ReviewSection({ productSlug, scope }: Props) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // submission form state
  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [slugChoice, setSlugChoice] = useState<string>(productSlug ?? "");
  const [submitting, setSubmitting] = useState(false);

  // Cloudflare Turnstile bot-check token (single-use, reset after submission).
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const turnstileRef = useRef<TurnstileHandle>(null);

  // per-review reply form open + drafts
  const [openReply, setOpenReply] = useState<Record<string, boolean>>({});
  const [replyName, setReplyName] = useState<Record<string, string>>({});
  const [replyBody, setReplyBody] = useState<Record<string, string>>({});

  // localStorage-tracked likes
  const [likedReviews, setLikedReviews] = useState<Record<string, boolean>>({});
  const [likedReplies, setLikedReplies] = useState<Record<string, boolean>>({});
  // localStorage-tracked ownership (this device posted these)
  const [mineReviews, setMineReviews] = useState<Record<string, boolean>>({});
  const [mineReplies, setMineReplies] = useState<Record<string, boolean>>({});
  // edit state
  const [editingReview, setEditingReview] = useState<string | null>(null);
  const [editReviewBody, setEditReviewBody] = useState("");
  const [editingReply, setEditingReply] = useState<string | null>(null);
  const [editReplyBody, setEditReplyBody] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const r: Record<string, boolean> = {};
      const rp: Record<string, boolean> = {};
      const mr: Record<string, boolean> = {};
      const mrp: Record<string, boolean> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith("liked-review-")) r[k.slice("liked-review-".length)] = true;
        else if (k.startsWith("liked-reply-")) rp[k.slice("liked-reply-".length)] = true;
        else if (k.startsWith("mine-review-")) mr[k.slice("mine-review-".length)] = true;
        else if (k.startsWith("mine-reply-")) mrp[k.slice("mine-reply-".length)] = true;
      }
      setLikedReviews(r);
      setLikedReplies(rp);
      setMineReviews(mr);
      setMineReplies(mrp);
    } catch {}
  }, []);

  const fetchReviews = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = scope === "product" && productSlug
        ? `/api/reviews?product=${encodeURIComponent(productSlug)}`
        : "/api/reviews";
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to load");
      setReviews(j.reviews ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load reviews");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSlug, scope]);

  const avgRating = useMemo(() => {
    const rated = reviews.filter((r) => r.rating != null) as (Review & { rating: number })[];
    if (!rated.length) return 0;
    return rated.reduce((a, r) => a + r.rating, 0) / rated.length;
  }, [reviews]);

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!turnstileToken) {
      setError("Please complete the human-verification check.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: any = {
        author_name: name.trim(),
        body: body.trim(),
        turnstileToken,
      };
      if (scope === "product") {
        payload.product_slug = productSlug;
        payload.rating = rating || null;
      } else {
        payload.product_slug = slugChoice || null;
        if (slugChoice && rating) payload.rating = rating;
      }
      const r = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // Token is single-use — refresh whether or not the call succeeded.
      setTurnstileToken("");
      turnstileRef.current?.reset();
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      // Server marks the freshly-inserted review with is_owner=true when
      // the caller is OTP-verified, so the Edit / Delete controls show
      // up immediately. Also seed the localStorage flag for back-compat
      // with older tabs already on the page.
      setReviews((prev) => [j.review, ...prev]);
      try { localStorage.setItem(`mine-review-${j.review.id}`, "1"); } catch {}
      setMineReviews((p) => ({ ...p, [j.review.id]: true }));
      setName("");
      setBody("");
      setRating(0);
    } catch (e: any) {
      setError(e?.message ?? "Failed to post review");
    } finally {
      setSubmitting(false);
    }
  };

  const submitReply = async (reviewId: string) => {
    const n = (replyName[reviewId] ?? "").trim();
    const b = (replyBody[reviewId] ?? "").trim();
    if (!n || !b) return;
    try {
      const r = await fetch(`/api/reviews/${reviewId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author_name: n, body: b }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setReviews((prev) =>
        prev.map((rev) => (rev.id === reviewId ? { ...rev, replies: [...rev.replies, j.reply] } : rev))
      );
      try { localStorage.setItem(`mine-reply-${j.reply.id}`, "1"); } catch {}
      setMineReplies((p) => ({ ...p, [j.reply.id]: true }));
      setReplyName((p) => ({ ...p, [reviewId]: "" }));
      setReplyBody((p) => ({ ...p, [reviewId]: "" }));
      setOpenReply((p) => ({ ...p, [reviewId]: false }));
    } catch (e: any) {
      alert(e?.message ?? "Failed to post reply");
    }
  };

  const likeReview = async (reviewId: string) => {
    if (likedReviews[reviewId]) return;
    setLikedReviews((p) => ({ ...p, [reviewId]: true }));
    setReviews((prev) => prev.map((r) => (r.id === reviewId ? { ...r, likes_count: r.likes_count + 1 } : r)));
    try { localStorage.setItem(`liked-review-${reviewId}`, "1"); } catch {}
    try { await fetch(`/api/reviews/${reviewId}/like`, { method: "POST" }); } catch {}
  };

  const likeReply = async (reviewId: string, replyId: string) => {
    if (likedReplies[replyId]) return;
    setLikedReplies((p) => ({ ...p, [replyId]: true }));
    setReviews((prev) =>
      prev.map((r) =>
        r.id === reviewId
          ? { ...r, replies: r.replies.map((rp) => (rp.id === replyId ? { ...rp, likes_count: rp.likes_count + 1 } : rp)) }
          : r
      )
    );
    try { localStorage.setItem(`liked-reply-${replyId}`, "1"); } catch {}
    try { await fetch(`/api/reviews/${reviewId}/replies/${replyId}/like`, { method: "POST" }); } catch {}
  };

  const startEditReview = (rev: Review) => {
    setEditingReview(rev.id);
    setEditReviewBody(rev.body);
  };

  const saveEditReview = async (reviewId: string) => {
    const newBody = editReviewBody.trim();
    if (!newBody) return;
    try {
      const r = await fetch(`/api/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newBody }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setReviews((prev) =>
        prev.map((rev) => (rev.id === reviewId ? { ...rev, body: j.review.body, edited_at: j.review.edited_at } : rev))
      );
      setEditingReview(null);
      setEditReviewBody("");
    } catch (e: any) {
      alert(e?.message ?? "Failed to edit");
    }
  };

  // Delete: server soft-deletes (sets is_deleted=true). The row stays in
  // DB for audit but disappears from every public list. Confirmation
  // copy makes the irreversibility clear to the user.
  const deleteReview = async (reviewId: string) => {
    const ok =
      typeof window !== "undefined" &&
      window.confirm("Delete your review? This can't be undone.");
    if (!ok) return;
    try {
      const r = await fetch(`/api/reviews/${reviewId}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Failed");
      setReviews((prev) => prev.filter((rev) => rev.id !== reviewId));
    } catch (e: any) {
      alert(e?.message ?? "Failed to delete");
    }
  };

  const startEditReply = (rp: Reply) => {
    setEditingReply(rp.id);
    setEditReplyBody(rp.body);
  };

  const saveEditReply = async (reviewId: string, replyId: string) => {
    const newBody = editReplyBody.trim();
    if (!newBody) return;
    try {
      const r = await fetch(`/api/reviews/${reviewId}/replies/${replyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newBody }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setReviews((prev) =>
        prev.map((rev) =>
          rev.id === reviewId
            ? {
                ...rev,
                replies: rev.replies.map((rp) =>
                  rp.id === replyId ? { ...rp, body: j.reply.body, edited_at: j.reply.edited_at } : rp
                ),
              }
            : rev
        )
      );
      setEditingReply(null);
      setEditReplyBody("");
    } catch (e: any) {
      alert(e?.message ?? "Failed to edit");
    }
  };

  const ratedCount = reviews.filter((r) => r.rating != null).length;

  return (
    <div>
      {/* Summary bar (only show in product scope when there are rated reviews) */}
      {scope === "product" && ratedCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
          <Stars rating={avgRating} size={18} />
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 22, color: "#024628", fontWeight: 500 }}>
            {avgRating.toFixed(1)}
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(2,70,40,0.65)" }}>
            {reviews.length} review{reviews.length === 1 ? "" : "s"}
          </div>
        </div>
      )}

      {/* Submission form */}
      <form onSubmit={submitReview} style={formStyle}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.4em", textTransform: "uppercase", color: "#024628", marginBottom: 14 }}>
          {scope === "product" ? "Leave a review" : "Share your feedback"}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Your name"
            required
            style={inputStyle}
          />
          {scope === "all" && (
            <Select
              value={slugChoice}
              onChange={setSlugChoice}
              ariaLabel="Which product is this feedback about?"
              options={PRODUCT_OPTIONS}
            />
          )}
          {(scope === "product" || slugChoice) && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(2,70,40,0.7)" }}>
                Rating
              </span>
              <Stars rating={rating} size={20} onChange={setRating} />
            </div>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1000}
            placeholder="Write your thoughts..."
            required
            rows={4}
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
          />
          {error && (
            <div style={{ color: "#991B1B", fontSize: 16, fontFamily: "var(--font-body)" }}>{error}</div>
          )}
          <TurnstileWidget
            ref={turnstileRef}
            onVerify={(t) => setTurnstileToken(t)}
            onExpire={() => setTurnstileToken("")}
          />
          {/* Disclosure (not consent) — reviews are public. Only the first
              word of the submitted name is shown publicly; the review
              text is shown verbatim. */}
          <div style={disclosureStyle}>
            By submitting, your review will be public. Your first name and
            review text will be visible to other shoppers.
          </div>
          <button type="submit" disabled={submitting} style={btnPrimary}>
            {submitting ? "Posting..." : "Post"}
          </button>
        </div>
      </form>

      {/* Reviews list */}
      {loading ? (
        <div style={emptyStyle}>Loading...</div>
      ) : reviews.length === 0 ? (
        <div style={emptyStyle}>
          {scope === "product" ? "Be the first to review this bread." : "No feedback yet — share yours above."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {reviews.map((rev) => (
            <div key={rev.id} style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 500, color: "#024628" }}>{rev.author_name}</div>
                  {rev.rating != null && <Stars rating={rev.rating} />}
                  {scope === "all" && rev.product_slug && (
                    <span style={pillStyle}>{rev.product_slug}</span>
                  )}
                </div>
                <div style={dateStyle}>
                  {formatDate(rev.created_at)}
                  {rev.edited_at && <span style={editedTagStyle}> (edited)</span>}
                </div>
              </div>
              {editingReview === rev.id ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <textarea
                    value={editReviewBody}
                    onChange={(e) => setEditReviewBody(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => saveEditReview(rev.id)} style={btnPrimary}>Save</button>
                    <button onClick={() => { setEditingReview(null); setEditReviewBody(""); }} style={textBtn}>Cancel</button>
                  </div>
                </div>
              ) : (
                <p style={bodyStyle}>{rev.body}</p>
              )}

              {editingReview !== rev.id && (
                <div style={{ display: "flex", gap: 14, marginTop: 14, alignItems: "center" }}>
                  <button onClick={() => likeReview(rev.id)} disabled={!!likedReviews[rev.id]} style={iconBtn} aria-label="Like">
                    <Heart filled={!!likedReviews[rev.id]} />
                    <span>{rev.likes_count}</span>
                  </button>
                  <button onClick={() => setOpenReply((p) => ({ ...p, [rev.id]: !p[rev.id] }))} style={textBtn}>
                    Reply
                  </button>
                  {/* Ownership: prefer the server-supplied is_owner flag (the
                      authoritative phone-based check). Fall back to the
                      legacy localStorage flag so reviews written before the
                      phone capture still show Edit/Delete on the device that
                      posted them. The server still enforces ownership and
                      the 24h window — the client UI is just optimistic. */}
                  {(rev.is_owner || mineReviews[rev.id]) && isWithinEditWindow(rev.created_at) && (
                    <button onClick={() => startEditReview(rev)} style={textBtn}>Edit</button>
                  )}
                  {(rev.is_owner || mineReviews[rev.id]) && (
                    <button onClick={() => deleteReview(rev.id)} style={textBtn}>Delete</button>
                  )}
                </div>
              )}

              {openReply[rev.id] && (
                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  <input
                    placeholder="Your name"
                    value={replyName[rev.id] ?? ""}
                    onChange={(e) => setReplyName((p) => ({ ...p, [rev.id]: e.target.value }))}
                    maxLength={40}
                    style={inputStyle}
                  />
                  <textarea
                    placeholder="Write a reply..."
                    value={replyBody[rev.id] ?? ""}
                    onChange={(e) => setReplyBody((p) => ({ ...p, [rev.id]: e.target.value }))}
                    maxLength={1000}
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                  <button onClick={() => submitReply(rev.id)} style={btnPrimary}>Post reply</button>
                </div>
              )}

              {rev.replies.length > 0 && (
                <div style={{ marginTop: 14, paddingLeft: 16, borderLeft: "1px solid rgba(2,70,40,0.25)", display: "flex", flexDirection: "column", gap: 12 }}>
                  {rev.replies.map((rp) => (
                    <div key={rp.id}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 500, color: "#024628" }}>{rp.author_name}</span>
                        {rp.is_admin && <span style={adminPill}>Cadieux Team</span>}
                        <span style={{ ...dateStyle, fontSize: 16 }}>
                          {formatDate(rp.created_at)}
                          {rp.edited_at && <span style={editedTagStyle}> (edited)</span>}
                        </span>
                      </div>
                      {editingReply === rp.id ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <textarea
                            value={editReplyBody}
                            onChange={(e) => setEditReplyBody(e.target.value)}
                            maxLength={1000}
                            rows={2}
                            style={{ ...inputStyle, resize: "vertical" }}
                          />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => saveEditReply(rev.id, rp.id)} style={btnPrimary}>Save</button>
                            <button onClick={() => { setEditingReply(null); setEditReplyBody(""); }} style={textBtn}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <p style={{ ...bodyStyle, fontSize: 16 }}>{rp.body}</p>
                      )}
                      {editingReply !== rp.id && (
                        <div style={{ display: "flex", gap: 12, marginTop: 6, alignItems: "center" }}>
                          <button onClick={() => likeReply(rev.id, rp.id)} disabled={!!likedReplies[rp.id]} style={iconBtn} aria-label="Like reply">
                            <Heart filled={!!likedReplies[rp.id]} />
                            <span>{rp.likes_count}</span>
                          </button>
                          {mineReplies[rp.id] && (
                            <button onClick={() => startEditReply(rp)} style={textBtn}>Edit</button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const formStyle: React.CSSProperties = {
  padding: "20px 22px",
  background: "#FBF3D4",
  border: "1px solid #024628",
  borderRadius: 10,
  marginBottom: 24,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "#FBF3D4",
  border: "1px solid #024628",
  borderRadius: 6,
  color: "#024628",
  caretColor: "#024628",
  fontFamily: "var(--font-body)",
  fontSize: 16,
  fontWeight: 300,
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  alignSelf: "start",
  padding: "10px 22px",
  background: "#024628",
  border: "none",
  borderRadius: 6,
  color: "#FBF3D4",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: "0.3em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const cardStyle: React.CSSProperties = {
  padding: "22px 22px",
  background: "#FBF3D4",
  border: "1px solid #024628",
  borderRadius: 10,
};

const editedTagStyle: React.CSSProperties = {
  marginLeft: 4,
  textTransform: "none",
  letterSpacing: "0.05em",
  color: "rgba(2,70,40,0.6)",
  fontStyle: "italic",
};

const dateStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "rgba(2,70,40,0.6)",
};

const bodyStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-body)",
  fontSize: 16,
  lineHeight: 1.7,
  fontWeight: 300,
  color: "#024628",
};

const pillStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: "0.25em",
  textTransform: "uppercase",
  color: "#024628",
  border: "1px solid #024628",
  borderRadius: 99,
  padding: "2px 8px",
};

const adminPill: React.CSSProperties = {
  ...pillStyle,
  color: "#FBF3D4",
  background: "#024628",
  border: "none",
};

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "transparent",
  border: "none",
  padding: 0,
  color: "rgba(2,70,40,0.75)",
  fontFamily: "var(--font-body)",
  fontSize: 16,
  fontWeight: 300,
  cursor: "pointer",
};

const textBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  color: "rgba(2,70,40,0.75)",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const disclosureStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 16,
  fontWeight: 300,
  lineHeight: 1.55,
  color: "rgba(2,70,40,0.7)",
  padding: "8px 0 2px",
};

const emptyStyle: React.CSSProperties = {
  padding: "32px 0",
  textAlign: "center",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  color: "rgba(2,70,40,0.6)",
};
