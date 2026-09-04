import { describe, expect, it } from 'vitest';

import { clearIdentity, readIdentity, writeIdentity } from '../guest-identity';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

/** Safari private mode and "block site data" throw on every access. */
function hostileStorage(): Storage {
  const boom = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return {
    get length(): number {
      return boom();
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  };
}

describe('guest identity', () => {
  it('round trips an identity per bill', () => {
    const storage = fakeStorage();
    writeIdentity('bill-1', { participantId: 'p1', claimToken: 'tok-1' }, storage);
    expect(readIdentity('bill-1', storage)).toEqual({ participantId: 'p1', claimToken: 'tok-1' });
  });

  it('keeps bills separate, so one link does not leak into another', () => {
    const storage = fakeStorage();
    writeIdentity('bill-1', { participantId: 'p1', claimToken: 'tok-1' }, storage);
    writeIdentity('bill-2', { participantId: 'p2', claimToken: 'tok-2' }, storage);

    expect(readIdentity('bill-1', storage)?.participantId).toBe('p1');
    expect(readIdentity('bill-2', storage)?.participantId).toBe('p2');
  });

  it('returns null for a bill that has never been opened', () => {
    expect(readIdentity('unknown', fakeStorage())).toBeNull();
  });

  it('clears one bill without touching the others', () => {
    const storage = fakeStorage();
    writeIdentity('bill-1', { participantId: 'p1', claimToken: 'tok-1' }, storage);
    writeIdentity('bill-2', { participantId: 'p2', claimToken: 'tok-2' }, storage);

    clearIdentity('bill-1', storage);
    expect(readIdentity('bill-1', storage)).toBeNull();
    expect(readIdentity('bill-2', storage)).not.toBeNull();
  });

  it('ignores corrupted or half-written values rather than crashing the page', () => {
    expect(readIdentity('bill-1', fakeStorage({ 'splitbill:v1:bill-1': 'not json' }))).toBeNull();
    expect(readIdentity('bill-1', fakeStorage({ 'splitbill:v1:bill-1': '{}' }))).toBeNull();
    expect(
      readIdentity('bill-1', fakeStorage({ 'splitbill:v1:bill-1': '{"participantId":"p1"}' })),
    ).toBeNull();
    expect(readIdentity('bill-1', fakeStorage({ 'splitbill:v1:bill-1': 'null' }))).toBeNull();
  });

  it('survives a browser that refuses storage entirely', () => {
    const storage = hostileStorage();
    expect(() => writeIdentity('bill-1', { participantId: 'p1', claimToken: 't' }, storage)).not.toThrow();
    expect(readIdentity('bill-1', storage)).toBeNull();
    expect(() => clearIdentity('bill-1', storage)).not.toThrow();
  });
});
