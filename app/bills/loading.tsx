import { Skeleton, SkeletonCard } from '@/components/ui';

/**
 * Shown while the bills list is being fetched.
 *
 * These pages are `force-dynamic`, so every navigation to one waits on the
 * server. Without a boundary here the old screen simply sits there, which is
 * the same ambiguity a button with no pending state has: nothing says the tap
 * was received.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-md px-5 pt-6 pb-28" aria-busy="true">
      <span className="sr-only">Loading your bills…</span>

      <div className="flex items-center justify-between gap-3">
        <Skeleton width={150} height={30} />
        <Skeleton width={110} height={20} />
      </div>
      <Skeleton className="mt-3" width={130} height={13} />

      <div className="mt-5 space-y-2">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </main>
  );
}
