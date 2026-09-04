'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { Avatar, Money } from '@/components/ui';
import { formatRateAsPercent } from '@/lib/bill/rates';
import type { BillItemRow, BillRow, ParticipantRow } from '@/lib/supabase/types';

import {
  addItem,
  addParticipant,
  deleteItem,
  deleteParticipant,
  updateBillDetails,
  type ActionResult,
} from '../actions';

function SubmitButton({
  children,
  className = 'btn btn-primary',
  pendingLabel,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

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

export function ItemsEditor({
  billId,
  items,
  claimantsByItem,
}: {
  billId: string;
  items: BillItemRow[];
  claimantsByItem: Map<string, ParticipantRow[]>;
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

      <div className="space-y-2">
        {items.map((item) => {
          const claimants = claimantsByItem.get(item.id) ?? [];
          return (
            <div key={item.id} className="card flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.name}</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  {claimants.length === 0 ? (
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
          );
        })}
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
