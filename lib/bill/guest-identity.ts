/**
 * Remembers who a guest is, on their own device only.
 *
 * A guest never signs up, so the only thing tying them to a name is what their
 * browser holds. Returning to the same link picks them up where they left off;
 * clearing site data means picking their name again, which is the whole cost of
 * having no account.
 *
 * Nothing here leaves the device.
 */

import type { GuestIdentity } from '@/lib/supabase/types';

import { readJson, removeKey, writeJson } from './storage';

const KEY_PREFIX = 'splitbill:v1:';

const keyFor = (billId: string): string => `${KEY_PREFIX}${billId}`;

function isIdentity(value: unknown): value is GuestIdentity {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as GuestIdentity).participantId === 'string' &&
    typeof (value as GuestIdentity).claimToken === 'string'
  );
}

export function readIdentity(billId: string, explicit?: Storage): GuestIdentity | null {
  return readJson(keyFor(billId), isIdentity, explicit);
}

export function writeIdentity(billId: string, identity: GuestIdentity, explicit?: Storage): void {
  writeJson(keyFor(billId), identity, explicit);
}

export function clearIdentity(billId: string, explicit?: Storage): void {
  removeKey(keyFor(billId), explicit);
}
