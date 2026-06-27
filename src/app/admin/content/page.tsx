"use client";

// Global content editor. Sits at /admin/content and edits the content
// tables that are NOT product-scoped:
//   - behind_milestones (timeline)
//   - behind_stats
//   - behind.* strings
//   - process_steps (making / story)
//   - global content_strings (pdp.*, shop.*, compliance.*, share.*, …)
// Per-product strings/tiles/reports live on /admin/products/[id].
//
// Locale switcher lets the operator edit each locale in turn (admin
// surface is locale-aware; getPageContent does a silent en fallback for
// missing locales on the public side).

import { useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  BEHIND_MILESTONES_SPEC,
  BEHIND_STATS_SPEC,
  ContentTableEditor,
  PROCESS_STEPS_SPEC,
} from "@/components/admin/ContentTableEditor";
import { ContentStringsSection } from "@/components/admin/ContentStringsSection";
import { usePinGate } from "@/components/admin/PinGateModal";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

type Tab = "milestones" | "stats" | "behind_strings" | "process" | "global_strings";

const TABS: { key: Tab; label: string }[] = [
  { key: "milestones", label: "Behind: Milestones" },
  { key: "stats", label: "Behind: Stats" },
  { key: "behind_strings", label: "Behind: Strings" },
  { key: "process", label: "Process Steps" },
  { key: "global_strings", label: "Global Strings" },
];

const LOCALES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "te", label: "Telugu" },
  { code: "hi", label: "Hindi" },
];

export default function AdminContentPage() {
  const [tab, setTab] = useState<Tab>("milestones");
  const [locale, setLocale] = useState<string>("en");
  const { requirePin, modal: pinModal } = usePinGate();

  return (
    <AdminShell
      title="Content"
      subtitle="Site-wide copy, timeline, and process steps."
      actions={
        <div className="flex items-center gap-2">
          <span
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              color: FADED,
            }}
          >
            Locale
          </span>
          {LOCALES.map((l) => {
            const active = l.code === locale;
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => setLocale(l.code)}
                className="uppercase"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "0.7rem",
                  letterSpacing: "0.25em",
                  color: active ? CREAM : FADED,
                  border: `1px solid ${active ? GOLD : BORDER}`,
                  padding: "0.35rem 0.7rem",
                  background: "transparent",
                }}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      }
    >
      <div
        className="flex gap-1 mb-8 flex-wrap"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.72rem",
                letterSpacing: "0.25em",
                color: active ? CREAM : FADED,
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${active ? GOLD : "transparent"}`,
                padding: "0.6rem 1rem",
                marginBottom: "-1px",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "milestones" ? (
        <ContentTableEditor
          spec={BEHIND_MILESTONES_SPEC}
          locale={locale}
          requirePin={requirePin}
          title="Behind Cadieux — milestones"
          subtitle="Rows on the behind-cadieux timeline. Marker = e.g. month/year; label = the headline for that point."
        />
      ) : null}

      {tab === "stats" ? (
        <ContentTableEditor
          spec={BEHIND_STATS_SPEC}
          locale={locale}
          requirePin={requirePin}
          title="Behind Cadieux — stats"
          subtitle="The big-number tiles on the behind-cadieux page."
        />
      ) : null}

      {tab === "behind_strings" ? (
        <ContentStringsSection
          locale={locale}
          productId="__global__"
          requirePin={requirePin}
          keyPrefixFilter="behind."
          title="Behind Cadieux — strings"
          subtitle='Atomic strings used by the behind-cadieux page (keys begin with "behind.").'
        />
      ) : null}

      {tab === "process" ? (
        <ContentTableEditor
          spec={PROCESS_STEPS_SPEC}
          locale={locale}
          requirePin={requirePin}
          title="Process steps"
          subtitle="Numbered steps used on the Making / Story pages."
        />
      ) : null}

      {tab === "global_strings" ? (
        <ContentStringsSection
          locale={locale}
          productId="__global__"
          requirePin={requirePin}
          title="Global strings"
          subtitle="All content_strings rows with no product scope. Use a key prefix in the filter (e.g. compliance., shop., making.) to narrow down."
        />
      ) : null}

      {pinModal}
    </AdminShell>
  );
}
