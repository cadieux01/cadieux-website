// The eight outbound templates (src/lib/contact-templates.ts).
//
// WHAT THESE TESTS ARE FOR. The templates went to customers for weeks
// with three defects that no type checker can see, and every one of them
// is a STRING:
//
//   1. "Team Cadiuex" in three of the eight;
//   2. a hardcoded "between 4PM - 9PM" in the confirmation, while 188 of
//      the 312 orders since 1 Oct are on 10:00-14:00 and only 79 on
//      16:00-21:00 — wrong for roughly 70% of recipients;
//   3. "pick your at the designated location" — a missing noun.
//
// So the assertions below are mostly spelling and sentence shape, which
// is not a normal thing to unit-test and is exactly the right thing to
// unit-test here. A regression in any of them is invisible in review and
// visible to a customer.

import { test } from "node:test";
import assert from "node:assert/strict";

import "./_alias-hook.mjs";

const { CONTACT_TEMPLATES, renderContactTemplate, slotPhrase } = await import(
  "../src/lib/contact-templates.ts"
);

const SIGN_OFF = "Regards,\nTeam Cadieux (The Protein Brand)";

/** Every template rendered against one context. */
function all(ctx) {
  return CONTACT_TEMPLATES.map((t) => [t.id, t.body(ctx)]);
}

const PROD = {
  customerName: "J Murali Krishna",
  orderCode: "OLF741",
  deliverySlot: "16:00-21:00",
  deliveryDate: "2026-10-16",
};

// ── the brand name ────────────────────────────────────────────────────

test("every template signs off Cadieux, and NONE says Cadiuex", () => {
  for (const [id, body] of all(PROD)) {
    assert.ok(body.endsWith(SIGN_OFF), `${id} sign-off: ${JSON.stringify(body)}`);
    assert.ok(!/cadiuex/i.test(body), `${id} misspelled the brand`);
    assert.ok(!/cadeiux|cadiex|caduiex/i.test(body), `${id} misspelled the brand`);
  }
  // Also with every optional field missing — a fallback branch is still
  // a branch that gets sent.
  for (const [id, body] of all({})) {
    assert.ok(body.endsWith(SIGN_OFF), `${id} sign-off (empty ctx)`);
    assert.ok(!/cadiuex/i.test(body), `${id} misspelled the brand (empty ctx)`);
  }
});

test("control — the misspelling check can fail", () => {
  assert.ok(/cadiuex/i.test("Team Cadiuex (The Protein Brand)"));
});

// ── (SLOT): prose, 12-hour, derived from the canonical slot ───────────

test("slotPhrase renders all three slots as 12-hour prose", () => {
  assert.equal(slotPhrase("06:00-10:00"), "6 AM and 10 AM");
  assert.equal(slotPhrase("10:00-14:00"), "10 AM and 2 PM");
  assert.equal(slotPhrase("16:00-21:00"), "4 PM and 9 PM");
});

test("slotPhrase never emits a 24-hour time or a bare range dash", () => {
  for (const slot of ["06:00-10:00", "10:00-14:00", "16:00-21:00"]) {
    const out = slotPhrase(slot);
    assert.ok(!out.includes(":"), `24h clock survived: ${out}`);
    assert.ok(!out.includes(" - "), `range dash survived: ${out}`);
    assert.ok(out.includes(" and "), `no conjunction: ${out}`);
    // The period name belongs on a page with a label column, not in a
    // sentence that already names the hours.
    assert.ok(!/morning|midday|evening/i.test(out), `period name: ${out}`);
  }
});

test("slotPhrase is empty for no slot and passes junk through unmangled", () => {
  for (const v of [null, undefined, "", "   "]) assert.equal(slotPhrase(v), "");
  // A legacy single "HH:MM" formats as a 30-minute window upstream, and
  // keeps its :00 on the end — "8 AM" is what the three CANONICAL slots
  // render, because their own rangeLabels are written that way, not
  // because anything here trims a zero.
  assert.equal(slotPhrase("07:30"), "7:30 AM and 8:00 AM");
  // Something that is not a time at all comes back as itself.
  assert.equal(slotPhrase("whenever"), "whenever");
});

test("the confirmation names THIS order's window, not a hardcoded one", () => {
  const evening = renderContactTemplate("confirmation", {
    ...PROD,
    deliverySlot: "16:00-21:00",
  });
  const midday = renderContactTemplate("confirmation", {
    ...PROD,
    deliverySlot: "10:00-14:00",
  });
  assert.ok(evening.includes("delivered tomorrow between 4 PM and 9 PM."));
  assert.ok(midday.includes("delivered tomorrow between 10 AM and 2 PM."));
  // The defect, stated as the test that would have caught it: a midday
  // order must never be told about the evening window.
  assert.ok(!midday.includes("9 PM"), midday);
  assert.ok(!/4\s*PM\s*-\s*9\s*PM/i.test(midday), midday);
});

test("no slot → the fallback SENTENCE, not an invented window", () => {
  // 41 of 312 orders since 1 Oct have no slot. Ruled: fallback, not
  // exclusion — they are the customers who most need telling.
  const out = renderContactTemplate("confirmation", {
    ...PROD,
    deliverySlot: null,
  });
  assert.ok(
    out.includes(
      "It will be delivered tomorrow; we will confirm the time window shortly.",
    ),
    out,
  );
  assert.ok(!/\bAM\b|\bPM\b/.test(out), `invented a window: ${out}`);
  assert.ok(!out.includes("(SLOT)"), `unfilled placeholder sent: ${out}`);
});

// ── (DATE): the eighth template ───────────────────────────────────────

test("the eighth template names a DATE, and never says tomorrow", () => {
  const out = renderContactTemplate("rescheduled", PROD);
  assert.ok(
    out.includes(
      "your order has been rescheduled to Fri 16 Oct, between 4 PM and 9 PM.",
    ),
    out,
  );
  assert.ok(out.includes("We will ensure it reaches you then."), out);
  // This is the entire reason it exists: templates 1 and 2 both say
  // "tomorrow", which is wrong when an order moves two days out.
  assert.ok(!/tomorrow/i.test(out), `said tomorrow: ${out}`);
  // And the two it replaces DO say tomorrow, so the gap was real.
  assert.ok(/tomorrow/i.test(renderContactTemplate("call_unanswered", PROD)));
  assert.ok(/tomorrow/i.test(renderContactTemplate("postponed", PROD)));
});

test("rescheduled with no date leaves the hole VISIBLE, not plausible", () => {
  const out = renderContactTemplate("rescheduled", {
    ...PROD,
    deliveryDate: null,
  });
  // An obvious hole the operator must fill beats a sentence that sends
  // cleanly and is wrong.
  assert.ok(out.includes("rescheduled to (DATE)"), out);
  assert.ok(!/tomorrow/i.test(out), out);
});

test("rescheduled with a date but no slot still commits to the date", () => {
  const out = renderContactTemplate("rescheduled", {
    ...PROD,
    deliverySlot: null,
  });
  assert.ok(out.includes("rescheduled to Fri 16 Oct."), out);
  assert.ok(out.includes("we will confirm the time window shortly"), out);
  assert.ok(!/\bAM\b|\bPM\b/.test(out), out);
});

// ── (Name) and (ORDER_NUMBER) ─────────────────────────────────────────

test("every template greets by ONE name, and never by the full stored name", () => {
  for (const [id, body] of all(PROD)) {
    assert.ok(
      body.startsWith("Hi Murali!") || body.startsWith("Hello Murali!"),
      `${id}: ${JSON.stringify(body.slice(0, 40))}`,
    );
    // "Krishna" is the surname; "J" is an initial. Neither is greeted.
    assert.ok(!/\bKrishna\b/.test(body), `${id} leaked the surname`);
    assert.ok(!body.includes("(Name)"), `${id} left the placeholder in`);
  }
});

test("a nameless customer is still greeted, with no dangling space", () => {
  // 74 customers rows have a blank full_name and a phone.
  for (const stored of [null, "", "   ", "KK", "7981040614", "A. S. G."]) {
    for (const [id, body] of all({ ...PROD, customerName: stored })) {
      assert.ok(
        body.startsWith("Hi!") || body.startsWith("Hello!"),
        `${id} / ${JSON.stringify(stored)}: ${JSON.stringify(body.slice(0, 30))}`,
      );
      assert.ok(!body.includes(" !"), `${id} space before bang`);
      assert.ok(!body.includes("  "), `${id} double space`);
    }
  }
});

test("only the location template quotes the order number", () => {
  const quoting = all(PROD).filter(([, body]) => body.includes("OLF741"));
  assert.deepEqual(
    quoting.map(([id]) => id),
    ["location"],
  );
  assert.ok(
    renderContactTemplate("location", PROD).includes(
      "We are reaching out to deliver your order OLF741.",
    ),
  );
});

test("location with no code reads as a sentence, not 'your order ()'", () => {
  const out = renderContactTemplate("location", { ...PROD, orderCode: null });
  assert.ok(out.includes("We are reaching out to deliver your order."), out);
  assert.ok(!out.includes("()"), out);
  assert.ok(!out.includes("(ORDER_NUMBER)"), out);
});

// ── the copy fixes, each asserted as itself ───────────────────────────

test("pickup says 'pick your order up', not 'pick your at'", () => {
  const out = renderContactTemplate("pickup", PROD);
  assert.ok(
    out.includes("pick your order up at the designated location and time."),
    out,
  );
  assert.ok(!/pick your at/i.test(out), out);
  // "Hello", not "Hi" — the team's own wording for this one.
  assert.ok(out.startsWith("Hello Murali!"), out);
});

test("postponed is a sentence — the stored copy read 'and I deliver tomorrow'", () => {
  const out = renderContactTemplate("postponed", PROD);
  assert.ok(
    out.includes("has been postponed and will be delivered tomorrow"),
    out,
  );
  assert.ok(!/and I deliver/i.test(out), out);
});

test("no placeholder of any kind survives into a rendered message", () => {
  const contexts = [
    PROD,
    {},
    { ...PROD, deliverySlot: null },
    { ...PROD, orderCode: null, customerName: null },
  ];
  for (const ctx of contexts) {
    for (const [id, body] of all(ctx)) {
      for (const hole of ["(Name)", "(SLOT)", "(ORDER_NUMBER)"]) {
        assert.ok(!body.includes(hole), `${id} left ${hole} in`);
      }
    }
  }
  // (DATE) is the ONE deliberate exception, and only when no date is
  // stored — see the comment on rescheduleLine.
  assert.ok(
    renderContactTemplate("rescheduled", { ...PROD, deliveryDate: null }).includes(
      "(DATE)",
    ),
  );
});

// ── shape ─────────────────────────────────────────────────────────────

test("eight templates, unique ids, unique labels, all non-empty", () => {
  assert.equal(CONTACT_TEMPLATES.length, 8);
  assert.equal(new Set(CONTACT_TEMPLATES.map((t) => t.id)).size, 8);
  assert.equal(new Set(CONTACT_TEMPLATES.map((t) => t.label)).size, 8);
  for (const t of CONTACT_TEMPLATES) {
    assert.ok(t.label.length > 0 && t.label.length <= 24, t.label);
    assert.ok(t.body(PROD).length > 60, t.id);
  }
  assert.equal(renderContactTemplate("not_a_template", PROD), "");
});

test("no baked line wraps mid-sentence — phones rewrap for themselves", () => {
  for (const [id, body] of all(PROD)) {
    for (const line of body.split("\n")) {
      // A line that both ends without punctuation and is long enough to
      // have been wrapped at a column is the defect this catches.
      if (line.length > 60) {
        assert.ok(
          /[.!]$/.test(line),
          `${id} wrapped mid-sentence: ${JSON.stringify(line)}`,
        );
      }
    }
  }
});

test("four templates invite a reply and four deliberately do not", () => {
  const invite = "If you have any other requests, please respond to this text.";
  const withInvite = all(PROD)
    .filter(([, body]) => body.includes(invite))
    .map(([id]) => id);
  assert.deepEqual(withInvite, [
    "call_unanswered",
    "confirmation",
    "subscription",
    "rescheduled",
  ]);
  // Four, not five — the team's own copy. `location` already asks for a
  // reply in its own words, and `postponed`/`incomplete`/`pickup` do not
  // invite one. Asserted so a well-meaning tidy-up has to come here and
  // argue with the count.
  assert.equal(withInvite.length, 4);
});
