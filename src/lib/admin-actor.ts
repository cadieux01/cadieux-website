// Who reacted. A stable, always-present label for order_reactions.author.
//
// This exists because order_reactions.author is NOT NULL and the unique
// indexes behind "one reaction per admin per row" are NULLS DISTINCT: a null
// author would not collide with anything, so one operator could stack an
// unlimited number of reactions on a single row and none of them could be
// toggled off. The invariant only holds while every writer supplies a value.
//
// getAdminFirstName() cannot supply one on its own — it returns null when
// the operator has never been asked or hit Cancel on the prompt, which is a
// perfectly valid state for a note (author is nullable there) and a broken
// one for a reaction. So this module layers a per-device fallback under it.
//
// Like admin-first-name.ts, this is a LABEL and not identity. Authentication
// is the same admin session token every other /api/admin/* call carries; a
// forged author buys nothing except the ability to toggle a reaction the
// forger could already toggle by opening the board.

import { getAdminFirstName } from "@/lib/admin-first-name";

const DEVICE_KEY = "cadieux_admin_actor";

/**
 * Stable per-browser id, minted once and kept.
 *
 * Used only when no first name has been set. Two operators sharing one
 * browser profile share one slot and will overwrite each other's reaction —
 * accepted deliberately, because the alternative (a fresh id per call) is
 * the unbounded-stacking bug this module exists to prevent. Setting a first
 * name in the note panel separates them.
 */
function deviceActor(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing && existing.trim().length > 0) return existing.trim();
    const minted = `device-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_KEY, minted);
    return minted;
  } catch {
    // Private mode / quota. A per-session constant is still stable for as
    // long as this page lives, so toggling works within the session and
    // only forgets across reloads.
    return SESSION_FALLBACK;
  }
}

// Module-scope, so every call in this page lifetime agrees even when
// localStorage is unavailable.
const SESSION_FALLBACK = `device-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The author label to file a reaction under. Never null, never empty.
 *
 * Prefers the operator's first name when they have set one, so reactions and
 * notes attribute to the same person. Never prompts: a long-press on a row
 * is not the moment to interrupt with a dialog, and the prompt already lives
 * in the note panel where it reads as part of the task.
 */
export function adminActor(): string {
  const name = getAdminFirstName();
  if (name) return name.slice(0, 60);
  if (typeof window === "undefined") return "unknown";
  return deviceActor().slice(0, 60);
}
