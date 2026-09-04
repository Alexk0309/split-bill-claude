/** Integer sen. Never a float, never a fraction of a sen. */
export type Sen = number;

export interface Person {
  id: string;
  name: string;
}

export interface LineItem {
  id: string;
  name: string;
  /** Total price for this line, not unit price. */
  priceSen: Sen;
  /** Empty means unclaimed. Unclaimed items are never silently split. */
  claimantIds: string[];
}

export type AdjustmentScope = 'proportional' | { personIds: string[] };

export interface Adjustment {
  id: string;
  /** "Grab promo", "Member 10%" */
  label: string;
  /** Positive number, applied as a reduction. */
  amountSen: Sen;
  scope: AdjustmentScope;
}

export interface Belanja {
  /** Absorbs the beneficiary's share. */
  sponsorId: string;
  /** Absorbed; ends up owing nothing. */
  beneficiaryId: string;
}

/** 'nearest5sen' is for cash settlement only — it rounds the payable total too. */
export type RoundingMode = 'sen' | 'nearest5sen';

export interface BillInput {
  people: Person[];
  items: LineItem[];
  /** e.g. 0.10. An input, never hardcoded in the engine. */
  serviceChargeRate: number;
  /** e.g. 0.06. Levied on subtotal + service charge. */
  serviceTaxRate: number;
  adjustments: Adjustment[];
  belanja: Belanja[];
  roundingMode: RoundingMode;
}

export interface UnclaimedItem {
  id: string;
  name: string;
  priceSen: Sen;
}

/** One line of "here is where your money went", per item you claimed. */
export interface ItemShareLine {
  itemId: string;
  name: string;
  itemPriceSen: Sen;
  claimantCount: number;
  /** Rounded for display. The authoritative figure is `baseShareSen` on the person. */
  displayShareSen: Sen;
  /** Exact pre-rounding value, 6dp, e.g. "1066.666667". */
  exactShareSen: string;
}

export interface AdjustmentShareLine {
  adjustmentId: string;
  label: string;
  /** Signed and negative — adjustments reduce what you owe. Sums to `adjustmentShareSen`. */
  amountSen: Sen;
  scope: 'proportional' | 'person';
}

/**
 * Every sen is explainable. These six signed components sum *exactly* to
 * `finalShareSen`:
 *
 *   baseShareSen + serviceChargeShareSen + serviceTaxShareSen
 *     + adjustmentShareSen + clampRedistributionSen + cashRoundingShareSen
 *     === finalShareSen
 *
 * `roundingDeltaSen` is informational, not a seventh component: the rounding is
 * already baked into the six above.
 */
export interface PersonBreakdown {
  personId: string;
  name: string;

  baseShareSen: Sen;
  serviceChargeShareSen: Sen;
  serviceTaxShareSen: Sen;
  /** Zero or negative. */
  adjustmentShareSen: Sen;
  /**
   * Signed. Non-zero only when someone's adjustments exceeded their share: their
   * share clamps at zero and the unabsorbed remainder moves onto everyone else,
   * so the shares still sum to the bill total.
   */
  clampRedistributionSen: Sen;

  /**
   * Signed. Non-zero only in 'nearest5sen' mode: the sen added or removed to put
   * this person's share on the 5 sen grid a cash till uses.
   */
  cashRoundingShareSen: Sen;

  /** This person's own share after rounding, before belanja is applied. */
  finalShareSen: Sen;

  /**
   * Leftover sen handed to this person by the largest remainder pass: their
   * sen-exact share minus their exact share floored. Always 0 or 1, in both
   * rounding modes. Informational -- it is already reflected in the components
   * above, so do not add it to them.
   */
  roundingDeltaSen: Sen;
  /** Exact pre-rounding share, 6dp. Informational — explains `roundingDeltaSen`. */
  exactShareSen: string;

  /** Shares this person absorbed as a belanja sponsor. */
  belanjaAbsorbedSen: Sen;
  /** Set when someone else is covering this person; their share moved to that person. */
  belanjaCoveredBySponsorId: string | null;

  /** What this person actually pays: finalShareSen + belanjaAbsorbedSen, or 0 if covered. */
  amountDueSen: Sen;

  /** The person's share of everything they claimed, ratio-weighted. */
  ratioOfSubtotal: string;
  itemLines: ItemShareLine[];
  adjustmentLines: AdjustmentShareLine[];
}

export interface SplitResult {
  subtotalSen: Sen;
  serviceChargeSen: Sen;
  serviceTaxSen: Sen;
  totalAdjustmentsSen: Sen;
  /** subtotal + service charge + service tax - adjustments. */
  billTotalSen: Sen;

  /**
   * What is actually collected. Equal to `billTotalSen` in 'sen' mode; in
   * 'nearest5sen' mode the bill total is rounded to the nearest 5 sen first,
   * the way a cash till does it.
   */
  settlementTotalSen: Sen;
  /** settlementTotalSen - billTotalSen. Zero outside cash mode. */
  cashRoundingDeltaSen: Sen;

  /** Non-empty blocks settlement. The engine never splits these silently. */
  unclaimedItems: UnclaimedItem[];
  /**
   * The slice of `settlementTotalSen` attributable to unclaimed items, including
   * their share of charges and proportional adjustments. Zero once everything is
   * claimed. Invariant: sum(amountDueSen) + unallocatedSen === settlementTotalSen.
   */
  unallocatedSen: Sen;

  people: PersonBreakdown[];
  roundingMode: RoundingMode;
}
