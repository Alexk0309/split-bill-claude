/**
 * The vision call. Server only -- the API key must never reach a browser.
 */

import Anthropic from '@anthropic-ai/sdk';

import { failureMessage, parseReceiptJson } from './parse';
import { RECEIPT_SYSTEM_PROMPT, RECEIPT_USER_PROMPT } from './prompt';
import { RECEIPT_JSON_SCHEMA, type ParsedReceipt } from './schema';

/**
 * The model used for receipt OCR.
 *
 * SPEC.md names claude-sonnet-4-6, so that is the default. claude-sonnet-5 is
 * both newer and cheaper ($2/$10 per MTok against $3/$15), so it is worth
 * moving to -- set ANTHROPIC_MODEL to switch without touching code.
 */
export const RECEIPT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

/** What the Messages API accepts. HEIC is not on the list; the client sends JPEG. */
const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export function isSupportedMediaType(value: string): value is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(value);
}

export type ScanFailureKind = 'config' | 'api' | 'unreadable';

export type ScanOutcome =
  | { ok: true; receipt: ParsedReceipt }
  | { ok: false; kind: ScanFailureKind; message: string };

const failure = (kind: ScanFailureKind, message: string): ScanOutcome => ({
  ok: false,
  kind,
  message,
});

export async function scanReceipt(
  imageBase64: string,
  mediaType: SupportedMediaType,
): Promise<ScanOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return failure(
      'config',
      'Receipt scanning is not configured on this server. Enter the items by hand for now.',
    );
  }

  const client = new Anthropic();

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: RECEIPT_MODEL,
      max_tokens: 16000,
      system: RECEIPT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            { type: 'text', text: RECEIPT_USER_PROMPT },
          ],
        },
      ],
      // Constrains the response to the schema, which is what makes "strict JSON
      // only, no prose, no markdown fences" a property of the request rather
      // than something the prompt has to ask for and hope.
      output_config: {
        format: { type: 'json_schema', schema: RECEIPT_JSON_SCHEMA },
      },
    });
  } catch (error) {
    // Most specific first. Every branch ends at manual entry, because a payer
    // standing at a cashier needs a way forward, not a diagnosis.
    if (error instanceof Anthropic.AuthenticationError) {
      return failure('config', 'Receipt scanning is not set up correctly. Enter the items by hand.');
    }
    if (error instanceof Anthropic.RateLimitError) {
      return failure('api', 'Too many scans right now. Try again shortly, or enter the items by hand.');
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return failure('api', 'Could not reach the scanning service. Check your connection, or enter the items by hand.');
    }
    if (error instanceof Anthropic.APIError) {
      return failure('api', 'The scan failed. Try another photo, or enter the items by hand.');
    }
    return failure('api', 'Something went wrong scanning that photo. Enter the items by hand.');
  }

  if (response.stop_reason === 'refusal') {
    return failure('unreadable', 'That image could not be processed. Try a photo of the receipt itself.');
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (text.trim() === '') {
    return failure('unreadable', failureMessage('not-json'));
  }

  const parsed = parseReceiptJson(text);
  if (!parsed.ok) {
    return failure('unreadable', failureMessage(parsed.reason));
  }

  return { ok: true, receipt: parsed.receipt };
}
