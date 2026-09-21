"use client";

// Registers the hand-rolled service worker at /sw.js.
//
// Behavior:
//   • Production only — dev builds skip registration so HMR isn't shadowed
//     by a stale cache. We also explicitly UNregister any leftover SW in dev,
//     which protects developers who installed a build then switched to dev.
//   • Update flow: when a new SW takes control (`controllerchange`), we ask
//     it to skipWaiting and reload the page once. The user sees a single
//     refresh after a deploy — never an infinite reload loop (the
//     `reloaded` flag), and never a refresh on a FIRST install (the
//     `adoptedInitialWorker` latch — see below).
//   • Errors are swallowed: SW registration failures should never crash the
//     UI. They get a console warning so they're visible in DevTools.

import { useEffect } from "react";

export default function PWAServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // The admin surface must NEVER be service-worker-controlled. A stale SW
    // serving cached /_next/static chunks (CacheFirst) can break hydration of
    // the login gate, leaving the form to do a native submit (page reload)
    // instead of logging in — and hard-reload doesn't clear Cache Storage or
    // unregister the SW, so it wedges indefinitely. On /admin we actively
    // unregister any SW and skip registration so the page always runs fresh,
    // exactly like Incognito.
    if (window.location.pathname.startsWith("/admin")) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => {
          regs.forEach((r) => void r.unregister());
        })
        .catch(() => {});
      return;
    }

    // In dev, actively remove any SW that was installed during prod testing.
    // Otherwise dev requests get served from the prod cache and edits look
    // like they don't apply.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => {
          if (r.active && r.active.scriptURL.endsWith("/sw.js")) {
            void r.unregister();
          }
        });
      }).catch(() => {});
      return;
    }

    let reloaded = false;

    // `controllerchange` fires on a FIRST INSTALL as well as on an update:
    // sw.js calls skipWaiting() during install and clients.claim() on activate,
    // so a brand-new worker claims a page that is already showing content it
    // fetched from the network seconds ago. Reloading then re-downloads the
    // whole document — measured on live at 7,286,746 B for a first visit
    // against 3,641,437 B for a second, the hero video alone counted twice.
    //
    // Only an UPDATE warrants the refresh, and an update is exactly the case
    // where some worker was already in control. Read that once here rather
    // than inside the handler: by the time controllerchange fires,
    // navigator.serviceWorker.controller is ALREADY the new worker, so
    // checking it there would be true in both cases and guard nothing.
    //
    // This is a latch, not a constant. A plain `hadController` const would
    // suppress the reload for the whole life of the page, so a tab that
    // first-installed the worker and then sat open across a deploy would never
    // pick that deploy up (verified: it does not reload). Consuming only the
    // FIRST controllerchange keeps the first install silent while leaving every
    // later update — in that same tab — reloading as before.
    let adoptedInitialWorker = !!navigator.serviceWorker.controller;

    const onControllerChange = () => {
      if (!adoptedInitialWorker) {
        adoptedInitialWorker = true;
        return;
      }
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // If a waiting worker is already present at registration time,
        // tell it to take over immediately. This handles the case where
        // the user kept the tab open across two deploys.
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              // New version ready and an old one is in control — activate
              // the new one. `controllerchange` then fires the reload.
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[pwa] sw registration failed:", err);
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
