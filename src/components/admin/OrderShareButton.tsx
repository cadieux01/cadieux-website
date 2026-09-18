"use client";

// Per-order "Share" button used in the /admin/orders action cell.
//
// Thin wrapper over the generic <PartnerShareButton>: it composes the
// order's WhatsApp handoff text and hands it to the shared popover. The
// popover UI (partner list, Copy message, Share other) lives in
// PartnerShareButton so orders and subscriptions behave identically.
//
// Partners are fetched by the parent (/admin/orders/page.tsx) once and
// passed in; this component itself performs no network I/O.

import type { AdminOrderRow } from "@/lib/admin-shared";
import { EMPTY_RULE_SET, type ZoneRuleSet } from "@/lib/delivery-zones";
import { composeShareMessage } from "@/lib/order-share-message";
import {
  PartnerShareButton,
  type ShareablePartner,
} from "@/components/admin/PartnerShareButton";

export type { ShareablePartner };

export function OrderShareButton({
  order,
  partners,
  partnersLoading,
  partnersError,
  buttonStyle,
  rules = EMPTY_RULE_SET,
}: {
  order: AdminOrderRow;
  partners: ShareablePartner[];
  partnersLoading: boolean;
  partnersError: string | null;
  /** Reuse the row's `buttonSm` style so this button matches the others. */
  buttonStyle: React.CSSProperties;
  /**
   * Learned zone rules + row overrides — threaded through so the share
   * message quotes the effective zone, not the built-in one. Defaults to
   * empty so callers that haven't loaded rules yet still work.
   */
  rules?: ZoneRuleSet;
}) {
  return (
    <PartnerShareButton
      message={composeShareMessage(order, rules)}
      partners={partners}
      partnersLoading={partnersLoading}
      partnersError={partnersError}
      buttonStyle={buttonStyle}
    />
  );
}
