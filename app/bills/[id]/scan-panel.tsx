'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { UsageMeter } from '@/components/ui';
import { LIMIT_MESSAGES, RECEIPT_SCANS_PER_BILL } from '@/lib/limits';
import { ImageDecodeError, downscaleToJpeg } from '@/lib/ocr/downscale';
import { createClient } from '@/lib/supabase/client';

type Stage = 'idle' | 'preparing' | 'uploading' | 'scanning';

const STAGE_LABEL: Record<Exclude<Stage, 'idle'>, string> = {
  preparing: 'Preparing the photo…',
  uploading: 'Uploading…',
  scanning: 'Reading the receipt…',
};

export function ScanPanel({
  billId,
  userId,
  scansUsed,
}: {
  billId: string;
  userId: string;
  scansUsed: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    try {
      setStage('preparing');
      const jpeg = await downscaleToJpeg(file);

      setStage('uploading');
      const supabase = createClient();
      const path = `${userId}/${billId}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(path, jpeg, { contentType: 'image/jpeg' });
      if (uploadError) throw new Error(uploadError.message);

      setStage('scanning');
      const response = await fetch(`/api/bills/${billId}/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storagePath: path }),
      });
      const result = (await response.json()) as
        | { ok: true; receiptId: string }
        | { ok: false; message: string };

      if (!result.ok) {
        setStage('idle');
        setError(result.message);
        return;
      }
      // Parsed items never land straight in the bill; they go to a review screen.
      router.push(`/bills/${billId}/review/${result.receiptId}`);
    } catch (caught) {
      setStage('idle');
      setError(
        caught instanceof ImageDecodeError
          ? 'That file could not be read as an image. Take a photo instead.'
          : 'The upload did not go through. Check your connection, or enter the items by hand.',
      );
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const busy = stage !== 'idle';
  const exhausted = scansUsed >= RECEIPT_SCANS_PER_BILL;

  return (
    <section className="card p-4">
      <h2 className="text-[15px] font-semibold">Scan the receipt</h2>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Photograph it and we will read the items off. You get to check them before anything is
        shared.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        // Opens the camera directly on a phone rather than the photo library.
        capture="environment"
        className="sr-only"
        id="receipt-photo"
        disabled={busy || exhausted}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
      <label
        htmlFor="receipt-photo"
        className="btn btn-secondary mt-3 w-full"
        aria-disabled={busy || exhausted}
        style={busy || exhausted ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
      >
        {busy ? STAGE_LABEL[stage] : 'Take a photo'}
      </label>

      <UsageMeter
        used={scansUsed}
        limit={RECEIPT_SCANS_PER_BILL}
        noun="scan"
        exhaustedNote={LIMIT_MESSAGES.receipt}
      />

      {error ? (
        <p className="mt-3 text-[14px]" style={{ color: 'var(--accent-strong)' }} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
