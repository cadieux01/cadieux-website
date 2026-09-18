// Client-side fetchers for the zone-rules endpoints. Every call goes
// through adminFetch so the admin session token rides as a Bearer header
// (Safari ITP defeats the cookie on the apex→www hop; this is the same
// pattern every other admin surface uses).

"use client";

import { adminFetch } from "@/lib/admin-client";
import type { NumberedZone, ZoneKey } from "@/lib/delivery-zones";
import type { ZoneRowOverrideRow, ZoneRuleRow } from "@/lib/zone-rules";

export type ZoneRulesResponse = {
  rules: ZoneRuleRow[];
  overrides: ZoneRowOverrideRow[];
};

export type PreviewResponse = {
  before: Record<ZoneKey, number>;
  after: Record<ZoneKey, number>;
  moved: number;
  matchingRows: number;
  key_value: string;
};

export function fetchAllRules(): Promise<ZoneRulesResponse> {
  return adminFetch<ZoneRulesResponse>("/api/admin/zone-rules");
}

export function upsertRule(input: {
  key_type: "pincode" | "locality";
  key_input: string;
  zone: NumberedZone;
  actor?: string;
}): Promise<{ rule: ZoneRuleRow }> {
  return adminFetch<{ rule: ZoneRuleRow }>("/api/admin/zone-rules", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteRule(id: string): Promise<{ ok: true }> {
  return adminFetch<{ ok: true }>(`/api/admin/zone-rules/${id}`, {
    method: "DELETE",
  });
}

export function previewRule(input: {
  key_type: "pincode" | "locality";
  key_input: string;
  zone: NumberedZone | "clear";
}): Promise<PreviewResponse> {
  const sp = new URLSearchParams({
    key_type: input.key_type,
    key_input: input.key_input,
    zone: input.zone,
  });
  return adminFetch<PreviewResponse>(`/api/admin/zone-rules/preview?${sp}`);
}

export function upsertRowOverride(input: {
  order_id?: string;
  subscription_id?: string;
  zone: NumberedZone;
  actor?: string;
}): Promise<{ override: ZoneRowOverrideRow }> {
  return adminFetch<{ override: ZoneRowOverrideRow }>(
    "/api/admin/zone-row-overrides",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function deleteRowOverride(id: string): Promise<{ ok: true }> {
  return adminFetch<{ ok: true }>(`/api/admin/zone-row-overrides/${id}`, {
    method: "DELETE",
  });
}
