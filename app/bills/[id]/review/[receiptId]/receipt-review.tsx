'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';

import { SubmitButton } from '@/components/pending';
import { BackLink, Banner, Money } from '@/components/ui';
import { formatRateAsPercent } from '@/lib/bill/rates';
import { formatSen, parseAmountToSen } from '@/lib/money';
import type { DerivedRates } from '@/lib/ocr/reconcile';
import type { ParsedReceipt, ReceiptConfidence } from '@/lib/ocr/schema';

import { applyReceipt, type ActionResult } from '../../../actions';

interface Row {
  key: string;
  name: string;
  price: string;
}

const CONFIDENCE_NOTE: Record<ReceiptConfidence, string | null> = {
  high: null,
  medium: 'Some of this needed guessing. Worth a look before you send it.',
  low: 'This photo was hard to read. Check every line.',
};

/** Best-effort only, for the live totals; the server re-parses on submit. */
function senOrNull(price: string): number | null {
  try {
    const sen = parseAmountToSen(price);
    return sen >= 0 ? sen : null;
  } catch {
    return null;
  }
}

export function ReceiptReview({
  billId,
  receiptId,
  receipt,
  rates,
}: {
  billId: string;
  receiptId: string;
  receipt: ParsedReceipt;
  rates: DerivedRates;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    receipt.items.map((item, index) => ({
      key: `parsed-${index}`,
      name: item.name,
      price: formatSen(item.price_sen, { grouped: false }),
    })),
  );
  const [venue, setVenue] = useState(receipt.venue ?? '');
  const [chargePercent, setChargePercent] = useState(
    rates.serviceChargeRate === null ? '' : formatRateAsPercent(rates.serviceChargeRate),
  );
  const [taxPercent, setTaxPercent] = useState(
    rates.serviceTaxRate === null ? '' : formatRateAsPercent(rates.serviceTaxRate),
  );
  const [state, action] = useActionState<ActionResult | undefined, FormData>(
    applyReceipt,
    undefined,
  );

  /**
   * Recomputed from what is on screen, not from the parse, so the mismatch
   * clears the moment the payer fixes the line that caused it.
   */
  const check = useMemo(() => {
    let sum = 0;
    let unreadable = 0;
    for (const row of rows) {
      const sen = senOrNull(row.price);
      if (sen === null) unreadable += 1;
      else sum += sen;
    }
    return {
      itemsSumSen: sum,
      unreadable,
      deltaSen: sum - receipt.subtotal_sen,
      matches: unreadable === 0 && sum === receipt.subtotal_sen,
    };
  }, [rows, receipt.subtotal_sen]);

  const printedTotalDelta =
    receipt.subtotal_sen + receipt.service_charge_sen + receipt.service_tax_sen - receipt.total_sen;

  const confidenceNote = CONFIDENCE_NOTE[receipt.confidence];

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <main className="mx-auto max-w-md px-5 pt-4 pb-28">
      <BackLink href={`/bills/${billId}`}>Back to the bill</BackLink>

      <h1 className="type-title mt-2">Check the receipt</h1>
      <p className="type-subhead mt-2" style={{ color: 'var(--text-muted)' }}>
        Nothing is shared until you say so. Fix anything that was read wrong.
      </p>

      <div className="mt-4 space-y-2">
        {confidenceNote ? <Banner tone="warn">{confidenceNote}</Banner> : null}

        {!check.matches ? (
          <Banner tone="warn">
            {check.unreadable > 0 ? (
              <>
                {check.unreadable} {check.unreadable === 1 ? 'price is' : 'prices are'} not a number
                yet.
              </>
            ) : (
              <>
                These items add up to <Money sen={check.itemsSumSen} />, but the receipt says{' '}
                <Money sen={receipt.subtotal_sen} /> — a difference of{' '}
                <Money sen={Math.abs(check.deltaSen)} />. Something was misread.
              </>
            )}
          </Banner>
        ) : (
          <Banner tone="good">
            Adds up to <Money sen={check.itemsSumSen} />, matching the receipt.
          </Banner>
        )}

        {printedTotalDelta !== 0 ? (
          <Banner tone="warn">
            The printed subtotal and charges come to{' '}
            <Money
              sen={receipt.subtotal_sen + receipt.service_charge_sen + receipt.service_tax_sen}
            />
            , but the receipt total says <Money sen={receipt.total_sen} />. Check the charge lines
            below.
          </Banner>
        ) : null}
      </div>

      <form action={action} className="mt-5">
        <input type="hidden" name="billId" value={billId} />
        <input type="hidden" name="receiptId" value={receiptId} />
        <input
          type="hidden"
          name="items"
          value={JSON.stringify(rows.map(({ name, price }) => ({ name, price })))}
        />

        <div>
          <label className="label" htmlFor="venue">
            Where
          </label>
          <input
            id="venue"
            name="venue"
            className="field"
            placeholder="Village Park"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
          />
        </div>

        <h2 className="group-label mt-6">Items</h2>
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.key} className="card flex items-center gap-2 p-2">
              <input
                className="field min-w-0 flex-1"
                aria-label="Item name"
                value={row.name}
                onChange={(e) => update(row.key, { name: e.target.value })}
              />
              <input
                className="field w-24 shrink-0 text-right"
                aria-label="Price in ringgit"
                inputMode="decimal"
                value={row.price}
                onChange={(e) => update(row.key, { price: e.target.value })}
                style={
                  senOrNull(row.price) === null
                    ? { borderColor: 'var(--accent)', borderWidth: 2 }
                    : undefined
                }
              />
              <button
                type="button"
                data-press="button"
                className="btn btn-ghost tap shrink-0 px-2"
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              >
                <span className="sr-only">Remove {row.name || 'this item'}</span>
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          data-press="button"
          className="btn btn-secondary mt-2 w-full"
          onClick={() =>
            setRows((current) => [
              ...current,
              { key: `added-${Date.now()}`, name: '', price: '' },
            ])
          }
        >
          Add a missing item
        </button>

        <h2 className="group-label mt-6">Charges</h2>
        <p className="type-footnote mb-2.5" style={{ color: 'var(--text-muted)' }}>
          Worked out from what the receipt charged, not assumed.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="serviceChargePercent">
              Service charge
            </label>
            <div className="relative">
              <input
                id="serviceChargePercent"
                name="serviceChargePercent"
                className="field pr-8"
                inputMode="decimal"
                value={chargePercent}
                onChange={(e) => setChargePercent(e.target.value)}
              />
              <span
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }}
              >
                %
              </span>
            </div>
            <p className="type-caption mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Printed: <Money sen={receipt.service_charge_sen} />
            </p>
          </div>
          <div>
            <label className="label" htmlFor="serviceTaxPercent">
              Service tax
            </label>
            <div className="relative">
              <input
                id="serviceTaxPercent"
                name="serviceTaxPercent"
                className="field pr-8"
                inputMode="decimal"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
              />
              <span
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }}
              >
                %
              </span>
            </div>
            <p className="type-caption mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Printed: <Money sen={receipt.service_tax_sen} />
            </p>
          </div>
        </div>

        {state && !state.ok ? (
          <p className="type-subhead mt-4" style={{ color: 'var(--accent-strong)' }} role="alert">
            {state.error}
          </p>
        ) : null}

        <div className="mt-7 space-y-2">
          <SubmitButton className="btn btn-primary w-full" pendingLabel="Saving…">
            Use these items
          </SubmitButton>
          <Link href={`/bills/${billId}`} data-press="button" className="btn btn-ghost w-full">
            Discard and type it in myself
          </Link>
        </div>
      </form>
    </main>
  );
}
