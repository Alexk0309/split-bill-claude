'use client';

import { useState } from 'react';

import { formatRM } from '@/lib/money';

/**
 * WhatsApp is the distribution channel for this product, so sharing is one tap.
 * `wa.me` with no phone number opens the contact picker, which is what you want
 * when the bill goes to a group.
 */
function whatsappHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function SharePanel({
  shareUrl,
  title,
  venue,
  totalSen,
}: {
  shareUrl: string;
  title: string;
  venue: string | null;
  totalSen: number;
}) {
  const [copied, setCopied] = useState(false);

  const what = title || (venue ? `the bill at ${venue}` : 'the bill');
  const message =
    `Hi! Here's ${what}${venue && title ? ` at ${venue}` : ''} — ` +
    `${formatRM(totalSen)} altogether.\n\n` +
    `Tap what you had and it'll work out your share:\n${shareUrl}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked in some in-app browsers; the field below is
      // selectable so the link can still be copied by hand.
      setCopied(false);
    }
  }

  return (
    <section className="card p-4">
      <h2 className="text-[15px] font-semibold">Share with the table</h2>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Anyone with this link can claim their items. No app, no sign-up.
      </p>

      <div
        className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5"
        style={{ background: 'var(--surface-sunk)' }}
      >
        <input
          readOnly
          value={shareUrl}
          aria-label="Share link"
          onFocus={(e) => e.currentTarget.select()}
          className="tabular min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          style={{ color: 'var(--text-muted)' }}
        />
        <button type="button" onClick={copy} className="btn btn-secondary tap min-h-0 px-3 py-1.5 text-[14px]">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <a
        href={whatsappHref(message)}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-primary mt-3 w-full"
      >
        Share to WhatsApp
      </a>
    </section>
  );
}
