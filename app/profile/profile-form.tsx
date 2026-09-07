'use client';

import { useActionState, useRef, useState } from 'react';

import { SubmitButton } from '@/components/pending';
import { ImageDecodeError, downscaleToJpeg } from '@/lib/ocr/downscale';
import { createClient } from '@/lib/supabase/client';

import { removeQr, saveProfile, type ActionResult } from '../settlement-actions';

export function ProfileForm({
  userId,
  displayName,
  duitnowMobile,
  qrUrl,
}: {
  userId: string;
  displayName: string;
  duitnowMobile: string;
  qrUrl: string | null;
}) {
  const [state, action] = useActionState<ActionResult | undefined, FormData>(saveProfile, undefined);
  const [qrPath, setQrPath] = useState('');
  const [preview, setPreview] = useState<string | null>(qrUrl);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const jpeg = await downscaleToJpeg(file);
      const supabase = createClient();
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage
        .from('duitnow-qr')
        .upload(path, jpeg, { contentType: 'image/jpeg' });
      if (error) throw new Error(error.message);

      setQrPath(path);
      setPreview(URL.createObjectURL(jpeg));
    } catch (caught) {
      setUploadError(
        caught instanceof ImageDecodeError
          ? 'That file could not be read as an image.'
          : 'The upload did not go through. Try again.',
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="duitnowQrPath" value={qrPath} />

      <div>
        <label className="label" htmlFor="displayName">
          Your name
        </label>
        <input
          id="displayName"
          name="displayName"
          className="field"
          placeholder="Aina"
          defaultValue={displayName}
        />
        <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Shown to guests as the person they are paying.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="duitnowMobile">
          DuitNow mobile number
        </label>
        <input
          id="duitnowMobile"
          name="duitnowMobile"
          className="field"
          inputMode="tel"
          autoComplete="tel"
          placeholder="012-345 6789"
          defaultValue={duitnowMobile}
        />
        <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          The number your bank account is registered to for DuitNow. Guests transfer straight to
          it — the money never passes through this app.
        </p>
      </div>

      <div>
        <span className="label">DuitNow QR</span>
        <p className="mb-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          We cannot generate this — it comes from your own banking app. Screenshot yours once and
          guests can scan it instead of typing your number.
        </p>

        {preview ? (
          <div className="card mb-2 flex items-center gap-3 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Your DuitNow QR code"
              className="h-20 w-20 rounded-lg object-cover"
              style={{ background: 'var(--surface-sunk)' }}
            />
            <span className="flex-1 text-[14px]" style={{ color: 'var(--text-muted)' }}>
              {qrPath ? 'Ready to save' : 'Saved'}
            </span>
            <button
              type="button"
              className="btn btn-ghost tap px-2 text-[14px]"
              onClick={() => {
                setPreview(null);
                setQrPath('');
                void removeQr();
              }}
            >
              Remove
            </button>
          </div>
        ) : null}

        <input
          ref={inputRef}
          id="qr-file"
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <label
          htmlFor="qr-file"
          className="btn btn-secondary w-full"
          style={uploading ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
        >
          {uploading ? 'Uploading…' : preview ? 'Replace the QR' : 'Upload a screenshot'}
        </label>
        {uploadError ? (
          <p className="mt-2 text-[14px]" style={{ color: 'var(--accent-strong)' }} role="alert">
            {uploadError}
          </p>
        ) : null}
      </div>

      {state && !state.ok ? (
        <p className="text-[14px]" style={{ color: 'var(--accent-strong)' }} role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="text-center text-[14px]" style={{ color: 'var(--good)' }} role="status">
          Saved
        </p>
      ) : null}

      <SubmitButton className="btn btn-primary w-full" pendingLabel="Saving…">
        Save
      </SubmitButton>
    </form>
  );
}
