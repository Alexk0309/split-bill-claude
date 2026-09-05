/**
 * The contract with the vision model.
 *
 * The shape is fixed by the spec. It is declared once here, as both a JSON
 * Schema handed to the API and a TypeScript type, so the two cannot drift.
 */

export type ReceiptConfidence = 'high' | 'medium' | 'low';

export interface ParsedReceiptItem {
  name: string;
  quantity: number;
  price_sen: number;
}

export interface ParsedReceipt {
  venue: string | null;
  items: ParsedReceiptItem[];
  subtotal_sen: number;
  service_charge_sen: number;
  service_tax_sen: number;
  total_sen: number;
  confidence: ReceiptConfidence;
}

/**
 * Passed to `output_config.format`, which constrains the response to valid JSON
 * matching this schema. That is what makes "strict JSON only, no prose, no
 * markdown fences" a property of the API call rather than a hope expressed in
 * the prompt.
 */
export const RECEIPT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    venue: {
      type: ['string', 'null'],
      description: 'Restaurant name as printed, or null if not legible.',
    },
    items: {
      type: 'array',
      description: 'One entry per printed line item, in the order they appear.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Item name as printed.' },
          quantity: {
            type: 'integer',
            description: 'Printed quantity. Use 1 when the receipt does not show one.',
          },
          price_sen: {
            type: 'integer',
            description:
              'Line total in sen (RM1.00 = 100), for the whole quantity, not the unit price.',
          },
        },
        required: ['name', 'quantity', 'price_sen'],
        additionalProperties: false,
      },
    },
    subtotal_sen: { type: 'integer', description: 'Subtotal in sen before charges.' },
    service_charge_sen: { type: 'integer', description: 'Service charge in sen. 0 if none.' },
    service_tax_sen: { type: 'integer', description: 'Service tax / SST in sen. 0 if none.' },
    total_sen: { type: 'integer', description: 'Final total in sen as printed.' },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description:
        'high: every figure clearly legible. medium: some inference needed. low: the image is poor, or may not be a receipt.',
    },
  },
  required: [
    'venue',
    'items',
    'subtotal_sen',
    'service_charge_sen',
    'service_tax_sen',
    'total_sen',
    'confidence',
  ],
  additionalProperties: false,
} as const;
