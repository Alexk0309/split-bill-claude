/**
 * One place where an image becomes structured JSON. Server only -- the API key
 * must never reach a browser.
 *
 * Both things this app reads from a photograph (a restaurant receipt, a
 * transfer confirmation) want the same treatment: a schema the response is
 * constrained to, and failure messages that end at something the person can
 * actually do. Sharing the call keeps those consistent.
 */

import Anthropic from '@anthropic-ai/sdk';

/**
 * SPEC.md names claude-sonnet-4-6, so that is the default. claude-sonnet-5 is
 * newer and cheaper ($2/$10 per MTok against $3/$15) -- set ANTHROPIC_MODEL to
 * switch without touching code.
 */
export const VISION_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export function isSupportedMediaType(value: string): value is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(value);
}

export type VisionFailureKind = 'config' | 'api' | 'unreadable';

export type VisionOutcome =
  | { ok: true; text: string }
  | { ok: false; kind: VisionFailureKind; message: string };

export interface VisionRequest {
  imageBase64: string;
  mediaType: SupportedMediaType;
  system: string;
  user: string;
  schema: unknown;
  /** Named in the fallback messages, e.g. "the items" or "the amount". */
  fallbackHint: string;
}

export async function visionJson({
  imageBase64,
  mediaType,
  system,
  user,
  schema,
  fallbackHint,
}: VisionRequest): Promise<VisionOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      kind: 'config',
      message: `Reading images is not configured on this server. ${fallbackHint}`,
    };
  }

  const client = new Anthropic();

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 16000,
      system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: user },
          ],
        },
      ],
      // Constrains the response to the schema, so "strict JSON only, no prose,
      // no markdown fences" is a property of the request rather than something
      // the prompt asks for and hopes for.
      output_config: { format: { type: 'json_schema', schema: schema as Record<string, unknown> } },
    });
  } catch (error) {
    // Most specific first. Every branch ends somewhere the person can act,
    // because they are standing at a cashier, not reading a stack trace.
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, kind: 'config', message: `Reading images is not set up correctly. ${fallbackHint}` };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, kind: 'api', message: `Too busy right now. Try again shortly. ${fallbackHint}` };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return { ok: false, kind: 'api', message: `Could not reach the service. Check your connection. ${fallbackHint}` };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, kind: 'api', message: `That did not work. Try another photo. ${fallbackHint}` };
    }
    return { ok: false, kind: 'api', message: `Something went wrong. ${fallbackHint}` };
  }

  if (response.stop_reason === 'refusal') {
    return {
      ok: false,
      kind: 'unreadable',
      message: `That image could not be processed. ${fallbackHint}`,
    };
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (text.trim() === '') {
    return { ok: false, kind: 'unreadable', message: `Nothing could be read from that image. ${fallbackHint}` };
  }

  return { ok: true, text };
}
