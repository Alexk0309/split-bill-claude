/**
 * Default rates. These are *defaults for a new bill*, never constants inside the
 * engine — the payer can override them per bill, and Phase 3 back-derives them
 * from the printed receipt when the restaurant charges something unusual.
 *
 * Service charge: not a tax. It is the restaurant's own charge, kept by the
 * restaurant, and it is optional — many places charge 0%. 10% is the common
 * figure in Malaysian full-service restaurants; mamak and kopitiam are usually 0%.
 *
 * Service tax: a government tax under the Service Tax Act 2018, administered by
 * the Royal Malaysian Customs Department. Food & beverage service is a taxable
 * service once the provider crosses the registration threshold. The rate and the
 * scope of taxable services have moved with recent budgets (most recently the
 * SST expansion effective 1 July 2025), so treat this as a default to be checked,
 * not as ground truth.
 *
 * Source to verify against before shipping a rate change:
 *   https://mysst.customs.gov.my/
 *
 * Note the ordering the engine uses: service tax is levied on
 * (subtotal + service charge), not on the subtotal alone.
 */
export const DEFAULT_SERVICE_CHARGE_RATE = 0.1;
export const DEFAULT_SERVICE_TAX_RATE = 0.06;

/** Sen rounding for a bill settled by transfer. Cash settlement can use 'nearest5sen'. */
export const DEFAULT_ROUNDING_MODE = 'sen' as const;

export const DEFAULT_CURRENCY = 'MYR' as const;
