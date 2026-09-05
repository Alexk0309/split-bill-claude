#!/usr/bin/env node
/**
 * Checks that the project is actually wired up: env vars present, Supabase
 * reachable, schema applied, policies working, Anthropic key valid.
 *
 * Run with: npm run check
 *
 * Nothing here prints a secret. Keys are only ever sent to the service they
 * belong to, and only their shape is reported back.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';
const RESET = '[0m';

let failures = 0;
let warnings = 0;

const pass = (label, detail) =>
  console.log(`${GREEN}  ok${RESET}   ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`);
const fail = (label, detail) => {
  failures += 1;
  console.log(`${RED} FAIL${RESET}   ${label}`);
  if (detail) console.log(`         ${DIM}${detail}${RESET}`);
};
const warn = (label, detail) => {
  warnings += 1;
  console.log(`${YELLOW} warn${RESET}   ${label}`);
  if (detail) console.log(`         ${DIM}${detail}${RESET}`);
};
const heading = (text) => console.log(`\n${text}`);

/** Minimal .env parser: no dependency, and it only needs to handle KEY=value. */
function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function main() {
  console.log('Checking your setup...');

  const fileEnv = loadEnvLocal();
  if (fileEnv === null) {
    heading('Environment');
    fail('.env.local not found', 'Run: cp .env.example .env.local, then fill it in.');
    console.log(`\n${RED}Nothing else can be checked until that exists.${RESET}\n`);
    process.exit(1);
  }
  const env = { ...fileEnv, ...process.env };

  /* ---------------------------------------------------------------- */
  heading('Environment');

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const model = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

  if (!url || url.includes('your-project')) {
    fail('NEXT_PUBLIC_SUPABASE_URL is not set', 'Supabase dashboard -> Project Settings -> API');
  } else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url.replace(/\/$/, '') + '/')) {
    warn('NEXT_PUBLIC_SUPABASE_URL looks unusual', url);
  } else {
    pass('NEXT_PUBLIC_SUPABASE_URL', url);
  }

  if (!anonKey || anonKey.includes('your-anon')) {
    fail('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
  } else {
    pass('NEXT_PUBLIC_SUPABASE_ANON_KEY', `set, ${anonKey.length} chars`);
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || serviceKey.includes('your-service-role')) {
    warn(
      'SUPABASE_SERVICE_ROLE_KEY is not set',
      'Guests cannot upload payment proofs; the payer marks people paid by hand.',
    );
  } else if (serviceKey === anonKey) {
    fail(
      'SUPABASE_SERVICE_ROLE_KEY is the same as the anon key',
      'Copy the service_role key from Project Settings -> API.',
    );
  } else {
    pass('SUPABASE_SERVICE_ROLE_KEY', `set, ${serviceKey.length} chars`);
  }

  if (!anthropicKey || anthropicKey.includes('sk-ant-...')) {
    warn('ANTHROPIC_API_KEY is not set', 'Receipt scanning will be disabled; everything else works.');
  } else if (!anthropicKey.startsWith('sk-ant-')) {
    warn('ANTHROPIC_API_KEY does not start with sk-ant-', 'Check you copied the whole key.');
  } else {
    pass('ANTHROPIC_API_KEY', `set, ${anthropicKey.length} chars`);
  }

  /* ---------------------------------------------------------------- */
  if (url && anonKey && !url.includes('your-project')) {
    const base = url.replace(/\/$/, '');
    const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

    heading('Supabase');

    let reachable = false;
    try {
      // The auth health endpoint, deliberately: PostgREST's root (/rest/v1/)
      // accepts only the service_role key, so probing it makes a perfectly good
      // anon key look rejected.
      const response = await fetch(`${base}/auth/v1/health`, { headers });
      if (response.ok) {
        pass('project is reachable, anon key accepted');
        reachable = true;
      } else if (response.status === 401) {
        fail('anon key rejected', 'The URL and the key may be from different projects.');
      } else {
        fail(`unexpected response from the API (${response.status})`);
      }
    } catch (error) {
      fail('could not reach the project', error.message);
    }

    if (reachable) {
      // Each table belongs to a different migration, so a missing one says
      // exactly which migration has not been applied.
      //
      // `expect` differs by table. Guests may read bills and claims, subject to
      // row level security, so those return an empty list. Guests may not read
      // receipts at all -- 0004 revokes it, because a receipt photo shows the
      // last four digits of a card -- so a permission error there is the
      // feature working, not a fault.
      const tables = [
        { name: 'bills', migration: '0001_init.sql', expect: 'readable' },
        { name: 'claims', migration: '0001_init.sql', expect: 'readable' },
        { name: 'receipts', migration: '0004_receipts.sql', expect: 'denied-to-guests' },
        { name: 'payment_proofs', migration: '0006_settlement.sql', expect: 'readable' },
      ];

      for (const { name, migration, expect, } of tables) {
        const column = name === 'claims' ? 'item_id' : 'id';
        try {
          const response = await fetch(`${base}/rest/v1/${name}?select=${column}&limit=1`, {
            headers,
          });
          const body = await response.text();
          const missing = body.includes('42P01') || response.status === 404;
          const denied = body.includes('42501');

          if (missing) {
            fail(`table "${name}" is missing`, `Apply ${migration}.`);
          } else if (denied && body.includes('function')) {
            // Distinct from a table-level denial: this is a policy unable to
            // call its own predicate, which locks everyone out of everything.
            fail(
              `policies on "${name}" cannot call their predicate functions`,
              'Apply 0003_policy_function_grants.sql.',
            );
          } else if (expect === 'denied-to-guests') {
            if (denied) {
              pass(`table "${name}" exists`, 'and is correctly closed to guests');
            } else if (response.ok) {
              fail(
                `guests can read "${name}"`,
                'Receipt photos are payer-only. Re-apply 0004_receipts.sql.',
              );
            } else {
              warn(`table "${name}" returned ${response.status}`, body.slice(0, 160));
            }
          } else if (response.ok) {
            pass(`table "${name}" exists`);
          } else {
            warn(`table "${name}" returned ${response.status}`, body.slice(0, 160));
          }
        } catch (error) {
          fail(`could not query "${name}"`, error.message);
        }
      }

      // A guest with no share token must see nothing rather than erroring.
      try {
        const response = await fetch(`${base}/rest/v1/bills?select=id`, { headers });
        const body = await response.text();
        if (response.ok && body.trim() === '[]') {
          pass('row level security is closed to anonymous readers');
        } else if (response.ok) {
          fail('anonymous readers can see bills without a share token', body.slice(0, 160));
        } else {
          warn(`policy check returned ${response.status}`, body.slice(0, 160));
        }
      } catch (error) {
        warn('could not run the policy check', error.message);
      }

      // The guest join RPC must exist and be callable by anon.
      try {
        const response = await fetch(`${base}/rest/v1/rpc/join_bill`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ p_share_token: '__setup_check__', p_display_name: 'check' }),
        });
        const body = await response.text();
        if (body.includes('Unknown share link')) {
          // Rejecting a nonsense token is exactly right.
          pass('guest join RPC is callable');
        } else if (body.includes('PGRST202') || response.status === 404) {
          fail('join_bill RPC is missing', 'Apply 0001_init.sql.');
        } else {
          warn(`join_bill returned ${response.status}`, body.slice(0, 160));
        }
      } catch (error) {
        warn('could not check the join RPC', error.message);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  if (anthropicKey && anthropicKey.startsWith('sk-ant-')) {
    heading('Anthropic');
    try {
      // Listing models validates the key without spending anything.
      const response = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      });

      if (response.status === 401) {
        fail('API key rejected', 'Create a new one at console.anthropic.com -> API keys.');
      } else if (!response.ok) {
        warn(`models endpoint returned ${response.status}`, (await response.text()).slice(0, 160));
      } else {
        pass('API key is valid');
        const { data } = await response.json();
        const ids = (data ?? []).map((entry) => entry.id);
        if (ids.includes(model)) {
          pass(`model "${model}" is available to this account`);
        } else {
          warn(
            `model "${model}" was not in this account's model list`,
            `Available include: ${ids.slice(0, 6).join(', ')}`,
          );
        }
      }
    } catch (error) {
      fail('could not reach the Anthropic API', error.message);
    }
  }

  /* ---------------------------------------------------------------- */
  console.log('');
  if (failures > 0) {
    console.log(`${RED}${failures} thing${failures === 1 ? '' : 's'} still to fix.${RESET}`);
    if (warnings > 0) console.log(`${YELLOW}${warnings} warning${warnings === 1 ? '' : 's'}.${RESET}`);
    console.log('');
    process.exit(1);
  }
  if (warnings > 0) {
    console.log(`${YELLOW}Ready, with ${warnings} warning${warnings === 1 ? '' : 's'}.${RESET}`);
  } else {
    console.log(`${GREEN}Everything is wired up. Run: npm run dev${RESET}`);
  }
  console.log('');
}

await main();
