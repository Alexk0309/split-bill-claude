# Split bill

Split a Malaysian restaurant bill and collect repayment, where **only the payer
needs an account**. Everyone else opens a link, taps what they ate, and gets a
number and a way to pay.

The app never holds money. It is a calculator and a messenger; funds move
bank-to-bank directly between people via DuitNow.

## Status

| Phase | | |
| --- | --- | --- |
| 0 | Calculation engine | done |
| 1 | Bill creation and the guest claim page | done |
| 2 | Live claiming | done |
| 3 | Receipt OCR | done |
| 4 | Settlement | done |
| 5 | Reminders | done |

## Setup

See **[SETUP.md](SETUP.md)** for the full walkthrough: Anthropic key, Supabase
project, migrations, auth URLs. The short version:

```bash
cp .env.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`ANTHROPIC_API_KEY`, then apply the schema:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF && npx supabase db push
```

Verify everything against the live services:

```bash
npm run check
```

```bash
npm run dev
```

Without an Anthropic key everything still works; receipt scanning reports that
it is not configured and points the payer at manual entry.

## Running the tests

```bash
npm test
```

```bash
npm run typecheck
```

The row level security tests need Docker and the Supabase CLI:

```bash
npm run db:test
```

There is also a live check of the receipt scanning path. It calls the real API,
so it is opt-in and costs a fraction of a cent:

```bash
RUN_OCR_INTEGRATION=1 npx vitest run lib/ocr/__tests__/scan.integration.test.ts
```

And a live check of row level security, which drives the policies through the
same client library the app uses. It needs the keys in `.env.local` but no
Docker, and it deletes the bills it creates:

```bash
RUN_DB_INTEGRATION=1 npx vitest run lib/supabase/__tests__/rls.integration.test.ts
```

## Routes

| | |
| --- | --- |
| `/` | Landing, redirects a signed-in payer to their bills |
| `/login` | Magic link sign-in. Payer only |
| `/bills` | The payer's bills |
| `/bills/[id]` | Build the bill, set rates, get the share link |
| `/bills/[id]/review/[receiptId]` | Check what the scan read before it becomes a bill |
| `/b/[token]` | The guest claim page and settlement. No account, no session |
| `/profile` | The payer's DuitNow number and QR |

## The engine

`lib/split/` is pure and dependency-free: no database, no React, no I/O, no
clock, no randomness. It is kept that way so the same code can serve a POS
integration or a pay-before-you-eat flow, neither of which has a payer who
fronted the money.

```ts
import { computeSplit } from '@/lib/split';

const result = computeSplit({
  people: [{ id: 'aina', name: 'Aina' }, { id: 'ben', name: 'Ben' }],
  items: [
    { id: 'i1', name: 'Nasi lemak ayam', priceSen: 1800, claimantIds: ['aina'] },
    { id: 'i2', name: 'Sotong goreng', priceSen: 3200, claimantIds: ['aina', 'ben'] },
  ],
  serviceChargeRate: 0.1,
  serviceTaxRate: 0.06,
  adjustments: [],
  belanja: [],
  roundingMode: 'sen',
});
```

### Order of operations

Malaysian bills compute in a specific sequence, and the order matters:

1. `subtotal = sum(item prices)`
2. `serviceCharge = roundHalfUp(subtotal x serviceChargeRate)`
3. `serviceTax = roundHalfUp((subtotal + serviceCharge) x serviceTaxRate)` --
   the tax is levied on subtotal **plus** service charge
4. `billTotal = subtotal + serviceCharge + serviceTax - adjustments`

Then per person: exact base share from claimed items, a ratio of the subtotal,
charges and proportional adjustments allocated by that ratio, largest remainder
rounding, and belanja applied last.

### Rules it enforces

- **Integer sen everywhere.** Currency never touches a float. Intermediate
  shares are exact rationals over `bigint` (`lib/split/rational.ts`) and collapse
  to integers exactly once, in the largest remainder pass.
- **No sen leaks.** `assertNoSenLeaked` runs on every call, in production as well
  as in tests. Shares plus unallocated always equal the settlement total.
- **Unclaimed items are never silently split.** They come back in
  `unclaimedItems`, and their value is held in `unallocatedSen` rather than being
  charged to whoever did claim something. Settlement is blocked until the list is
  empty.
- **Every sen is explainable.** Each person's six breakdown components sum
  exactly to their final share, and `itemLines` / `adjustmentLines` show where
  each part came from.
- **Rates are inputs, not constants.** Defaults live in `lib/split/config.ts`
  with a pointer to the source to verify them against; the payer can override
  them per bill.

### Design decisions worth knowing

- **Person-scoped adjustments split equally** between the people they name. A
  RM20 voucher for two people is RM10 off each, regardless of what they ate.
- **Over-sized discounts clamp at zero and redistribute.** If someone's discount
  exceeds their share, they pay nothing and the unabsorbed remainder moves onto
  everyone else by ratio, iteratively. The bill total is unchanged.
- **`nearest5sen` is for cash settlement.** It rounds the payable total to the
  5 sen grid a till uses, then puts every share on that grid too. The sen this
  moves is reported per person as its own `cashRoundingShareSen` line rather than
  being smeared through the other components.
- **Belanja chains collapse.** If A covers B and B covers C, A pays for all
  three. Cycles and double sponsorship are rejected.

### Test coverage

- The specified acceptance vector, asserted to the sen.
- Seven property tests, each over 2,000 generated bills: shares sum to the
  total, unallocated value is held back correctly, belanja conserves money,
  nobody is charged a negative amount, breakdowns always explain the share, the
  result is independent of input ordering, and claiming a stray item never
  changes what the table pays.
- Edge cases: single person, one item shared by everyone, zero-value items, a
  person who claims nothing, over-sized adjustments, cascading clamps, and
  cash rounding.

Bills are generated by a seeded PRNG in `lib/split/__tests__/generate.ts` rather
than a property-testing library, so no dependency outside the agreed stack was
added. Failures print the seed, and `generateBill(seed)` replays the exact case.

## Security model

Only the payer has an account. A guest's entire credential is the share link.

- **Payer** authenticates with Supabase Auth and owns their bills. Row level
  security scopes every table to `owner_id`.
- **Guest** sends the bill's `share_token` in an `x-share-token` header, which
  grants read access to exactly that one bill's rows. To write, they also send
  their `claim_token` in `x-claim-token`, which grants insert and delete on
  their own claims and nothing else. There is no update policy on `claims` at
  all.
- Tokens travel in headers, not query strings, so they stay out of server logs
  and `Referer`.
- `claim_token` is withheld from guest reads by a column grant, so a shared
  screen does not hand out everyone else's write capability.
- Participants are created through a `security definer` RPC rather than a direct
  insert, so a guest can never choose their own `claim_token`.

`supabase/tests/rls.test.sql` covers this, including the case that matters most:
a guest holding one link cannot read another bill.

**Accepted trade-off.** Anyone holding the link can pick any name at the table
and claim as that person. That is inherent to "guests never sign up" — there is
no identity to check against. The blast radius is one bill, the payer watches
every claim live, and the payer stays the source of truth for settlement.

## Live claiming

When anyone claims or unclaims, every open page follows within a second.

**Broadcast, not `postgres_changes`.** A guest's read access comes from an
`x-share-token` request header, which PostgREST exposes to row level security as
`request.headers`. Realtime does not set that setting, so `bill_is_shared()` is
false inside a Realtime connection and `postgres_changes` would deliver a guest
nothing at all. Changes are announced over a broadcast channel instead, on a
topic derived from the share token — knowing the topic and knowing the link are
the same thing.

**Events are untrusted.** The payload carries no row data, only which table
moved. Clients treat an event as "something changed, go and look" and refetch
through PostgREST, where row level security still applies. A forged broadcast
can cost a client one wasted request; it can never put data on a screen or read
any. Announcing is also best effort: the trigger swallows its own errors, so a
bill can never fail to save because the realtime layer is down.

**Offline.** Taps go into a queue keyed by `(bill, participant)` and persisted to
`localStorage`, so they survive a reload on a bad connection. What the screen
shows is the projection of that queue over the last known server state. Because
a claim row is keyed by `(item, person)`, a queued tap only ever overrides your
own row: two people claiming the same item at the same moment both succeed and
it becomes shared. On reconnect the queue flushes in sequence order and the page
reconciles against the server. Writes are idempotent upserts, so a retry after a
timeout cannot collide with the write that actually landed.

A refusal is told apart from a dropped connection by whether the error carries a
Postgres code: connection failures are retried, refusals are dropped and
surfaced rather than left stuck on screen forever.

The connection state is deliberately quiet — nothing at all when it works, and
when it does not, a line saying the taps are safe rather than that something
broke.

## Receipt OCR

The payer photographs the receipt; the parsed items land on a review screen, and
only reach the bill once the payer has said so.

**The response format is enforced, not requested.** `output_config.format`
carries a JSON Schema, so "strict JSON only, no prose, no markdown fences" is a
property of the API call rather than something the prompt asks for and hopes
for. The prompt spends its words on what a schema cannot express: what counts as
a line item, how Malaysian charge lines are printed, and that an unreadable
photo should come back empty rather than guessed at.

**Nothing is trusted on the way in.** The model's output is re-validated before
it is stored and again before it is rendered. A price that is somehow a float or
negative would make the engine throw and take the page down, instead of showing
the payer a screen they can fix.

**Reconciliation is live.** If the items do not sum to the printed subtotal, the
review screen says so with both figures and the difference, and recomputes as
the payer edits — so correcting the misread line clears the warning there and
then. A mismatch between the printed charges and the printed total is flagged
separately.

**Rates are back-derived, not assumed.** A printed charge is a rounded number,
so dividing it out gives a rate with a tail on it. Candidate rates from a round
grid are tested by recomputing the charge instead: the nicest rate that
reproduces the printed amount exactly is the one the restaurant used, and when
nothing round fits — a restaurant charging something unusual — the quotient is
used as-is. The result is that the totals guests see match the paper on the
table.

**Every failure ends at manual entry.** A bad photo, a non-receipt image, an
unconfigured key, a rate limit, a dropped connection: each returns a sentence
the payer can act on, with the manual form already on the screen behind it.

**Receipts are payer-only.** A receipt photo routinely shows the last four
digits of a card. There is no guest policy on the `receipts` table or the
storage bucket at all, and photos are downscaled to 1568px and re-encoded as
JPEG in the browser before upload — which also normalises an iPhone's HEIC into
something the API accepts.

## Settlement

DuitNow transfer to a mobile number is the default rail. The guest sees what
they owe and the payer's number, each with its own Copy button — the amount
copies as `99.89` rather than `RM99.89`, because it is going to be pasted into a
banking app. A personal DuitNow QR cannot be generated by anyone but the payer's
own bank, so the payer uploads a screenshot of theirs once and guests scan it.
Cash is a toggle the payer confirms, because at the mamak half the table still
pays cash.

**The app cannot see anyone's bank account**, so it cannot know who has paid.
There are only two honest sources of that claim, and the schema keeps them
apart: a proof the guest submitted, and the payer saying so. A row in
`payment_proofs` is evidence; `participants.settled_at` is the verdict.

**A guest's own figures are never trusted.** A guest never signs in, so anything
they write they could forge. The amount, reference and recipient on a proof are
read out of the screenshot on the server and written with the service role — an
authority the guest does not have. That is the only reason
`SUPABASE_SERVICE_ROLE_KEY` exists in this project, and the only place it is
used. Without it, proof upload switches itself off rather than degrading to
something untrustworthy.

**What a match requires**, in order, in `lib/settlement/proof.ts`: it has to look
like a completed transfer; the amount has to be readable and not a guess; the
reference must not already have been used on this bill; the recipient, when both
sides are known, has to be the payer's number; and the amount has to be exactly
what is owed. The duplicate check runs before the amount check on purpose — a
screenshot lifted from another debt has the right amount by construction.

Anything short of a match is recorded and shown to the payer to judge. It never
rejects the guest and never accuses anyone; the wording routes to the payer
instead. And the payer can always undo a settlement, because a mark that cannot
be reversed is not one you can trust.

## Reminders

Asking a friend for RM23.50 is socially expensive. A neutral third party doing
the asking is the point, which only works if the words never sound like a
demand.

**Nothing is sent automatically.** The app works out who is due and writes the
message; the payer taps once and their own WhatsApp sends it. Automated outbound
messaging would need WhatsApp Business API approval and drifts toward spam, so
it is deliberately not built.

**Three nudges, ever.** The default cadence leaves it three days, then every
three days, and then stops. The cap is enforced in the action as well as in the
UI, so a stale page cannot send a fourth. The payer can snooze one person for
three days, never nudge them again, or switch the whole bill off.

**The clock starts when reminders are switched on**, not when the bill was
created — turning them on for a week-old bill would otherwise fire three at once.

**The copy is blameless**, and a test enforces it: no "owe", no "overdue", no
"outstanding", no "please pay", at any stage. Later nudges get more direct but
not colder, and the last one still offers a way out.

> Hi Ben! Just a nudge on the RM96.78 for Sunday breakfast at Village Park 🙂
> No rush — everything's here if you want to check it: …

**No group shaming.** A message carries one name and one amount and is addressed
to one person; a test asserts it mentions nobody else and contains exactly one
figure. The WhatsApp link carries no phone number — the payer picks the contact —
so the app never stores a guest's number and cannot message anyone by itself.

## Limits

A free account gets **3 bills**, and each bill gets **5 receipt scans** and
**15 proof checks**.

**Deleting a bill does not give the allowance back.** What is metered is bills
ever created, held as a monotonic counter on the profile rather than
`count(*) from bills` — otherwise the limit is one delete away from meaningless.
The message says so plainly, because trying a delete is the first thing anyone
would do.

The scan allowances are per bill and monotonic for the same reason: re-scanning
is what costs money, whether or not the result was kept. They replaced an
earlier rolling-hour throttle, which bounded bursts but not totals, and which
could be reset by making a new bill or — for proofs — rejoining the bill under a
new name.

Both are spent through `consume_scan`, where the check and the increment are one
statement, so two requests arriving together cannot both take the last one. The
limit is passed in from `lib/limits.ts` rather than stored in the database, so
the number shown to the user and the number enforced are the same constant.

Nothing is ever a dead end. Out of receipt scans, items can still be typed in;
out of proof checks, the payer can still mark people paid. Both fallbacks are
free, and the messages name them.

Sizing, roughly: a vision call is about five sen, so a free account's worst case
is 3 × (5 + 15) = 60 calls, around RM3. That is the number to hold in mind when
the paid tier gets priced.

**Built for a paid tier.** The ceiling lives on `profiles.bill_quota` with a
`plan` column beside it, so raising it for one account is an UPDATE, not a
migration. Verified live: setting `bill_quota` higher lets a blocked account
carry on immediately. A **null** `bill_quota` means no ceiling at all — spelled
as an absence rather than a very large number, so nothing has to special-case
`2147483647` when displaying it. The administrator's account is set that way in
migration 0009.

**Creating a bill is idempotent.** `public.create_bill` hands back the untouched
draft an account already has instead of making a second one, under a per-account
advisory lock so two simultaneous taps cannot both look, both find nothing, and
both insert. This is not a nicety: one account created three bills at 04:09:18,
04:09:20 and 04:09:21 — three taps on a button that gave no feedback — and used
its entire lifetime allowance in three seconds. Verified live: five concurrent
calls now produce one bill and charge the quota once.

## Every CTA shows it is working

A form posting to a server action takes a few hundred milliseconds during which
nothing on screen changes. On a phone that is indistinguishable from a missed
tap, so the reasonable thing to do is tap again — and every tap is another
request. That is how the three-bills-in-three-seconds incident above happened.

The rule, applied to every submit in the app:

- `components/pending.tsx` exports `SubmitButton`, which reads `useFormStatus`
  and goes `disabled` with a spinner and a verb in the present tense
  (`Starting a bill…`, `Opening WhatsApp…`). `disabled` is the fix; the spinner
  is the explanation. Neither works alone — without disabling the taps still
  land, and without the spinner the button looks broken rather than busy.
- Anything whose double-submit **costs** something is also made idempotent on
  the server, because the client guard does not exist before hydration.
- Destructive submits use `ConfirmButton`, which takes two taps and disarms
  itself after five seconds. Inline, not `confirm()`: some in-app browsers
  suppress native dialogs, and one on a phone is easier to dismiss by reflex
  than to read.
- Route transitions have `loading.tsx` skeletons. Every page here is
  `force-dynamic`, so a navigation waits on the server, and the alternative is
  the previous screen sitting unchanged — the same ambiguity in a different
  place.
- The spinner and skeleton animations are switched off under
  `prefers-reduced-motion`, where the pending label and `aria-busy` carry the
  meaning instead. The blanket "collapse every animation to 0.01ms" rule has to
  be overridden for them specifically: applied to an infinitely repeating
  animation it renders at full speed rather than stopping.

## Items that divide a fixed number of ways

By default a line is divided by whoever has claimed it, which is right for an
ordinary dish and wrong for a shared one: two people claiming a set for four are
each charged half, and the figure halves again when the other two tap. Correct at
every instant, and not safe to act on — which people do, so `settled_amount_sen`
exists to catch the damage afterwards.

Setting `bill_items.portions` removes the cause rather than reporting it:

- Each claimant pays `price / portions`, so the figure shown at the moment
  somebody taps is the figure they owe, and it never moves.
- Portions nobody takes stay **unallocated** instead of landing on whoever was
  fastest. The payer sees them in the usual unclaimed warning.
- No more claimants than portions. Enforced by a trigger holding `for update` on
  the line, because guests write claims directly under row level security and
  the hard case is two people tapping the last portion at once. Verified live:
  five simultaneous claims on a four-portion line, exactly four succeed.
- The count cannot be cut below the claims already made, or the engine would
  refuse to compute the bill at all — it will not re-divide behind people's
  backs, so that is stopped where it can still be explained.

The payer can claim too. They ate as well, and until now had no way to say so:
participants were either names they typed for other people or guests who opened
the link. With a pinned divisor that gap has a price, because their portion of a
shared dish could never be taken by anyone. `participants.user_id` marks the row
that is the account holder — at most one per bill, and never granted to guests.

## How the interface is built

Everything below is one bet: the qualities that make an app feel handled rather
than read — directness, weight, physicality — come from a handful of decisions
made consistently, not from decoration.

**Type is a ramp, not a set of sizes.** `.type-display` down to `.type-caption`
in `app/globals.css` fix size, weight, leading and tracking together, and the
tracking is specific to each size: large text is pulled in (`-0.022em`), small
text is let out (`+0.01em`). Letters drift apart as they grow, so a single
`letter-spacing` across a ramp is wrong at one end of it or the other.
Everything is set in `rem` and spaced in `rem`, so a larger system text size
scales the layout with the words instead of bursting it.

**Chrome is a material with the page moving underneath it.** The running total
on the claim screen and the New bill bar float as blurred, translucent layers
(`.material`) with the list passing beneath, and content fades out into them
(`.scroll-edge`) rather than being ruled off by a hairline. A border under a
sticky bar claims the content ends there. It does not, and seeing it continue is
what says so.

**Presses answer on the way down.** `components/press-feedback.tsx` installs one
pointer listener for the whole app; anything with `data-press` highlights on
pointer-*down* and still acts on release. It is revocable the way a real press
is: slide off the target and the highlight comes off, slide back and it returns,
and a scroll cancels it outright. `:active` cannot express any of that, and
Safari on iOS withholds it from elements it has decided are not interactive.

**Sheets are objects you can throw.** `components/sheet.tsx` and
`lib/motion/spring.ts` replace the dialogs that used to appear and vanish. The
sheet tracks the finger exactly from wherever it was grabbed, hands the release
velocity straight to the spring so there is no seam between dragging and
animating, decides its fate by projecting the flick forward rather than reading
where the finger stopped, and resists rather than stopping dead at its top edge.
Nothing is ever locked: grab it while it is opening or closing and it is yours
from wherever it is that instant, because the spring animates from the value on
screen and carries its velocity through a retarget. Springs are parameterised as
damping and response, not mass and stiffness — overshoot is spent only where a
gesture put momentum in.

**Accessibility settings are three separate answers.** Reduced motion trades
travel and overshoot for a cross-fade and keeps the feedback (a dragged sheet
still follows the finger — that is the user's own hand, not the interface moving
under them). Reduced transparency frosts the materials solid and drops the blur.
More contrast makes the hairlines visible and the muted text less muted.

**Haptics are spent on two things.** A claim landing, and a settlement being
confirmed. Nothing else. A phone that buzzes at everything teaches the hand to
stop listening, and then it cannot buzz for the one thing that mattered. Only
Android Chrome implements it; nothing depends on it, because the visual always
carries the meaning alone.

## Notes on the build

- `@supabase/ssr` is used alongside `@supabase/supabase-js`. It is Supabase's own
  package for cookie-based auth in the Next.js App Router, and the listed stack
  cannot do payer sign-in without it.
- `bills.subtotal_sen` is a cached denormalisation, maintained by a trigger so it
  cannot drift from the line items.
- `bills.rounding_mode` was added to the specified schema; the engine needs it
  and it belongs per bill rather than per app.
- Guest claims are written with `upsert ... ignoreDuplicates`, so a double tap
  cannot collide on the composite primary key.
- The vision model is `claude-sonnet-4-6`, as named in the spec. `claude-sonnet-5`
  is newer and cheaper ($2/$10 per MTok against $3/$15); set `ANTHROPIC_MODEL` to
  switch.
- 0003 grants `EXECUTE` back on the row level security predicate functions.
  0001 revoked it on the reasoning that they were internal machinery, which was
  wrong: Postgres evaluates a policy expression as the role running the query,
  so with EXECUTE revoked every policy that calls one fails and nobody can read
  anything.
- Tap direction is decided inside the state updater, against the queue React
  holds at that instant. Deciding from a snapshot made every tap in a fast burst
  say "claim it", so a quick double tap left the item on.
