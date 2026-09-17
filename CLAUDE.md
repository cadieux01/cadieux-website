# Working on this repo

Traps that have each cost more than one session to rediscover. Add to this file
when something burns you for a second time — the cost of a paragraph here is
minutes, and the cost of leaving it out is measured in hours per window.

## `waitForAdminToken` — why every `/admin/*` request appears to hang

If you are previewing an admin page and the board sits on "REFRESHING…", the
Refresh button does nothing, or requests never appear in the network panel:
**it is almost never the network, the server, or auth being rejected.** It is
`waitForAdminToken()` in `src/lib/admin-client.ts`.

`adminFetch` awaits that function before every single request. When
`localStorage.admin_token` is absent or expired it does not fail fast — it
parks the request for up to **10 seconds**, waiting for `PasswordGate` to store
a token. That behaviour is correct in production (admin pages fire `load()` on
mount, before the operator has typed the password, because the page component
wraps `<AdminShell>` rather than living inside it) but it is vicious under
automated preview:

- **A backgrounded preview tab throttles the timer, so the 10s ceiling never
  arrives.** The request does not time out and 401 — it waits forever, and you
  get a spinner with no error, no log line, and nothing in the network panel to
  explain it. Keep the tab foregrounded, or expect an indefinite hang.
- Every request queues behind the same wait, so the whole page looks dead
  rather than one widget looking slow.

**The fix is to mint a client-valid token before doing anything else.**
`adminTokenValid()` only base64-decodes the payload and reads `exp` — the HMAC
is verified server-side only — so a token the *client* accepts needs no secret
and grants no server access:

```js
localStorage.setItem('admin_token',
  btoa(JSON.stringify({ p: 'local', exp: Date.now() + 86400000 }))
    .replace(/\+/g, '-').replace(/\//g, '_') + '.localsig');
```

This mints nothing and bypasses no server check. The API authenticates on the
`admin_session` **cookie** (or a real `Authorization: Bearer`), which you
already have if you can reach the pages at all; this only stops the client from
parking its own requests. Requests become instant.

Two neighbours of the same trap, since you will hit them in the same hour:

- `AdminShell` renders `PasswordGate` off a **separate** localStorage hint,
  `cadieux_admin_auth`. A valid `admin_token` does not dismiss the gate. Set
  `localStorage.setItem('cadieux_admin_auth', JSON.stringify({ expiresAt: Date.now() + 86400000 }))`.
- Both keys live in localStorage, so a **full page reload keeps them** but also
  discards any `fetch` patch or fixture you installed. Re-install those after
  reloading, not before.

## Dev server: the CSP must allow `'unsafe-eval'`

`next dev` can compile cleanly and then never hydrate — which reads exactly like
an auth gate or a dead server. Dev bundles are `eval-source-map`, so a CSP
without `'unsafe-eval'` kills them silently. Fixed upstream, but if a worktree
predates that fix this is the first thing to check. It is **not** a bundle-size
problem; `next build && next start` is a workaround, not an explanation.
