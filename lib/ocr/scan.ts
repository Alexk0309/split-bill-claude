/**
 * Reading a restaurant receipt. Server only.
 */

import {
  isSupportedMediaType,
  visionJson,
  VISION_MODEL,
  type SupportedMediaType,
  type VisionFailureKind,
} from '@/lib/ai/vision';

import { failureMessage, parseReceiptJson } from './parse';
import { RECEIPT_SYSTEM_PROMPT, RECEIPT_USER_PROMPT } from './prompt';
import { RECEIPT_JSON_SCHEMA, type ParsedReceipt } from './schema';

export { isSupportedMediaType };
/** Kept for callers that report which model read the receipt. */
export const RECEIPT_MODEL = VISION_MODEL;

export type ScanFailureKind = VisionFailureKind;

export type ScanOutcome =
  | { ok: true; receipt: ParsedReceipt }
  | { ok: false; kind: ScanFailureKind; message: string };

export async function scanReceipt(
  imageBase64: string,
  mediaType: SupportedMediaType,
): Promise<ScanOutcome> {
  const outcome = await visionJson({
    imageBase64,
    mediaType,
    system: RECEIPT_SYSTEM_PROMPT,
    user: RECEIPT_USER_PROMPT,
    schema: RECEIPT_JSON_SCHEMA,
    fallbackHint: 'Enter the items by hand.',
  });

  if (!outcome.ok) return { ok: false, kind: outcome.kind, message: outcome.message };

  const parsed = parseReceiptJson(outcome.text);
  if (!parsed.ok) return { ok: false, kind: 'unreadable', message: failureMessage(parsed.reason) };

  return { ok: true, receipt: parsed.receipt };
}
