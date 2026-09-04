/**
 * Guarded access to `localStorage`.
 *
 * Every call is wrapped because storage throws outright in Safari private mode
 * and when a browser is set to block site data. A guest who cannot store
 * anything must still be able to use the page; they just lose the parts that
 * survive a reload.
 */

export function safeStorage(explicit?: Storage): Storage | null {
  if (explicit) return explicit;
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, guard: (value: unknown) => value is T, explicit?: Storage): T | null {
  const storage = safeStorage(explicit);
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown, explicit?: Storage): void {
  const storage = safeStorage(explicit);
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Out of quota or blocked. The page still works for this session.
  }
}

export function removeKey(key: string, explicit?: Storage): void {
  const storage = safeStorage(explicit);
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}
