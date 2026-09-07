import { formatRM, formatSen } from '@/lib/money';

/** Money, always rendered from integer sen. Tabular so columns line up. */
export function Money({
  sen,
  className = '',
  withSymbol = true,
}: {
  sen: number;
  className?: string;
  withSymbol?: boolean;
}) {
  return (
    <span className={`tabular ${className}`}>
      {withSymbol ? formatRM(sen) : formatSen(sen)}
    </span>
  );
}

/** Deterministic colour per person, so the same name looks the same everywhere. */
function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return hash;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({
  name,
  seed,
  size = 28,
  dimmed = false,
}: {
  name: string;
  seed?: string;
  size?: number;
  dimmed?: boolean;
}) {
  const hue = hueFor(seed ?? name);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `oklch(0.9 0.06 ${hue})`,
        color: `oklch(0.38 0.09 ${hue})`,
        opacity: dimmed ? 0.45 : 1,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** A row of who has claimed an item. Names are read out for screen readers. */
export function AvatarRow({
  people,
  emptyLabel = 'Nobody yet',
}: {
  people: { id: string; name: string }[];
  emptyLabel?: string;
}) {
  if (people.length === 0) {
    return <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{emptyLabel}</span>;
  }
  return (
    <span className="flex items-center gap-1">
      <span className="sr-only">Claimed by {people.map((p) => p.name).join(', ')}</span>
      {people.slice(0, 6).map((p) => (
        <Avatar key={p.id} name={p.name} seed={p.id} size={24} />
      ))}
      {people.length > 6 ? (
        <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          +{people.length - 6}
        </span>
      ) : null}
    </span>
  );
}

export function Banner({
  tone = 'warn',
  children,
}: {
  tone?: 'warn' | 'good' | 'info';
  children: React.ReactNode;
}) {
  const background =
    tone === 'good' ? 'var(--good-wash)' : tone === 'info' ? 'var(--surface-sunk)' : 'var(--accent-wash-strong)';
  const color = tone === 'good' ? 'var(--good)' : tone === 'info' ? 'var(--text-muted)' : 'var(--accent-strong)';
  return (
    <div
      className="rounded-xl px-3 py-2.5 text-[14px] font-medium"
      style={{ background, color }}
      role="status"
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card px-4 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {hint ? (
        <p className="mt-1 text-[14px]" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * How much of an allowance is left.
 *
 * Deliberately quiet until it matters: nothing is said while there is plenty,
 * a plain count once it is worth knowing, and a warning tone only at the end.
 * A meter that shouts from the first use just teaches people to ignore it.
 */
export function UsageMeter({
  used,
  limit,
  noun,
  pluralNoun,
  /** Shown when the allowance is gone. Should name what still works. */
  exhaustedNote,
  /** Start showing the count once this many remain. */
  quietUntilRemaining = 2,
}: {
  used: number;
  limit: number;
  noun: string;
  pluralNoun?: string;
  exhaustedNote?: string;
  quietUntilRemaining?: number;
}) {
  const remaining = Math.max(0, limit - used);
  const plural = pluralNoun ?? `${noun}s`;

  if (remaining === 0) {
    return (
      <p
        className="mt-2 text-[13px]"
        style={{ color: 'var(--accent-strong)' }}
        role="status"
      >
        <strong>No {plural} left.</strong>
        {exhaustedNote ? ` ${exhaustedNote}` : null}
      </p>
    );
  }

  if (remaining > quietUntilRemaining) return null;

  return (
    <p className="mt-2 text-[13px]" style={{ color: 'var(--text-muted)' }} role="status">
      {remaining} {remaining === 1 ? noun : plural} left
    </p>
  );
}

/** The always-visible form, for places where the count is the point. */
export function UsageCount({
  used,
  limit,
  noun,
  pluralNoun,
}: {
  used: number;
  /** Null for an account with no ceiling. */
  limit: number | null;
  noun: string;
  pluralNoun?: string;
}) {
  const plural = pluralNoun ?? `${noun}s`;

  // An account with no ceiling still gets a count, because the number is worth
  // knowing; what it does not get is a fraction with nothing in the denominator.
  if (limit === null) {
    return (
      <span className="tabular text-[13px]" style={{ color: 'var(--text-muted)' }}>
        {used} {used === 1 ? noun : plural} created · no limit
      </span>
    );
  }

  const remaining = Math.max(0, limit - used);
  return (
    <span
      className="tabular text-[13px]"
      style={{ color: remaining === 0 ? 'var(--accent-strong)' : 'var(--text-muted)' }}
    >
      {used} of {limit} {plural} used
    </span>
  );
}

/**
 * A placeholder in the shape of the content that is loading.
 *
 * Used on route transitions, where the alternative is an unchanged screen for
 * as long as the server takes -- which is the same ambiguity a button with no
 * pending state has: nothing on screen says a tap was received.
 */
export function Skeleton({
  className = '',
  width,
  height = 16,
}: {
  className?: string;
  width?: number | string;
  height?: number | string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton block ${className}`}
      style={{ width: width ?? '100%', height }}
    />
  );
}

/** A card-shaped placeholder, matching the rows these pages are made of. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="card px-4 py-3.5">
      <Skeleton width="55%" height={15} />
      {Array.from({ length: lines - 1 }, (_, i) => (
        <Skeleton key={i} className="mt-2" width={i === lines - 2 ? '35%' : '80%'} height={12} />
      ))}
    </div>
  );
}
