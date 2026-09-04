export type SplitErrorCode =
  | 'DUPLICATE_PERSON_ID'
  | 'DUPLICATE_ITEM_ID'
  | 'DUPLICATE_ADJUSTMENT_ID'
  | 'UNKNOWN_PERSON_ID'
  | 'INVALID_SEN'
  | 'INVALID_RATE'
  | 'INVALID_SCOPE'
  | 'ADJUSTMENTS_EXCEED_TOTAL'
  | 'BELANJA_SELF'
  | 'BELANJA_DUPLICATE_BENEFICIARY'
  | 'BELANJA_CYCLE'
  | 'INVARIANT_VIOLATED';

/** Every rejection out of the engine carries a machine-readable code so the UI can localise it. */
export class SplitEngineError extends Error {
  readonly code: SplitErrorCode;

  constructor(code: SplitErrorCode, message: string) {
    super(message);
    this.name = 'SplitEngineError';
    this.code = code;
  }
}
