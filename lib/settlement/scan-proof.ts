/**
 * Reading a transfer confirmation. Server only.
 *
 * The figures come back from here and nowhere else. A guest never sends an
 * amount; they send an image, and the server reads it. That is what makes a
 * matched proof worth acting on.
 */

import { visionJson, type SupportedMediaType, type VisionFailureKind } from '@/lib/ai/vision';

import {
  PROOF_JSON_SCHEMA,
  PROOF_SYSTEM_PROMPT,
  PROOF_USER_PROMPT,
  type ParsedProof,
  type ProofConfidence,
} from './proof';

export type ScanProofOutcome =
  | { ok: true; proof: ParsedProof }
  | { ok: false; kind: VisionFailureKind; message: string };

const CONFIDENCES: ProofConfidence[] = ['high', 'medium', 'low'];

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * Validated rather than trusted. The schema should guarantee the shape, but
 * these values decide whether somebody is marked as having paid, so anything
 * unexpected collapses to "unreadable" rather than to a number.
 */
export function parseProofJson(raw: string): ParsedProof | null {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, ''));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const amount = record.amount_sen;
  const amountSen =
    typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0 ? amount : null;

  const paidAtRaw = asString(record.paid_at);
  const paidAt = paidAtRaw && !Number.isNaN(Date.parse(paidAtRaw)) ? paidAtRaw : null;

  return {
    amount_sen: amountSen,
    reference: asString(record.reference),
    paid_at: paidAt,
    recipient: asString(record.recipient),
    bank: asString(record.bank),
    // Anything other than an explicit true is treated as "not a transfer".
    looks_like_transfer: record.looks_like_transfer === true,
    confidence: CONFIDENCES.includes(record.confidence as ProofConfidence)
      ? (record.confidence as ProofConfidence)
      : 'low',
  };
}

export async function scanProof(
  imageBase64: string,
  mediaType: SupportedMediaType,
): Promise<ScanProofOutcome> {
  const outcome = await visionJson({
    imageBase64,
    mediaType,
    system: PROOF_SYSTEM_PROMPT,
    user: PROOF_USER_PROMPT,
    schema: PROOF_JSON_SCHEMA,
    fallbackHint: 'The payer can mark you as paid instead.',
  });

  if (!outcome.ok) return { ok: false, kind: outcome.kind, message: outcome.message };

  const proof = parseProofJson(outcome.text);
  if (!proof) {
    return {
      ok: false,
      kind: 'unreadable',
      message: 'That screenshot could not be read. The payer can mark you as paid instead.',
    };
  }
  return { ok: true, proof };
}
