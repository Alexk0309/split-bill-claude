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
| 2 | Live claiming | not started |
| 3 | Receipt OCR | not started |
| 4 | Settlement | not started |
| 5 | Reminders | not started |

## Setup

Create a Supabase project, then:

```bash
cp .env.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the
project's API settings, and apply the schema:

```bash
supabase db push
```

Or paste `supabase/migrations/0001_init.sql` into the SQL editor. Supabase Auth
needs email sign-in enabled, with `<your-origin>/auth/callback` in the redirect
allow list.

```bash
npm run dev
```

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

## Routes

| | |
| --- | --- |
| `/` | Landing, redirects a signed-in payer to their bills |
| `/login` | Magic link sign-in. Payer only |
| `/bills` | The payer's bills |
| `/bills/[id]` | Build the bill, set rates, get the share link |
| `/b/[token]` | The guest claim page. No account, no session |

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
