'use client';

import { useActionState, useEffect, useRef } from 'react';

import { SubmitButton } from '@/components/pending';
import { Avatar, Money } from '@/components/ui';
import { formatRateAsPercent } from '@/lib/bill/rates';
import type { BillItemRow, BillRow, ParticipantRow } from '@/lib/supabase/types';

import {
  addItem,
  addMeToBill,
  addParticipant,
  deleteItem,
  deleteParticipant,
  setItemPortions,
  toggleMyClaim,
  updateBillDetails,
  type ActionResult,
} from '../actions';

function ErrorText({ state }: { state: ActionResult | undefined }) {
  if (!state || state.ok) return null;
  return (
    <p className="mt-2 text-[14px]" style={{ color: 'var(--accent-strong)' }} role="alert">
      {state.error}
    </p>
  );
}

/* -------------------------------------------------------------------------- */

export function BillSettingsForm({ bill }: { bill: BillRow }) {
  const [state, action] = useActionState<ActionResult | undefined, FormData>(
    updateBillDetails,
    undefined,
  );

  return (
    <form action={action} className="card space-y-3 p-4">
      <input type="hidden" name="billId" value={bill.id} />

      <div>
        <label className="label" htmlFor="venue">
          Where
        </label>
        <input
          id="venue"
          name="venue"
          className="field"
          placeholder="Village Park"
          defaultValue={bill.venue ?? ''}
        />
      </div>

      <div>
        <label className="label" htmlFor="title">
          What for
        </label>
        <input
          id="title"
          name="title"
          className="field"
          placeholder="Sunday breakfast"
          defaultValue={bill.title}
        />
      </div>

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
              defaultValue={formatRateAsPercent(bill.service_charge_rate)}
            />
            <span
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            >
              %
            </span>
          </div>
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
              defaultValue={formatRateAsPercent(bill.service_tax_rate)}
            />
            <span
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            >
              %
            </span>
          </div>
        </div>
      </div>
      <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Copy these off the receipt. Tax is charged on the subtotal plus service charge. Mamak and
        kopitiam are usually 0% for both.
      </p>

      <div>
        <label className="label" htmlFor="roundingMode">
          Rounding
        </label>
        <select
          id="roundingMode"
          name="roundingMode"
          className="field"
          defaultValue={bill.rounding_mode}
        >
          <option value="sen">To the sen (bank transfer)</option>
          <option value="nearest5sen">Nearest 5 sen (cash)</option>
        </select>
      </div>

      <ErrorText state={state} />
      <SubmitButton className="btn btn-secondary w-full" pendingLabel="Saving…">
        Save details
      </SubmitButton>
      {state?.ok ? (
        <p className="text-center text-[14px]" style={{ color: 'var(--good)' }} role="status">
          Saved
        </p>
      ) : null}
    </form>
  );
}

/* -------------------------------------------------------------------------- */

/** What the dropdown offers. Ninety-nine is legal but nobody scrolls that far. */
const PORTION_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * One line of the bill, as the payer sees it.
 *
 * Two controls beyond the price, and both exist for the same reason. "Split"
 * pins how many ways the line divides, so somebody claiming a set for four is
 * charged a quarter from the first tap rather than a half that quietly halves
 * again later. "I had this" exists because the payer ate too and previously had
 * no way to say so -- with a pinned divisor their portion would otherwise sit
 * unallocated forever, since nobody else could take it.
 */
function ItemRow({
  billId,
  item,
  claimants,
  myParticipantId,
}: {
  billId: string;
  item: BillItemRow;
  claimants: ParticipantRow[];
  myParticipantId: string | null;
}) {
  const [portionsState, portionsAction] = useActionState<ActionResult | undefined, FormData>(
    setItemPortions,
    undefined,
  );
  const [claimState, claimAction] = useActionState<ActionResult | undefined, FormData>(
    toggleMyClaim,
    undefined,
  );
  const portionsForm = useRef<HTMLFormElement>(null);

  const taken = claimants.length;
  const portions = item.portions;
  const mine = myParticipantId !== null && claimants.some((p) => p.id === myParticipantId);
  const full = portions !== null && taken >= portions;

  // A value set outside this dropdown should still be selectable, rather than
  // silently snapping to something else the moment anything else is changed.
  const choices = portions !== null && !PORTION_CHOICES.includes(portions)
    ? [...PORTION_CHOICES, portions].sort((a, b) => a - b)
    : PORTION_CHOICES;

  return (
    <div className="card px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{item.name}</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            {taken === 0 ? (
              <span className="text-[13px]" style={{ color: 'var(--accent-strong)' }}>
                Unclaimed
              </span>
            ) : (
              <>
                {claimants.slice(0, 5).map((p) => (
                  <Avatar key={p.id} name={p.display_name} seed={p.id} size={20} />
                ))}
                {claimants.length > 5 ? (
                  <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                    +{claimants.length - 5}
                  </span>
                ) : null}
              </>
            )}
          </div>
        </div>
        <Money sen={item.price_sen} className="font-semibold" />
        <form action={deleteItem}>
          <input type="hidden" name="billId" value={billId} />
          <input type="hidden" name="itemId" value={item.id} />
          <SubmitButton className="btn btn-ghost tap px-2">
            <span className="sr-only">Remove {item.name}</span>
            <span aria-hidden="true">✕</span>
          </SubmitButton>
        </form>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <form ref={portionsForm} action={portionsAction} className="flex items-center gap-1.5">
          <input type="hidden" name="billId" value={billId} />
          <input type="hidden" name="itemId" value={item.id} />
          <label className="text-[13px]" style={{ color: 'var(--text-muted)' }} htmlFor={`portions-${item.id}`}>
            Split
          </label>
          <select
            id={`portions-${item.id}`}
            name="portions"
            className="field min-h-0 w-auto py-1.5 text-[14px]"
            defaultValue={portions === null ? 'auto' : String(portions)}
            onChange={() => portionsForm.current?.requestSubmit()}
          >
            <option value="auto">between whoever claims</option>
            {choices.map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'way' : 'ways'}
              </option>
            ))}
          </select>
        </form>

        {myParticipantId ? (
          <form action={claimAction}>
            <input type="hidden" name="billId" value={billId} />
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="claimed" value={mine ? 'true' : 'false'} />
            <SubmitButton
              className="btn btn-ghost tap min-h-0 px-2 py-1.5 text-[14px]"
              pendingLabel="…"
            >
              {mine ? '✓ I had this' : 'I had this'}
            </SubmitButton>
          </form>
        ) : null}
      </div>

      {portions !== null ? (
        <p className="mt-1 text-[13px]" style={{ color: full ? 'var(--text-muted)' : 'var(--accent-strong)' }}>
          {taken} of {portions} taken
          {taken < portions ? ' — the rest is nobody\u2019s yet' : ''}
        </p>
      ) : null}

      <ErrorText state={portionsState} />
      <ErrorText state={claimState} />
    </div>
  );
}

export function ItemsEditor({
  billId,
  items,
  claimantsByItem,
  myParticipantId,
}: {
  billId: string;
  items: BillItemRow[];
  claimantsByItem: Map<string, ParticipantRow[]>;
  myParticipantId: string | null;
}) {
  const [state, action] = useActionState<ActionResult | undefined, FormData>(addItem, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Clear and refocus after a successful add, so a long receipt can be typed in
  // without touching the screen between lines.
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      nameRef.current?.focus();
    }
  }, [state]);

  return (
    <section>
      <h2 className="mb-2 text-[15px] font-semibold">Items</h2>

      {myParticipantId === null ? (
        <form action={addMeToBill} className="mb-2">
          <input type="hidden" name="billId" value={billId} />
          <SubmitButton className="btn btn-secondary w-full text-[14px]" pendingLabel="Adding you…">
            Add me to this bill
          </SubmitButton>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            So you can claim what you had. You are not on the bill until you do.
          </p>
        </form>
      ) : null}

      <div className="space-y-2">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            billId={billId}
            item={item}
            claimants={claimantsByItem.get(item.id) ?? []}
            myParticipantId={myParticipantId}
          />
        ))}
      </div>

      <form ref={formRef} action={action} className="card mt-2 p-3">
        <input type="hidden" name="billId" value={billId} />
        <div className="flex gap-2">
          <input
            ref={nameRef}
            name="name"
            className="field flex-1"
            placeholder="Nasi lemak ayam"
            aria-label="Item name"
            required
          />
          <input
            name="price"
            className="field w-28"
            inputMode="decimal"
            placeholder="18.00"
            aria-label="Price in ringgit"
            required
          />
        </div>
        <ErrorText state={state} />
        <SubmitButton className="btn btn-secondary mt-2 w-full" pendingLabel="Adding…">
          Add item
        </SubmitButton>
      </form>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export function PeopleEditor({
  billId,
  participants,
}: {
  billId: string;
  participants: ParticipantRow[];
}) {
  const [state, action] = useActionState<ActionResult | undefined, FormData>(
    addParticipant,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      nameRef.current?.focus();
    }
  }, [state]);

  return (
    <section>
      <h2 className="mb-2 text-[15px] font-semibold">Who was there</h2>
      <p className="mb-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Names only. Nobody needs an account, and anyone you miss can add themselves from the link.
      </p>

      {participants.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2">
          {participants.map((p) => (
            <li
              key={p.id}
              className="card flex items-center gap-2 py-1.5 pr-1.5 pl-2.5"
            >
              <Avatar name={p.display_name} seed={p.id} size={22} />
              <span className="text-[15px]">{p.display_name}</span>
              <form action={deleteParticipant}>
                <input type="hidden" name="billId" value={billId} />
                <input type="hidden" name="participantId" value={p.id} />
                <SubmitButton className="btn btn-ghost tap min-h-0 px-1.5 py-1">
                  <span className="sr-only">Remove {p.display_name}</span>
                  <span aria-hidden="true">✕</span>
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      ) : null}

      <form ref={formRef} action={action} className="flex gap-2">
        <input type="hidden" name="billId" value={billId} />
        <input
          ref={nameRef}
          name="name"
          className="field flex-1"
          placeholder="Aina"
          aria-label="Person's name"
          maxLength={60}
          required
        />
        <SubmitButton className="btn btn-secondary shrink-0" pendingLabel="…">
          Add
        </SubmitButton>
      </form>
      <ErrorText state={state} />
    </section>
  );
}
