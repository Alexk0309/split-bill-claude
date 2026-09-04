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

const KEY_PREFIX = 'splitbill:v1:';

const keyFor = (billId: string): string => `${KEY_PREFIX}${billId}`;

/**
 * Storage access is wrapped because it throws outright in Safari private mode
 * and when a browser is set to block site data. A guest who cannot store
 * anything should still be able to claim; they just get asked their name again.
 */
function safeStorage(explicit?: Storage): Storage | null {
  if (explicit) return explicit;
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readIdentity(billId: string, explicit?: Storage): GuestIdentity | null {
  const storage = safeStorage(explicit);
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyFor(billId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as GuestIdentity).participantId === 'string' &&
      typeof (parsed as GuestIdentity).claimToken === 'string'
    ) {
      return parsed as GuestIdentity;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeIdentity(billId: string, identity: GuestIdentity, explicit?: Storage): void {
  const storage = safeStorage(explicit);
  if (!storage) return;
  try {
    storage.setItem(keyFor(billId), JSON.stringify(identity));
  } catch {
    // Out of quota or blocked. Claiming still works for this session.
  }
}

export function clearIdentity(billId: string, explicit?: Storage): void {
  const storage = safeStorage(explicit);
  if (!storage) return;
  try {
    storage.removeItem(keyFor(billId));
  } catch {
    // Nothing to do.
  }
}
