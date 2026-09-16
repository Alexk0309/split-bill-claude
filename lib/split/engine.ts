/**
 * The split calculation engine.
 *
 * Pure and dependency-free: no database, no React, no I/O, no clock, no
 * randomness. Same input, same output, forever. It is deliberately decoupled
 * from the "one person fronted the money" assumption -- it answers "what is each
 * person's share of this bill", which is equally the question a pay-before-you-eat
 * or POS-integrated flow asks.
 *
 * All money is integer sen. Intermediate shares are exact rationals (see
 * ./rational) and collapse to integers exactly once, in the largest remainder
 * pass, which is what guarantees the shares sum to the total with no sen leaked.
 */

import { SplitEngineError } from './errors';
import * as R from './rational';
import type { Rational } from './rational';
import type {
  Adjustment,
  AdjustmentShareLine,
  Belanja,
  BillInput,
  ItemShareLine,
  LineItem,
  Person,
  PersonBreakdown,
  RoundingMode,
  Sen,
  SplitResult,
  UnclaimedItem,
} from './types';

/** Internal id for the pseudo-bucket holding unclaimed items. Never a real person. */
const UNCLAIMED_BUCKET_ID = ' unclaimed';

const QUANTUM_SEN: Record<RoundingMode, bigint> = { sen: 1n, nearest5sen: 5n };

/** Decimal places used for the informational exact-value strings. */
const EXACT_DP = 6;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertSen(value: unknown, what: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new SplitEngineError(
      'INVALID_SEN',
      `${what} must be an integer number of sen, received ${String(value)}`,
    );
  }
}

function assertNonNegativeSen(value: unknown, what: string): asserts value is number {
  assertSen(value, what);
  if (value < 0) {
    throw new SplitEngineError('INVALID_SEN', `${what} must not be negative, received ${value}`);
  }
}

function rateToRational(rate: number, what: string): Rational {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new SplitEngineError(
      'INVALID_RATE',
      `${what} must be a finite number between 0 and 1, received ${String(rate)}`,
    );
  }
  // Via the decimal form, so 0.06 is exactly 6/100 rather than the nearest double.
  return R.fromNumber(rate);
}

interface NormalisedInput {
  people: Person[];
  items: LineItem[];
  adjustments: Adjustment[];
  belanja: Belanja[];
  serviceChargeRate: Rational;
  serviceTaxRate: Rational;
  roundingMode: RoundingMode;
}

function normalise(input: BillInput): NormalisedInput {
  const peopleIds = new Set<string>();
  for (const p of input.people) {
    if (peopleIds.has(p.id)) {
      throw new SplitEngineError('DUPLICATE_PERSON_ID', `Duplicate person id: ${p.id}`);
    }
    peopleIds.add(p.id);
  }
  if (peopleIds.has(UNCLAIMED_BUCKET_ID)) {
    throw new SplitEngineError('UNKNOWN_PERSON_ID', 'Reserved person id is not usable');
  }

  const itemIds = new Set<string>();
  const items = input.items.map((item) => {
    if (itemIds.has(item.id)) {
      throw new SplitEngineError('DUPLICATE_ITEM_ID', `Duplicate item id: ${item.id}`);
    }
    itemIds.add(item.id);
    assertNonNegativeSen(item.priceSen, `Item "${item.name}" price`);

    const portions = item.portions ?? null;
    if (portions !== null) {
      if (!Number.isSafeInteger(portions) || portions < 1) {
        throw new SplitEngineError(
          'INVALID_PORTIONS',
          `Item "${item.name}" must divide into a whole number of portions, at least one; ` +
            `received ${String(portions)}`,
        );
      }
    }

    // A person claiming the same item twice is a data hygiene artefact (the DB has
    // a composite PK preventing it); collapse it rather than charging them twice.
    const claimantIds: string[] = [];
    for (const id of item.claimantIds) {
      if (!peopleIds.has(id)) {
        throw new SplitEngineError(
          'UNKNOWN_PERSON_ID',
          `Item "${item.name}" is claimed by unknown person ${id}`,
        );
      }
      if (!claimantIds.includes(id)) claimantIds.push(id);
    }

    // Refused rather than absorbed. More claimants than portions means either
    // the cap failed or the portion count is wrong, and the honest answer is to
    // say so: silently falling back to dividing by the claimants would charge
    // people a different amount from the one they were shown.
    if (portions !== null && claimantIds.length > portions) {
      throw new SplitEngineError(
        'TOO_MANY_CLAIMANTS',
        `Item "${item.name}" divides into ${portions} ` +
          `${portions === 1 ? 'portion' : 'portions'} but ${claimantIds.length} people have ` +
          'claimed it',
      );
    }

    return { ...item, claimantIds, portions };
  });

  const adjustmentIds = new Set<string>();
  for (const adj of input.adjustments) {
    if (adjustmentIds.has(adj.id)) {
      throw new SplitEngineError('DUPLICATE_ADJUSTMENT_ID', `Duplicate adjustment id: ${adj.id}`);
    }
    adjustmentIds.add(adj.id);
    assertNonNegativeSen(adj.amountSen, `Adjustment "${adj.label}" amount`);
    if (adj.scope !== 'proportional') {
      if (!Array.isArray(adj.scope?.personIds) || adj.scope.personIds.length === 0) {
        throw new SplitEngineError(
          'INVALID_SCOPE',
          `Adjustment "${adj.label}" is person-scoped but names no people`,
        );
      }
      for (const id of adj.scope.personIds) {
        if (!peopleIds.has(id)) {
          throw new SplitEngineError(
            'UNKNOWN_PERSON_ID',
            `Adjustment "${adj.label}" names unknown person ${id}`,
          );
        }
      }
    }
  }

  const beneficiaries = new Set<string>();
  for (const b of input.belanja) {
    if (!peopleIds.has(b.sponsorId)) {
      throw new SplitEngineError('UNKNOWN_PERSON_ID', `Unknown belanja sponsor ${b.sponsorId}`);
    }
    if (!peopleIds.has(b.beneficiaryId)) {
      throw new SplitEngineError(
        'UNKNOWN_PERSON_ID',
        `Unknown belanja beneficiary ${b.beneficiaryId}`,
      );
    }
    if (b.sponsorId === b.beneficiaryId) {
      throw new SplitEngineError('BELANJA_SELF', `${b.sponsorId} cannot belanja themselves`);
    }
    if (beneficiaries.has(b.beneficiaryId)) {
      throw new SplitEngineError(
        'BELANJA_DUPLICATE_BENEFICIARY',
        `${b.beneficiaryId} is covered by more than one sponsor`,
      );
    }
    beneficiaries.add(b.beneficiaryId);
  }

  return {
    people: input.people,
    items,
    adjustments: input.adjustments,
    belanja: input.belanja,
    serviceChargeRate: rateToRational(input.serviceChargeRate, 'Service charge rate'),
    serviceTaxRate: rateToRational(input.serviceTaxRate, 'Service tax rate'),
    roundingMode: input.roundingMode,
  };
}

// ---------------------------------------------------------------------------
// Largest remainder method
// ---------------------------------------------------------------------------

/**
 * Round `exact` values to whole `quantum`s so that they sum to exactly `target`.
 *
 * Floor everything, then hand the leftover units out one at a time to the
 * largest fractional remainders. Ties break by `tieIds` ascending, so the result
 * does not depend on input ordering or on iteration order anywhere upstream.
 */
function allocateLargestRemainder(
  exact: readonly Rational[],
  target: bigint,
  quantum: bigint,
  tieIds: readonly string[],
): bigint[] {
  if (target % quantum !== 0n) {
    throw new SplitEngineError(
      'INVARIANT_VIOLATED',
      `Allocation target ${target} is not a multiple of the ${quantum} sen quantum`,
    );
  }
  const n = exact.length;
  if (n === 0) {
    if (target !== 0n) {
      throw new SplitEngineError('INVARIANT_VIOLATED', `Nothing to allocate ${target} sen to`);
    }
    return [];
  }

  const q: Rational = R.fromInt(quantum);
  const units: bigint[] = [];
  const remainders: Rational[] = [];
  let floorSum = 0n;
  for (const value of exact) {
    const inUnits = R.div(value, q);
    const whole = R.floorToBigInt(inUnits);
    units.push(whole);
    remainders.push(R.sub(inUnits, R.fromInt(whole)));
    floorSum += whole;
  }

  const leftover = target / quantum - floorSum;
  if (leftover < 0n) {
    throw new SplitEngineError(
      'INVARIANT_VIOLATED',
      `Largest remainder pass produced a negative leftover (${leftover})`,
    );
  }

  const order = exact
    .map((_, i) => i)
    .sort((a, b) => {
      const byRemainder = R.cmp(remainders[b]!, remainders[a]!);
      if (byRemainder !== 0) return byRemainder;
      const ia = tieIds[a]!;
      const ib = tieIds[b]!;
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });

  // leftover can exceed the bucket count in cash-rounding mode, where the target
  // is nudged up to the nearest 5 sen. Give everyone a whole round first.
  const big = BigInt(n);
  const everyone = leftover / big;
  const extra = Number(leftover % big);
  for (let i = 0; i < n; i += 1) units[i] = units[i]! + everyone;
  for (let k = 0; k < extra; k += 1) units[order[k]!] = units[order[k]!]! + 1n;

  return units.map((u) => u * quantum);
}

// ---------------------------------------------------------------------------
// Belanja
// ---------------------------------------------------------------------------

/** Resolve `beneficiary -> sponsor` edges to the person who ultimately pays. */
function resolveBelanjaRoots(belanja: readonly Belanja[]): Map<string, string> {
  const directSponsor = new Map<string, string>();
  for (const b of belanja) directSponsor.set(b.beneficiaryId, b.sponsorId);

  const roots = new Map<string, string>();
  for (const beneficiaryId of directSponsor.keys()) {
    const seen = new Set<string>([beneficiaryId]);
    let current = directSponsor.get(beneficiaryId)!;
    while (directSponsor.has(current)) {
      if (seen.has(current)) {
        throw new SplitEngineError('BELANJA_CYCLE', `Belanja forms a cycle involving ${current}`);
      }
      seen.add(current);
      current = directSponsor.get(current)!;
    }
    roots.set(beneficiaryId, current);
  }
  return roots;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function computeSplit(input: BillInput): SplitResult {
  const bill = normalise(input);
  const quantum = QUANTUM_SEN[bill.roundingMode];

  // --- Steps 1-5: the bill totals ---------------------------------------
  let subtotalSen = 0;
  for (const item of bill.items) subtotalSen += item.priceSen;
  const subtotal = R.fromInt(subtotalSen);

  const serviceChargeSen = Number(R.roundHalfUpToBigInt(R.mul(subtotal, bill.serviceChargeRate)));
  // Service tax is levied on subtotal PLUS service charge, not on subtotal alone.
  const taxableSen = subtotalSen + serviceChargeSen;
  const serviceTaxSen = Number(
    R.roundHalfUpToBigInt(R.mul(R.fromInt(taxableSen), bill.serviceTaxRate)),
  );

  let totalAdjustmentsSen = 0;
  for (const adj of bill.adjustments) totalAdjustmentsSen += adj.amountSen;

  const preAdjustmentTotalSen = subtotalSen + serviceChargeSen + serviceTaxSen;
  if (totalAdjustmentsSen > preAdjustmentTotalSen) {
    throw new SplitEngineError(
      'ADJUSTMENTS_EXCEED_TOTAL',
      `Adjustments (${totalAdjustmentsSen} sen) exceed the bill before adjustments ` +
        `(${preAdjustmentTotalSen} sen); the bill total would be negative`,
    );
  }
  const billTotalSen = preAdjustmentTotalSen - totalAdjustmentsSen;

  // Cash settlement rounds the payable total to the nearest 5 sen, the way a till
  // does. Transfer settlement ('sen') leaves it alone.
  const settlementTotalSen =
    quantum === 1n
      ? billTotalSen
      : Number(
          R.roundHalfUpToBigInt(R.div(R.fromInt(billTotalSen), R.fromInt(quantum))) * quantum,
        );
  const cashRoundingDeltaSen = settlementTotalSen - billTotalSen;

  // --- Buckets: the people, plus a pseudo-bucket for unclaimed items -----
  // A line is short when nobody has claimed it, and -- once its divisor is
  // pinned -- also when only some of its portions have been taken.
  const unclaimedItems: UnclaimedItem[] = bill.items
    .map((item) => {
      const portions = item.portions ?? null;
      const claimedPortions = item.claimantIds.length;
      // With no fixed divisor a line is all-or-nothing, so one notional portion.
      const divisor = portions ?? 1;
      const shortPortions = divisor - Math.min(claimedPortions, divisor);
      return { item, portions, claimedPortions, shortPortions, divisor };
    })
    .filter(({ claimedPortions, shortPortions }) => shortPortions > 0 && claimedPortions >= 0)
    .map(({ item, portions, claimedPortions, shortPortions, divisor }) => ({
      id: item.id,
      name: item.name,
      priceSen: item.priceSen,
      portions,
      claimedPortions,
      unclaimedSen: Number(
        R.roundHalfUpToBigInt(
          R.div(R.mul(R.fromInt(item.priceSen), R.fromInt(shortPortions)), R.fromInt(divisor)),
        ),
      ),
    }));
  const hasUnclaimed = unclaimedItems.length > 0;

  const bucketIds: string[] = bill.people.map((p) => p.id);
  if (hasUnclaimed) bucketIds.push(UNCLAIMED_BUCKET_ID);
  const bucketIndex = new Map<string, number>(bucketIds.map((id, i) => [id, i]));
  const bucketCount = bucketIds.length;

  // --- Step 6: exact base shares ----------------------------------------
  const base: Rational[] = Array.from({ length: bucketCount }, () => R.ZERO);
  const itemLines: ItemShareLine[][] = Array.from({ length: bucketCount }, () => []);

  for (const item of bill.items) {
    const price = R.fromInt(item.priceSen);
    if (item.claimantIds.length === 0) {
      const i = bucketIndex.get(UNCLAIMED_BUCKET_ID)!;
      base[i] = R.add(base[i]!, price);
      continue;
    }

    // Pinned when the line says how many ways it divides, otherwise however
    // many people have claimed it. This is the whole difference between a share
    // that is final the moment it is shown and one that keeps moving.
    const divisor = item.portions ?? item.claimantIds.length;
    const perHead = R.div(price, R.fromInt(divisor));

    for (const claimantId of item.claimantIds) {
      const i = bucketIndex.get(claimantId)!;
      base[i] = R.add(base[i]!, perHead);
      itemLines[i]!.push({
        itemId: item.id,
        name: item.name,
        itemPriceSen: item.priceSen,
        claimantCount: item.claimantIds.length,
        displayShareSen: Number(R.roundHalfUpToBigInt(perHead)),
        exactShareSen: R.toFixed(perHead, EXACT_DP),
      });
    }

    // Portions nobody has taken. They sit in the unclaimed bucket rather than
    // being spread over whoever did claim, which is exactly what stops an early
    // claimant being charged for someone else's helping.
    const shortPortions = divisor - item.claimantIds.length;
    if (shortPortions > 0) {
      const i = bucketIndex.get(UNCLAIMED_BUCKET_ID)!;
      base[i] = R.add(base[i]!, R.mul(perHead, R.fromInt(shortPortions)));
    }
  }

  // --- Step 7: ratios ----------------------------------------------------
  // A zero subtotal means every item is free, so every charge and adjustment is
  // zero too (validated above) and a ratio of zero is correct for everyone.
  const ratio: Rational[] = base.map((b) => (subtotalSen === 0 ? R.ZERO : R.div(b, subtotal)));

  // --- Step 8: allocate charges and adjustments --------------------------
  let proportionalAdjustmentSen = 0;
  const personAdjustment: Rational[] = Array.from({ length: bucketCount }, () => R.ZERO);
  const adjustmentLines: AdjustmentShareLine[][] = Array.from({ length: bucketCount }, () => []);
  const adjustmentExact: Rational[][] = Array.from({ length: bucketCount }, () => []);

  for (const adj of bill.adjustments) {
    if (adj.scope === 'proportional') {
      proportionalAdjustmentSen += adj.amountSen;
      continue;
    }
    // Person-scoped discounts split equally between the people named. A RM20
    // birthday voucher for two people is RM10 off each, regardless of what they ate.
    const targets = Array.from(new Set(adj.scope.personIds));
    const each = R.div(R.fromInt(adj.amountSen), R.fromInt(targets.length));
    for (const personId of targets) {
      const i = bucketIndex.get(personId)!;
      personAdjustment[i] = R.add(personAdjustment[i]!, each);
    }
  }

  const chargesSen = serviceChargeSen + serviceTaxSen;
  const chargesLessProportional = R.fromInt(chargesSen - proportionalAdjustmentSen);

  const serviceChargeExact = ratio.map((r) => R.mul(r, R.fromInt(serviceChargeSen)));
  const serviceTaxExact = ratio.map((r) => R.mul(r, R.fromInt(serviceTaxSen)));

  // Record the per-adjustment lines now that ratios are known, as signed reductions.
  for (const adj of bill.adjustments) {
    if (adj.scope === 'proportional') {
      const amount = R.fromInt(adj.amountSen);
      for (let i = 0; i < bucketCount; i += 1) {
        const shareOf = R.neg(R.mul(ratio[i]!, amount));
        adjustmentExact[i]!.push(shareOf);
        adjustmentLines[i]!.push({
          adjustmentId: adj.id,
          label: adj.label,
          amountSen: 0, // filled in after rounding
          scope: 'proportional',
        });
      }
      continue;
    }
    const targets = Array.from(new Set(adj.scope.personIds));
    const each = R.neg(R.div(R.fromInt(adj.amountSen), R.fromInt(targets.length)));
    for (const personId of targets) {
      const i = bucketIndex.get(personId)!;
      adjustmentExact[i]!.push(each);
      adjustmentLines[i]!.push({
        adjustmentId: adj.id,
        label: adj.label,
        amountSen: 0,
        scope: 'person',
      });
    }
  }

  const ideal: Rational[] = base.map((b, i) =>
    R.sub(R.add(b, R.mul(ratio[i]!, chargesLessProportional)), personAdjustment[i]!),
  );

  // Clamp anyone whose discounts exceed their share at zero, and push the
  // unabsorbed remainder onto everyone else by ratio. Iterated, because
  // absorbing it can push the next person negative. The sum is preserved at
  // every step, so the shares still total the bill.
  const clamped: boolean[] = Array.from({ length: bucketCount }, () => false);
  let settled: Rational[] = ideal.slice();

  for (let guard = 0; guard <= bucketCount; guard += 1) {
    let foundNegative = false;
    for (let i = 0; i < bucketCount; i += 1) {
      if (!clamped[i] && R.isNegative(settled[i]!)) {
        clamped[i] = true;
        foundNegative = true;
      }
    }
    if (!foundNegative) break;

    let deficit = R.ZERO;
    const open: number[] = [];
    for (let i = 0; i < bucketCount; i += 1) {
      if (clamped[i]) deficit = R.sub(deficit, ideal[i]!);
      else open.push(i);
    }

    if (open.length === 0) {
      if (billTotalSen !== 0) {
        throw new SplitEngineError(
          'INVARIANT_VIOLATED',
          'Every share clamped to zero but the bill total is not zero',
        );
      }
      settled = settled.map(() => R.ZERO);
      break;
    }

    let openWeight = R.ZERO;
    for (const i of open) openWeight = R.add(openWeight, ratio[i]!);

    const next: Rational[] = Array.from({ length: bucketCount }, () => R.ZERO);
    for (const i of open) {
      // If none of the remaining people claimed anything, ratio-weighting is
      // undefined; fall back to an equal split of the remainder.
      const weight = R.isZero(openWeight)
        ? R.div(R.ONE, R.fromInt(open.length))
        : R.div(ratio[i]!, openWeight);
      next[i] = R.sub(ideal[i]!, R.mul(weight, deficit));
    }
    settled = next;
  }

  const clampExact: Rational[] = settled.map((s, i) => R.sub(s, ideal[i]!));

  // --- Step 9: largest remainder rounding --------------------------------
  // Always resolve to the sen first. This is what each person owes on a bill
  // settled by transfer, and it is the basis every breakdown component is
  // explained against.
  const senShares = allocateLargestRemainder(settled, BigInt(billTotalSen), 1n, bucketIds);

  // Cash settlement then snaps to the 5 sen grid. Done as a second, separate
  // pass so the sen a person gains or loses to cash rounding is its own visible
  // line rather than being smeared through the other components.
  const finalShares =
    quantum === 1n
      ? senShares
      : allocateLargestRemainder(settled, BigInt(settlementTotalSen), quantum, bucketIds);

  // --- Step 10: belanja --------------------------------------------------
  const belanjaRoots = resolveBelanjaRoots(bill.belanja);
  const absorbed = new Map<string, number>();
  for (const [beneficiaryId, sponsorId] of belanjaRoots) {
    const i = bucketIndex.get(beneficiaryId)!;
    absorbed.set(sponsorId, (absorbed.get(sponsorId) ?? 0) + Number(finalShares[i]!));
  }

  // --- Assemble the per-person breakdown ---------------------------------
  const people: PersonBreakdown[] = bill.people.map((person) => {
    const i = bucketIndex.get(person.id)!;
    const finalShareSen = Number(finalShares[i]!);

    const senShareSen = Number(senShares[i]!);
    const cashRoundingShareSen = finalShareSen - senShareSen;

    // Split the sen-exact share across its five components so they sum to it
    // exactly. The components' exact values already sum to `settled[i]`, so this
    // is the same largest remainder trick one level down.
    const components: Rational[] = [
      base[i]!,
      serviceChargeExact[i]!,
      serviceTaxExact[i]!,
      R.sum(adjustmentExact[i]!),
      clampExact[i]!,
    ];
    const componentIds = ['1base', '2charge', '3tax', '4adjust', '5clamp'];
    const rounded = allocateLargestRemainder(components, BigInt(senShareSen), 1n, componentIds);
    const adjustmentShareSen = Number(rounded[3]!);

    // And once more for the individual adjustment lines, so they sum to the
    // adjustment component rather than drifting from it.
    const lineAmounts = allocateLargestRemainder(
      adjustmentExact[i]!,
      BigInt(adjustmentShareSen),
      1n,
      adjustmentLines[i]!.map((l, k) => `${String(k).padStart(6, '0')}${l.adjustmentId}`),
    );
    const lines = adjustmentLines[i]!.map((line, k) => ({
      ...line,
      amountSen: Number(lineAmounts[k]!),
    }));

    const coveredBy = belanjaRoots.get(person.id) ?? null;
    const belanjaAbsorbedSen = absorbed.get(person.id) ?? 0;
    const amountDueSen = coveredBy === null ? finalShareSen + belanjaAbsorbedSen : 0;

    return {
      personId: person.id,
      name: person.name,
      baseShareSen: Number(rounded[0]!),
      serviceChargeShareSen: Number(rounded[1]!),
      serviceTaxShareSen: Number(rounded[2]!),
      adjustmentShareSen,
      clampRedistributionSen: Number(rounded[4]!),
      cashRoundingShareSen,
      finalShareSen,
      roundingDeltaSen: senShareSen - Number(R.floorToBigInt(settled[i]!)),
      exactShareSen: R.toFixed(settled[i]!, EXACT_DP),
      belanjaAbsorbedSen,
      belanjaCoveredBySponsorId: coveredBy,
      amountDueSen,
      ratioOfSubtotal: R.toFixed(ratio[i]!, EXACT_DP),
      itemLines: itemLines[i]!,
      adjustmentLines: lines,
    };
  });

  const unallocatedSen = hasUnclaimed
    ? Number(finalShares[bucketIndex.get(UNCLAIMED_BUCKET_ID)!]!)
    : 0;

  const result: SplitResult = {
    subtotalSen,
    serviceChargeSen,
    serviceTaxSen,
    totalAdjustmentsSen,
    billTotalSen,
    settlementTotalSen,
    cashRoundingDeltaSen,
    unclaimedItems,
    unallocatedSen,
    people,
    roundingMode: bill.roundingMode,
  };

  assertNoSenLeaked(result);
  return result;
}

/**
 * Hard constraint: no sen may appear or disappear. This runs on every call, in
 * production as well as in tests -- a silent 1-sen leak is a trust bug, and
 * failing loudly is strictly better than quietly asking someone for the wrong
 * amount.
 */
export function assertNoSenLeaked(result: SplitResult): void {
  const fail = (message: string): never => {
    throw new SplitEngineError('INVARIANT_VIOLATED', message);
  };

  let shares = 0;
  let due = 0;
  for (const p of result.people) {
    shares += p.finalShareSen;
    due += p.amountDueSen;

    const components =
      p.baseShareSen +
      p.serviceChargeShareSen +
      p.serviceTaxShareSen +
      p.adjustmentShareSen +
      p.clampRedistributionSen +
      p.cashRoundingShareSen;
    if (components !== p.finalShareSen) {
      fail(
        `${p.name}'s breakdown sums to ${components} sen but their share is ${p.finalShareSen} sen`,
      );
    }

    let lines = 0;
    for (const line of p.adjustmentLines) lines += line.amountSen;
    if (lines !== p.adjustmentShareSen) {
      fail(
        `${p.name}'s adjustment lines sum to ${lines} sen but their adjustment total is ${p.adjustmentShareSen} sen`,
      );
    }

    if (p.finalShareSen < 0) fail(`${p.name}'s share is negative (${p.finalShareSen} sen)`);
    if (p.amountDueSen < 0) fail(`${p.name} owes a negative amount (${p.amountDueSen} sen)`);
  }

  if (shares + result.unallocatedSen !== result.settlementTotalSen) {
    fail(
      `Shares (${shares}) plus unallocated (${result.unallocatedSen}) is ` +
        `${shares + result.unallocatedSen} sen, but the settlement total is ${result.settlementTotalSen} sen`,
    );
  }
  // Belanja moves money between people; it never changes what the table pays.
  if (due + result.unallocatedSen !== result.settlementTotalSen) {
    fail(
      `Amounts due (${due}) plus unallocated (${result.unallocatedSen}) is ` +
        `${due + result.unallocatedSen} sen, but the settlement total is ${result.settlementTotalSen} sen`,
    );
  }
  if (result.unallocatedSen !== 0 && result.unclaimedItems.length === 0) {
    fail(`Everything is claimed but ${result.unallocatedSen} sen is unallocated`);
  }
}

/** Convenience for callers that only need the payable number per person. */
export function amountsDue(result: SplitResult): Map<string, Sen> {
  return new Map(result.people.map((p) => [p.personId, p.amountDueSen]));
}
