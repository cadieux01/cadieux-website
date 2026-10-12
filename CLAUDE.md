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

## Comparing a worktree against `main`: two traps that both return a confident wrong answer

There are ~130 sibling worktrees under `/Users/sunnyraj/cadieux-*`, most of them
far behind `origin/main`. Both of these produced a wrong answer that looked right:

**1. `git diff origin/main..HEAD` on a branch that is BEHIND reads upstream's
changes as the branch's own.** The diff is symmetric about the two endpoints; it
does not know which side you think is "yours". The tell is an impossible pair:
`rev-list --count origin/main..HEAD` = 0 (nothing ahead) while
`diff --name-only origin/main..HEAD` lists files. That is the **reverse** diff —
what you are reading is what main did after this branch stopped. Always anchor on
the merge base:

```sh
mb=$(git merge-base origin/main HEAD)
git rev-list --count "$mb"..HEAD     # really ahead by
git diff --name-only "$mb"..HEAD     # really changed by this branch
git rev-list --count "$mb"..origin/main   # how stale this branch is
```

**2. `git merge-tree` against a stale branch reports branch-vs-main, not
branch-vs-you.** It uses the real merge base, so for a branch 362 commits behind
you get a 20-file conflict list that has almost nothing to do with your change.
A merge verdict is only meaningful when the other branch's merge base IS the
current `origin/main` — check that first, and refuse to give a verdict otherwise
rather than reporting the noise.

The failure is not in running the tool, it is in reading it: the output is
indistinguishable from two windows genuinely designing the same file differently.
It got out of this repo once, through two people: a conflict list was reported as
"contested files" and then repeated onward to a third party before anyone checked
the direction. The branch was `+530 / -3,426` against `origin/main`, every file
it was "contesting" already had a newer version on `main`, and merging it would
have **deleted eight files `main` has**. Nobody mis-ran the tool; both readers
took its output at face value without asking what it meant.

So a conflict against a branch you have not placed relative to `main` is a
**staleness artefact until proven otherwise**. Before reporting any collision:

```sh
git diff --stat origin/main <branch>          # heavy on '-' ⇒ BEHIND, not ahead
git diff --diff-filter=D --name-only origin/main <branch>   # files main has, it lacks
```

A `+530 / -3,426` shape means the branch is a stale snapshot. Then check whether
its substance already landed, file by file, rather than trusting the branch name
or the commit subjects:

```sh
git cat-file -e origin/main:<path> && echo "already on main"
```

Two specific traps inside this one:

- **A long `origin/main..<branch>` log does not mean the work is unmerged.**
  Cherry-picked or rebased commits keep their content but change their SHAs, so
  they still list. Compare *trees*, not commit counts.
- **A reverted tip.** If the last commit is a `Revert "…"` of the branch's own
  earlier commit, that pair is net zero — don't count it as pending work.

And if the branch added a migration, the table may already exist on prod
(migrations here are applied by hand, ahead of merges). Confirm with the Supabase
MCP before calling anything orphaned — `to_regclass('public.<table>')` plus a
`git grep` for a writer on `origin/main` settles it in one minute.

The test itself is non-destructive and touches no working tree, so it is safe to
run against someone else's in-progress worktree:

```sh
git fetch /Users/sunnyraj/<other-worktree> HEAD
git merge-tree --write-tree --name-only HEAD FETCH_HEAD
```

## PostgREST unescapes `\` inside a quoted filter value

A regex filter needs a **doubled** backslash on the wire. PostgREST processes
escape sequences inside a quoted filter value before Postgres ever sees it, so

```
target_label.imatch."\yOLF73\y"
```

arrives at Postgres as the pattern `yOLF73y`, which matches **nothing**. There
is no error and no warning: you get **HTTP 200 and a silently shorter result**.
That is the whole danger — the response looks like a correct answer to a
narrower question. It cost a real result set here (a search for `OLS94` quietly
lost its delivery rows, and the only reason it was caught was re-measuring a
count that had been measured before).

The wire value needs `\\y`, which in a TS template literal is four
backslashes:

```ts
const bounded = `"\\\\y${code}\\\\y"`;   // → \\yOLF73\\y on the wire
```

Quoting is still required — without it the escapes are at the mercy of the
`or=(...)` list parser. **Probe the escaping with a bare `fetch` before
trusting any regex filter**, comparing one backslash against two against a
known row count; the two cases differ only in the number of rows returned, so
nothing but a count will tell them apart.

(`imatch` is available inside `or=(...)` on hosted Supabase. `\y` is Postgres'
word boundary, and it is the right tool when a value can be a **prefix of
another valid value** — order/subscription codes are sequential, so an
`ilike '%OLF73%'` also returns OLF730 and OLF731.)

## `maybeSingle()` returns `{data: null, error: null}` on zero rows

Null with no error reads as success, so **check the null explicitly**. This is
not a Supabase bug: supabase-js keeps the array `Accept` header and resolves
the single-row case client-side, so "no such row" and "fine" are the same
value.

It has bitten three admin write routes in the same way. A `PATCH` to an id that
does not exist matched no row, raised no error, and the route fell through to
its success response:

- `PATCH /api/admin/orders/[id]` answered `200 {ok:true}`
- `PATCH /api/admin/subscriptions/[id]` answered
  `200 {ok:true, cascaded_deliveries: null}` — and `409 "already changed
  elsewhere"` when `expected_status` was set, telling the operator to reload a
  subscription that never existed
- `PATCH /api/admin/customers/[id]` answered `200 {ok:true}`

and all three then wrote an audit event built from `params.id`. So a typo'd id
was **indistinguishable from a real change** and left a plausible row on a
table that is append-only at the database level (triggers
`audit_log_no_update` / `audit_log_no_delete` raise P0001), i.e. nothing can
ever delete it.

The shape of the guard — placed immediately after the pre-fetch and **before
validation, the write, any cascade, any push and the audit**, so that none of
them can run for a row that is not there:

```ts
const { data: before, error: beforeErr } = await supabaseAdmin
  .from("orders").select("…").eq("id", params.id).maybeSingle();
if (beforeErr) {
  console.error("[route] pre-fetch failed:", beforeErr.message);
  return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
}
if (!before) {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
```

**A failed READ answers 500, not 404.** The row is not known to be gone, and a
404 invites the operator to conclude that it is.

### Proving a write guard without touching production

The dev server is a **production** database client. To verify a write path,
point it at a local PostgREST stand-in instead — a ~40-line `node:http` server
that returns `[row]` for a control id, `[]` for anything else, a 500 for a
designated failure id, and **appends every request to a log**, so "no UPDATE
ran and no audit row was written" becomes an observation rather than an
argument from reading the source. Run it with
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4555 next dev`.

- It must be `next dev`. **`NEXT_PUBLIC_*` is inlined at build time even in
  server bundles**, so `next start` of an existing build keeps the production
  URL.
- Kill the stub **by port** (`lsof -ti tcp:4555 | xargs kill`), never by job
  number. A `kill %2` once killed the wrong job, the replacement stub died of
  `EADDRINUSE` (visible only in its own stdout), and the old stub kept serving
  — so the "read failure" case silently ran against the wrong server.
- Give the stub realistic column types. `orders.order_number` is TEXT
  (`'OLF902'`); a numeric value makes `formatOrderNumber` fall back to the
  `#slice` and looks like a bug in the route under test.
- Get the BEFORE control for free with `git stash push -- <paths>`: the dev
  server HMRs, you re-run the same cases against the unguarded code, then
  `git stash pop`. Limit the stash to explicit paths — worktrees here are
  shared between windows.

## Dev server: a symlinked `node_modules` gives you two copies of React

Worktrees are often set up by symlinking `node_modules` in from a sibling
worktree. `tsc` and `next build` both **succeed** that way, so it looks fine —
but `next dev` resolves React through the symlink target, i.e. outside the
project root, and the app ends up with two React copies. Every page renders
blank and the server log shows:

```
Warning: Invalid hook call... more than one copy of React in the same app
TypeError: Cannot read properties of null (reading 'useContext')
  at usePathname (.../<other-worktree>/node_modules/next/dist/client/components/navigation.js)
  at ErrorBoundary (...)
```

Two things make this easy to misread:

- The route itself compiles and returns 200 (`GET /checkout 200`). It is the
  root layout that dies, so the failure looks like a bad page edit.
- A green `next build` is **not** evidence the preview will render. The two
  disagree, and only `dev` is affected.

Check `ls -l node_modules` before debugging anything else. Fix:

```
mv node_modules node_modules.symlink.bak && npm ci    # ~8s, 210 packages
```

then restart the dev server. Observed 2026-10-06 in `cadieux-evening-slot`,
whose `node_modules` pointed at `cadieux-zones`.

## A new `payment_status` value is a TWO-REPO change, and only one repo can be patched

The website matches payment status by **prefix** (`isPaidStatus()` in
`src/lib/payment-label.ts` does `startsWith("paid")`). The Android app matches
by **equality** (`=== 'paid'`). They fail in opposite directions, so a value
that is safe in one is dangerous in the other:

- Prefix side — any `paid_*` spelling reads as fully paid, so the rider's
  sheet prints "PAID" and nothing is collected.
- Equality side — any value that is *not literally* `paid` reads as not paid,
  so `components/{Address,Item,Delivery}Editor.tsx` unlock an order that money
  has been taken on, and `app/account/orders/[orderId].tsx:193-196` falls
  through to "Cash on Delivery" (cod rows) or "Awaiting payment" (razorpay
  rows).

The website can be fixed by a deploy. **Installed app builds cannot** — they
need a Play release, and customers update whenever they feel like it.

So: adding the value to `PAYMENT_VIEWS` is safe and is step one. Writing it to
a row is step three. Step two is shipping the app. `partially_paid` is sitting
at step one deliberately (see the comment above the value, and
`sql/orders-partial-payment-balance.sql`, written and held).

The same asymmetry applies to `orders.status`, with one mercy: that column has
**no check constraint and no value is ever deleted**, so retiring a status is
an app-level move plus a data move, and installed builds keep rendering the
value the rows land on. That is why
`sql/orders-retire-preparing-out-for-delivery.sql` targets `confirmed` — a word
every shipped build already draws.

## .env files: never source them, never grep them, never print a value

These are hard rules, not preferences. They exist because an Anthropic API key
has been printed into a session transcript **twice** from this repo's
`.env.local`, and both times the mechanism was ordinary and easy to repeat.

**1. Never source an .env file in a shell.** Not `. ./.env.local`, not
`source .env.local`, not `export $(cat .env.local | xargs)`.

An .env file is not a shell script, but sourcing it runs it as one. Any line
that is not a valid shell assignment is EXECUTED. A value containing spaces, or
a key written as `NAME = value`, turns the value itself into a command — zsh
then reports `command not found: <the entire secret>`, which prints the secret
in full. That is how it leaked:

```
./.env.local:40: command not found: sk-ant-api03-...
```

Note what happened there: the failure *is* the disclosure. Nothing crashed in a
way that could be caught and nothing was redacted, because the shell was simply
reporting a command it could not find. Redacting the command's own output with
`sed` does not help — the leak came from the shell, before any pipe.

**2. To read variable NAMES, read only the names.**

```
cut -d= -f1 .env.local            # names only, values never materialise
cut -d= -f1 .env.local | grep -i stripe
```

Never `cat`, `head`, `tail`, or `grep` a value in order to "check" it. If a
variable needs checking, check its NAME, its presence, or its length — not its
contents.

**3. Never run the Grep tool on a .env file.** Grep returns whole matching
lines by design, so grepping for a variable name returns the name *and the
secret*. There is no flag that makes this safe and no reason to risk it. This
applies to `.env`, `.env.local`, `.env.production`, and anything else holding
credentials.

**4. To pass ONE variable to a command, extract exactly that one.**

```
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
curl -H "apikey: $KEY" ...
```

This is a plain `grep` in a command substitution, so nothing reaches the
transcript; the value exists only in a shell variable. It is also scoped — one
named variable, not the whole file — so an unrelated malformed line cannot be
executed as a side effect of needing a database URL.

**Why the reasoning is written out here.** A bare prohibition reads as
superstition and gets dropped by whoever next finds it inconvenient at 2am. The
cause is specific and mechanical: sourcing executes, grep returns lines, and
secrets leak through ERROR paths rather than success paths — so "it failed, so
nothing happened" is precisely backwards.

**If a key does leak: rotate it.** A transcript, a scrollback buffer and a CI
log are all durable. Deleting the message does not unpublish the secret.
