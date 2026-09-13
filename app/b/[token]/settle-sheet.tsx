'use client';

import { useRef, useState } from 'react';

import { Banner, Money } from '@/components/ui';
import { formatSen } from '@/lib/money';
import { needsAttention, settlementDrift } from '@/lib/settlement/drift';
import { LIMIT_MESSAGES, PROOF_SCANS_PER_BILL } from '@/lib/limits';
import { ImageDecodeError, downscaleToJpeg } from '@/lib/ocr/downscale';
import type { PayeeInfo } from '@/lib/supabase/types';

/** Copies a value and says so, without moving anything on the screen. */
function CopyRow({
  label,
  value,
  display,
}: {
  label: string;
  value: string;
  display?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Some in-app browsers block the clipboard. The value is selectable.
    }
  }

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3.5 py-3"
      style={{ background: 'var(--surface-sunk)' }}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
        <span className="tabular block text-[19px] font-semibold select-all">
          {display ?? value}
        </span>
      </span>
      <button type="button" onClick={copy} className="btn btn-secondary tap min-h-0 px-3 py-2 text-[14px]">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'working'; label: string }
  | { kind: 'done'; matched: boolean; message: string };

export function SettleSheet({
  shareToken,
  claimToken,
  amountSen,
  payee,
  settledAt,
  settledMethod,
  settledAmountSen,
  proofScansUsed,
  onClose,
  onSettled,
}: {
  shareToken: string;
  claimToken: string;
  amountSen: number;
  payee: PayeeInfo | null;
  settledAt: string | null;
  settledMethod: string | null;
  /** What they actually paid, so a share that has moved since can be spotted. */
  settledAmountSen: number | null;
  proofScansUsed: number;
  onClose: () => void;
  onSettled: () => void;
}) {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    try {
      setState({ kind: 'working', label: 'Preparing…' });
      const jpeg = await downscaleToJpeg(file);
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(jpeg);
      });

      setState({ kind: 'working', label: 'Checking your transfer…' });
      const response = await fetch(`/api/b/${shareToken}/proof`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimToken, imageBase64, mediaType: 'image/jpeg' }),
      });
      const result = (await response.json()) as
        | { ok: true; matched: boolean; message: string }
        | { ok: false; message: string };

      if (!result.ok) {
        setState({ kind: 'done', matched: false, message: result.message });
        return;
      }
      setState({ kind: 'done', matched: result.matched, message: result.message });
      if (result.matched) onSettled();
    } catch (caught) {
      setState({
        kind: 'done',
        matched: false,
        message:
          caught instanceof ImageDecodeError
            ? 'That file could not be read as an image. Try the screenshot from your banking app.'
            : 'That did not go through. Check your connection and try again.',
      });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const settled = settledAt !== null;
  const busy = state.kind === 'working';

  // Their share is divided by however many people have claimed each item so
  // far, so it can move after they have paid -- most often downwards, when the
  // rest of the table finally taps the dish they shared. Telling somebody
  // "nothing more to do" while they are fifty ringgit up is the one thing this
  // screen must not do.
  const drift = settlementDrift(settledAmountSen, amountSen);
  const drifted = needsAttention(drift);
  const checksGone = proofScansUsed >= PROOF_SCANS_PER_BILL;

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: 'rgb(0 0 0 / 0.4)' }}
      />
      <div
        className="relative max-h-[88dvh] overflow-y-auto rounded-t-2xl px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        style={{ background: 'var(--surface)' }}
        role="dialog"
        aria-label="Settle up"
      >
        <h2 className="text-lg font-bold">Settle up</h2>

        {settled ? (
          <div className="mt-4 space-y-3">
            {drifted ? (
              <>
                <Banner tone="warn">
                  {drift.kind === 'overpaid' ? (
                    <>
                      You paid <Money sen={settledAmountSen ?? 0} />, and your share has since
                      fallen to <Money sen={amountSen} /> because more people claimed what you
                      shared. <strong><Money sen={drift.deltaSen} /> is owed back to you.</strong>
                    </>
                  ) : (
                    <>
                      You paid <Money sen={settledAmountSen ?? 0} />, and your share has since
                      risen to <Money sen={amountSen} />.{' '}
                      <strong><Money sen={-drift.deltaSen} /> is still to go.</strong>
                    </>
                  )}
                </Banner>
                <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
                  {payee?.display_name ?? 'The person who paid'} can see this too — sort it out
                  with them directly. Nothing here moves money.
                </p>
              </>
            ) : (
              <Banner tone="good">
                Marked as paid{settledMethod === 'cash' ? ' in cash' : ''}. Nothing more to do.
              </Banner>
            )}
          </div>
        ) : (
          <>
            <p className="mt-1 text-[14px]" style={{ color: 'var(--text-muted)' }}>
              Pay {payee?.display_name ?? 'the person who paid'} directly. The money goes
              bank-to-bank; this app never touches it.
            </p>

            <div className="mt-4 space-y-2">
              <CopyRow
                label="You owe"
                value={formatSen(amountSen, { grouped: false })}
                display={<Money sen={amountSen} />}
              />
              {payee?.duitnow_mobile ? (
                <CopyRow label="DuitNow to this number" value={payee.duitnow_mobile} />
              ) : null}
            </div>

            {payee?.duitnow_mobile ? (
              <ol
                className="mt-4 space-y-1 pl-5 text-[14px]"
                style={{ color: 'var(--text-muted)', listStyle: 'decimal' }}
              >
                <li>Open your banking app</li>
                <li>Choose DuitNow, then transfer to a mobile number</li>
                <li>Paste the number and the amount</li>
              </ol>
            ) : (
              <div className="mt-4">
                <Banner tone="info">
                  {payee?.display_name ?? 'The payer'} has not added a DuitNow number yet. Ask them
                  how they would like to be paid.
                </Banner>
              </div>
            )}

            {payee?.qr_url ? (
              <div className="mt-4">
                <p className="label">Or scan their DuitNow QR</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={payee.qr_url}
                  alt={`DuitNow QR code for ${payee.display_name ?? 'the payer'}`}
                  className="mx-auto w-48 rounded-xl"
                  style={{ background: '#fff' }}
                />
              </div>
            ) : null}

            <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
              <p className="label">Already paid?</p>
              <p className="mb-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                Send the confirmation screenshot and we will check it against what you owe.
              </p>

              {checksGone ? (
                <Banner tone="info">{LIMIT_MESSAGES.proof}</Banner>
              ) : (
                <>
                  <input
                    ref={inputRef}
                    id="proof-file"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void onFile(file);
                    }}
                  />
                  <label
                    htmlFor="proof-file"
                    className="btn btn-primary w-full"
                    style={busy ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                  >
                    {busy ? state.label : 'Upload transfer proof'}
                  </label>
                </>
              )}

              {state.kind === 'done' ? (
                <div className="mt-3">
                  <Banner tone={state.matched ? 'good' : 'warn'}>{state.message}</Banner>
                </div>
              ) : null}
            </div>
          </>
        )}

        <button type="button" onClick={onClose} className="btn btn-secondary mt-5 w-full">
          Close
        </button>
      </div>
    </div>
  );
}
