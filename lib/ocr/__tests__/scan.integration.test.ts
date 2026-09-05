/**
 * Live check of the vision path. Costs a fraction of a cent and needs network,
 * so it is opt-in and never runs as part of `npm test`:
 *
 *   RUN_OCR_INTEGRATION=1 npx vitest run lib/ocr/__tests__/scan.integration.test.ts
 *
 * It reads ANTHROPIC_API_KEY out of .env.local so it matches what the app uses.
 *
 * The fixture is a cleanly rendered receipt, not a photograph of thermal paper
 * under mamak lighting. Passing here proves the request shape, the schema
 * constraint, the parsing and the rate recovery all work end to end; it says
 * nothing about OCR accuracy on a crumpled receipt, which is exactly why the
 * product always shows a review screen.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeSplit } from '@/lib/split';
import { deriveRates, reconcile } from '../reconcile';
import { scanReceipt } from '../scan';

const RECEIPT_TEXT = `

        VILLAGE PARK RESTAURANT
       No 5, Jalan SS21/37, Damansara
          Tel: 03-7710 7860
       SST Reg No: W10-1808-31000123

  Date: 05/09/2026 09:14   Table: 12
  Bill No: VP-004821       Staff: Aina
  ------------------------------------
  1  Nasi Lemak Ayam Goreng     18.00
  1  Ribeye Steak               75.00
  2  Kopi Ais           3.25     6.50
  1  Sotong Goreng Tepung       32.00
  ------------------------------------
                 Subtotal      131.50
                 Service Charge 10%
                                13.15
                 SST 6%          8.68
  ------------------------------------
                 TOTAL         153.33
                 CASH          160.00
                 CHANGE          6.67
  ------------------------------------
        THANK YOU. PLEASE COME AGAIN
`;

function loadKeyFromEnvLocal(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== 'ANTHROPIC_API_KEY') continue;
    return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

/** Renders the receipt to a PNG using macOS's own text-to-PDF-to-image tools. */
function renderReceiptPng(): string {
  const dir = mkdtempSync(join(tmpdir(), 'receipt-'));
  const txt = join(dir, 'receipt.txt');
  const pdf = join(dir, 'receipt.pdf');
  const png = join(dir, 'receipt.png');
  writeFileSync(txt, RECEIPT_TEXT);
  execFileSync('sh', ['-c', `cupsfilter -t receipt ${txt} > ${pdf} 2>/dev/null`]);
  execFileSync('sips', [
    '-s', 'format', 'png',
    '--resampleWidth', '1000',
    pdf, '--out', png,
  ]);
  return readFileSync(png).toString('base64');
}

const enabled = process.env.RUN_OCR_INTEGRATION === '1';

describe.runIf(enabled)('receipt scanning against the live API', () => {
  it(
    'reads a receipt into the shape the engine can use',
    { timeout: 120_000 },
    async () => {
      const key = loadKeyFromEnvLocal();
      expect(key, 'ANTHROPIC_API_KEY not found in the environment or .env.local').toBeTruthy();
      process.env.ANTHROPIC_API_KEY = key;

      const outcome = await scanReceipt(renderReceiptPng(), 'image/png');
      if (!outcome.ok) throw new Error(`scan failed: ${outcome.kind} - ${outcome.message}`);
      const receipt = outcome.receipt;

      // The charge lines and the payment lines are not items.
      const names = receipt.items.map((i) => i.name.toLowerCase()).join(' | ');
      for (const forbidden of ['subtotal', 'service charge', 'sst', 'total', 'cash', 'change']) {
        expect(names, `"${forbidden}" was transcribed as a line item`).not.toContain(forbidden);
      }
      expect(receipt.items).toHaveLength(4);

      // A quantity-2 line prints both a unit price and a line total; the line
      // total is the one that matters.
      const kopi = receipt.items.find((i) => /kopi/i.test(i.name));
      expect(kopi?.price_sen, 'Kopi Ais should be the line total, not the unit price').toBe(650);

      expect(receipt.subtotal_sen).toBe(13150);
      expect(receipt.service_charge_sen).toBe(1315);
      expect(receipt.service_tax_sen).toBe(868);
      expect(receipt.total_sen).toBe(15333);
      expect(receipt.venue?.toLowerCase()).toContain('village park');

      // It has to add up, and the recovered rates have to reproduce the paper.
      expect(reconcile(receipt).ok).toBe(true);
      expect(deriveRates(receipt)).toEqual({ serviceChargeRate: 0.1, serviceTaxRate: 0.06 });

      const rates = deriveRates(receipt);
      const split = computeSplit({
        people: [{ id: 'p1', name: 'Payer' }],
        items: receipt.items.map((item, i) => ({
          id: `i${i}`,
          name: item.name,
          priceSen: item.price_sen,
          claimantIds: ['p1'],
        })),
        serviceChargeRate: rates.serviceChargeRate ?? 0,
        serviceTaxRate: rates.serviceTaxRate ?? 0,
        adjustments: [],
        belanja: [],
        roundingMode: 'sen',
      });
      expect(split.billTotalSen).toBe(receipt.total_sen);
    },
  );
});
