"use client";

// Compact row of three icon buttons (Call / WhatsApp / SMS) shown next
// to every phone number in the admin panel. Call opens the dialer
// directly; WhatsApp and SMS first open a small modal so the admin can
// edit the prefilled message before sending.

import { useState } from "react";

import {
  ContactMessageContext,
  defaultContactMessage,
  smsHref,
  telHref,
  whatsAppHrefWithText,
} from "@/lib/phone-utils";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.35)";

type Channel = "whatsapp" | "sms";

export function ContactActions({
  phone,
  customerName,
  orderInfo,
  size = 28,
  stopPropagation = true,
}: {
  phone: string | null | undefined;
  customerName?: string | null;
  orderInfo?: string | null;
  size?: number;
  /**
   * When the buttons sit inside a clickable row (e.g. the customers
   * list links each row to the detail page), we swallow the click so
   * tapping a button doesn't also navigate.
   */
  stopPropagation?: boolean;
}) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [message, setMessage] = useState("");

  if (!phone) return null;

  const ctx: ContactMessageContext = { customerName, orderInfo };

  function openChannel(c: Channel) {
    setMessage(defaultContactMessage(ctx));
    setChannel(c);
  }

  function send() {
    if (!channel) return;
    const url =
      channel === "whatsapp"
        ? whatsAppHrefWithText(phone, message)
        : smsHref(phone, message);
    if (typeof window !== "undefined" && url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    setChannel(null);
  }

  const guard = (e: React.MouseEvent) => {
    if (stopPropagation) {
      e.stopPropagation();
    }
  };

  const buttonStyle: React.CSSProperties = {
    width: size,
    height: size,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${BORDER}`,
    background: "transparent",
    color: GOLD,
    cursor: "pointer",
    padding: 0,
  };

  const iconSize = Math.max(14, Math.round(size * 0.55));

  return (
    <>
      <span
        className="inline-flex items-center gap-1.5"
        onClick={guard}
        onMouseDown={guard}
      >
        <a
          href={telHref(phone)}
          title="Call"
          aria-label={`Call ${phone}`}
          style={buttonStyle}
          onClick={guard}
        >
          <PhoneIcon size={iconSize} />
        </a>
        <button
          type="button"
          title="WhatsApp"
          aria-label={`WhatsApp ${phone}`}
          style={buttonStyle}
          onClick={(e) => {
            guard(e);
            openChannel("whatsapp");
          }}
        >
          <WhatsAppIcon size={iconSize} />
        </button>
        <button
          type="button"
          title="SMS"
          aria-label={`SMS ${phone}`}
          style={buttonStyle}
          onClick={(e) => {
            guard(e);
            openChannel("sms");
          }}
        >
          <SmsIcon size={iconSize} />
        </button>
      </span>

      {channel ? (
        <MessageModal
          channel={channel}
          phone={phone}
          message={message}
          onMessage={setMessage}
          onCancel={() => setChannel(null)}
          onSend={send}
        />
      ) : null}
    </>
  );
}

function MessageModal({
  channel,
  phone,
  message,
  onMessage,
  onCancel,
  onSend,
}: {
  channel: Channel;
  phone: string;
  message: string;
  onMessage: (s: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md p-6"
        style={{
          background: "rgb(6,4,2)",
          border: `1px solid ${BORDER}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h4
          className="uppercase mb-1"
          style={{
            fontFamily: "var(--font-heading)",
            color: CREAM,
            fontSize: "1.1rem",
            letterSpacing: "0.2em",
            fontWeight: 300,
          }}
        >
          {channel === "whatsapp" ? "Send WhatsApp" : "Send SMS"}
        </h4>
        <p
          className="mb-4"
          style={{
            fontFamily: "var(--font-body)",
            color: FADED,
            fontSize: "0.75rem",
            letterSpacing: "0.1em",
          }}
        >
          To {phone}
        </p>

        <textarea
          value={message}
          onChange={(e) => onMessage(e.target.value)}
          rows={8}
          className="w-full px-3 py-2"
          style={{
            border: `1px solid ${BORDER}`,
            background: "transparent",
            color: CREAM,
            fontFamily: "var(--font-body)",
            fontSize: "0.9rem",
            lineHeight: 1.5,
            resize: "vertical",
          }}
        />

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              color: FADED,
              border: `1px solid ${BORDER}`,
              padding: "0.45rem 0.9rem",
              background: "transparent",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSend}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              color: GOLD,
              border: `1px solid ${GOLD}`,
              padding: "0.45rem 0.9rem",
              background: "transparent",
            }}
          >
            {channel === "whatsapp" ? "Open WhatsApp" : "Open SMS"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PhoneIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.94.37 1.85.72 2.71a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.37-1.29a2 2 0 0 1 2.11-.45c.86.35 1.77.59 2.71.72A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function WhatsAppIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 0 1 8.413 3.488 11.82 11.82 0 0 1 3.48 8.414c-.003 6.555-5.338 11.89-11.893 11.89a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.518 5.276l-.999 3.648 3.97-1.218zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  );
}

function SmsIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
