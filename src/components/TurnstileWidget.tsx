"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// Minimal type for the Turnstile global injected by the loader script.
type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
    }
  ) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileHandle = { reset: () => void };

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  theme?: "auto" | "light" | "dark";
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ onVerify, onExpire, theme = "auto" }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    // Stash the latest callbacks in refs so the render effect can be a
    // mount-only effect — re-rendering the widget on every callback identity
    // change would clear the user's solved state.
    const onVerifyRef = useRef(onVerify);
    const onExpireRef = useRef(onExpire);
    onVerifyRef.current = onVerify;
    onExpireRef.current = onExpire;

    useImperativeHandle(ref, () => ({
      reset: () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    }));

    useEffect(() => {
      // Inject the loader script once per page.
      if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
        const s = document.createElement("script");
        s.src = SCRIPT_SRC;
        s.async = true;
        s.defer = true;
        document.body.appendChild(s);
      }

      let cancelled = false;
      const interval = window.setInterval(() => {
        if (cancelled) return;
        if (window.turnstile && containerRef.current && !widgetIdRef.current) {
          const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
          if (!sitekey) {
            console.error("❌ NEXT_PUBLIC_TURNSTILE_SITE_KEY not configured");
            window.clearInterval(interval);
            return;
          }
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey,
            callback: (token: string) => onVerifyRef.current(token),
            "expired-callback": () => onExpireRef.current?.(),
            theme,
          });
          window.clearInterval(interval);
        }
      }, 100);

      return () => {
        cancelled = true;
        window.clearInterval(interval);
        if (widgetIdRef.current && window.turnstile) {
          try { window.turnstile.remove(widgetIdRef.current); } catch { /* ignore */ }
          widgetIdRef.current = null;
        }
      };
    }, [theme]);

    return <div ref={containerRef} />;
  }
);

export default TurnstileWidget;
