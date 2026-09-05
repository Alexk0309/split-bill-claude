/**
 * Reading a transfer confirmation, and deciding whether it settles a debt.
 *
 * The decision is pure and lives here, apart from the vision call and the
 * database, because it is the single place where "somebody says they paid"
 * becomes "the app says they paid". A false settle is the worst bug this
 * product can have, so the rules are written out and tested one at a time
 * rather than being an `if` buried in a route handler.
 */

export type ProofConfidence = 'high' | 'medium' | 'low';

export interface ParsedProof {
  amount_sen: number | null;
  reference: string | null;
  /** ISO 8601, as printed on the confirmation. */
  paid_at: string | null;
  recipient: string | null;
  bank: string | null;
  looks_like_transfer: boolean;
  confidence: ProofConfidence;
}

/** The JSON Schema handed to the vision call, so the response cannot be prose. */
export const PROOF_JSON_SCHEMA = {
  type: 'object',
  properties: {
    amount_sen: {
      type: ['integer', 'null'],
      description: 'Amount transferred, in sen (RM1.00 = 100). Null if not legible.',
    },
    reference: {
      type: ['string', 'null'],
      description: 'Reference or transaction number, as printed.',
    },
    paid_at: {
      type: ['string', 'null'],
      description: 'When the transfer was made, ISO 8601. Null if not legible.',
    },
    recipient: {
      type: ['string', 'null'],
      description:
        'Who was paid, as printed: a name, a mobile number, or an account number.',
    },
    bank: { type: ['string', 'null'], description: 'Sending bank, if shown.' },
    looks_like_transfer: {
      type: 'boolean',
      description:
        'True only if this is a bank transfer confirmation. False for anything else, including a receipt, a screenshot of a chat, or an unrelated photo.',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: [
    'amount_sen',
    'reference',
    'paid_at',
    'recipient',
    'bank',
    'looks_like_transfer',
    'confidence',
  ],
  additionalProperties: false,
} as const;

export const PROOF_SYSTEM_PROMPT = `You read screenshots of Malaysian bank transfer confirmations.

Report only what is printed. Never infer an amount that is not shown, and never
fill in a reference number you cannot read.

- Amounts are integer sen. RM99.89 is 9989.
- "recipient" is whoever the money went to, exactly as printed: a name, a mobile
  number for a DuitNow transfer, or an account number.
- "reference" is the transaction or reference number the bank shows.
- Set looks_like_transfer to false for anything that is not a completed transfer
  confirmation, including restaurant receipts, chat screenshots, a transfer that
  failed or is still pending, and unrelated photos.
- Use confidence "low" if the image is unclear or you had to guess at the amount.

Being unsure is fine and useful. Guessing is not: a wrong amount here marks
somebody as having paid when they have not.`;

export const PROOF_USER_PROMPT =
  'Read this transfer confirmation. Amount in integer sen.';

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

export type MismatchReason =
  | 'not-a-transfer'
  | 'unreadable'
  | 'amount'
  | 'duplicate-reference'
  | 'wrong-recipient';

export interface ProofAssessment {
  matched: boolean;
  reason: MismatchReason | null;
  /** Shown to the guest. Never accuses; a mismatch goes to the payer to judge. */
  message: string;
}

/**
 * Malaysian mobile numbers are written every which way: `012-345 6789`,
 * `0123456789`, `+60123456789`, `60123456789`. Comparing the last nine digits
 * matches all of those without pretending to validate the number.
 */
export function normaliseMobile(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 9) return null;
  return digits.slice(-9);
}

export interface AssessProofInput {
  parsed: ParsedProof;
  expectedSen: number;
  /** Reference numbers already used on this bill, to catch one proof twice. */
  usedReferences?: readonly string[];
  /** The payer's DuitNow number, when they have set one. */
  payeeMobile?: string | null;
}

export function assessProof({
  parsed,
  expectedSen,
  usedReferences = [],
  payeeMobile = null,
}: AssessProofInput): ProofAssessment {
  if (!parsed.looks_like_transfer) {
    return {
      matched: false,
      reason: 'not-a-transfer',
      message: 'That does not look like a transfer confirmation. Try the screenshot from your banking app.',
    };
  }

  if (parsed.amount_sen === null || !Number.isSafeInteger(parsed.amount_sen) || parsed.confidence === 'low') {
    return {
      matched: false,
      reason: 'unreadable',
      message: 'The amount could not be read clearly. We have sent it to the payer to check.',
    };
  }

  // Before the amount check: a screenshot reused from another debt has the right
  // amount by construction, so checking the amount first would pass it.
  const reference = parsed.reference?.trim();
  if (reference) {
    const seen = new Set(usedReferences.map((r) => r.trim().toLowerCase()));
    if (seen.has(reference.toLowerCase())) {
      return {
        matched: false,
        reason: 'duplicate-reference',
        message: 'That transfer has already been submitted. We have sent it to the payer to check.',
      };
    }
  }

  // Only judged when both sides are actually known.
  const expectedMobile = normaliseMobile(payeeMobile);
  const actualMobile = normaliseMobile(parsed.recipient);
  if (expectedMobile && actualMobile && expectedMobile !== actualMobile) {
    return {
      matched: false,
      reason: 'wrong-recipient',
      message: 'That transfer went to a different number. We have sent it to the payer to check.',
    };
  }

  if (parsed.amount_sen !== expectedSen) {
    return {
      matched: false,
      reason: 'amount',
      message: 'The amount does not match what you owe. We have sent it to the payer to check.',
    };
  }

  return { matched: true, reason: null, message: 'Thanks — that matches. You are marked as paid.' };
}

/** How the payer sees a mismatch on their own screen. */
export function mismatchLabel(reason: MismatchReason): string {
  switch (reason) {
    case 'not-a-transfer':
      return 'Not a transfer confirmation';
    case 'unreadable':
      return 'Could not read the amount';
    case 'amount':
      return 'Amount does not match';
    case 'duplicate-reference':
      return 'Same reference as an earlier proof';
    case 'wrong-recipient':
      return 'Paid to a different number';
  }
}
