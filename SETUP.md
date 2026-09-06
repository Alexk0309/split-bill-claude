# Setup

About 15 minutes. At any point you can run `npm run check` to see what is done
and what is not — it verifies each step against the live services rather than
just checking that a variable is present.

```bash
cp .env.example .env.local
```

`.env.local` is gitignored. Never commit it, and never paste a key into a chat
or an issue.

---

## 1. Anthropic API key

Only needed for receipt scanning. Everything else — creating bills, share links,
claiming, live updates — works without it, and the scan button will say so
rather than breaking.

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in.
2. **Settings → API keys → Create Key**. Name it something like `split-bill-dev`.
3. Copy it now; it is shown once.
4. Put it in `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

A brand-new account needs credit before the API will answer. **Plans & Billing →
Buy credits** — the smallest amount is plenty, since a receipt scan costs
roughly a tenth of a cent.

`npm run check` validates the key against Anthropic's model list, which costs
nothing.

---

## 2. Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Name it, and set a database password. **Save that password** — you need it in
   step 3, and it is not shown again.
3. Region: **Southeast Asia (Singapore)** is the closest to Malaysia.
4. Wait a minute or two while it provisions.

Then **Project Settings → API** and copy two values into `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

The second is the **anon / public** key — newer dashboards may call it the
**publishable** key. Either way it is the client-side one, safe to ship in a
browser.

From the same page, also copy the **`service_role`** key:

```
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

This one bypasses row level security entirely, so it is server-only and its name
deliberately has no `NEXT_PUBLIC_` prefix. It is used in exactly one place:
recording a payment proof. A guest never signs in, so anything they write they
could forge — the figures on a proof are therefore read out of the screenshot by
the server and written with an authority the guest does not have. Without it,
proof upload is switched off and the payer marks people paid by hand; everything
else still works.

Never put it in a `NEXT_PUBLIC_` variable, and never commit it.

---

## 3. Apply the schema

Four migrations, and **the order matters** — later ones depend on earlier ones.

### Option A — the CLI (recommended)

No install and no Docker needed; `npx` fetches it, and pushing to a hosted
project does not use a local database.

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

Your project ref is the `xxxxxxxxxxxx` part of the API URL, also shown under
**Project Settings → General**. Linking asks for the database password from
step 2.

```bash
npx supabase db push
```

That applies all four migrations in order and prints what it ran.

### Option B — the SQL editor

If you would rather not use the CLI: open **SQL Editor → New query** in the
dashboard and run each file's contents, **in this order**, one at a time:

1. `supabase/migrations/0001_init.sql` — tables, row level security, guest RPCs
2. `supabase/migrations/0002_realtime.sql` — live claiming
3. `supabase/migrations/0003_policy_function_grants.sql` — lets policies call their own predicates
4. `supabase/migrations/0004_receipts.sql` — receipts table and storage bucket

Do not skip 0003. Without it every policy fails and the app looks like an empty
database rather than a broken one.

---

## 4. Auth URLs

The payer signs in with a magic link, which needs to know where to send people
back to.

**Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000`
- **Redirect URLs**: add `http://localhost:3000/auth/callback`

Add your deployed URL to the redirect list too, once you have one.

> Supabase's built-in email sender is rate limited to a couple of messages an
> hour on the free tier. That is fine for you testing, and the first thing to
> change if you invite anyone else. **Authentication → Emails → SMTP Settings**
> takes any provider — Resend and Postmark both have free tiers.

Guests never receive email and never sign in, so none of this affects them.

---

## 5. Check it

```bash
npm run check
```

It confirms the project is reachable, that each migration landed, that anonymous
readers are correctly locked out, that the guest join RPC is callable, and that
your Anthropic key works.

```bash
npm run dev
```

Open <http://localhost:3000>, sign in, and build a bill.

---

## 6. Testing with other people

The share link points at whatever origin the app is running on, so
`http://localhost:3000/b/...` will not open on a friend's phone. Two options:

**A tunnel**, for a quick test on your own phone:

```bash
npx --yes localtunnel --port 3000
```

Set `NEXT_PUBLIC_SITE_URL` in `.env.local` to the URL it prints, add
`<that-url>/auth/callback` to the Supabase redirect list, and restart `npm run dev`.

**Or deploy it.** See the next section.

---

## 7. Optional: run the database tests

The row level security suite in `supabase/tests/rls.test.sql` runs against a real
Postgres, which means Docker.

```bash
brew install --cask docker
```

Start Docker Desktop once so it can finish setting itself up, then:

```bash
npx supabase start
```

```bash
npx supabase test db
```

27 assertions, including the one that matters most: a guest holding one share
link cannot read another bill. Worth running once before you show this to
anyone.

```bash
npx supabase stop
```

---

## 8. Deploying to Vercel

```bash
npx vercel login
```

```bash
npx vercel link --yes
```

Then set the four environment variables from step 1 and 2 in **Project →
Settings → Environment Variables**, Production scope. The dashboard takes a
whole `.env` block pasted at once. `SUPABASE_SERVICE_ROLE_KEY` and
`ANTHROPIC_API_KEY` must **not** get a `NEXT_PUBLIC_` prefix — that prefix is
what ships a value to the browser.

`NEXT_PUBLIC_SITE_URL` is not needed: `siteUrl()` reads Vercel's own
`VERCEL_PROJECT_PRODUCTION_URL`, and it is only ever called server-side, so
share links point at the real domain automatically.

Then deploy:

```bash
npx vercel --prod
```

### Three things that will stop you

**Your git commit email has to be a real one.** Vercel refuses to build a commit
whose author it cannot identify. With `user.email` unset, git derives one from
the machine hostname — `you@Your-MacBook-Air.local` — and the deployment is
blocked with no build log at all, showing only an opaque `UNKNOWN` status.

```bash
git config user.email "the-email-on-your-github-account"
```

**Deployment Protection is on by default for team accounts**, and it is fatal
here: every request redirects to a Vercel login, and guests are the entire point
of this product and have no Vercel account. Turn it off at **Project → Settings
→ Deployment Protection → Vercel Authentication → Disabled**.

**Supabase has to know the production URL**, or sign-in fails silently.
**Authentication → URL Configuration**: set the Site URL, and add
`https://<your-domain>/auth/callback` to the redirect list. For preview
deployments too, add a wildcard such as
`https://*-<your-team>.vercel.app/auth/callback`.
