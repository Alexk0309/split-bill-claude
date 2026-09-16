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
    <main className="mx-auto max-w-md px-5 pt-6 pb-32" aria-busy="true">
      <span className="sr-only">Loading your bills…</span>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Skeleton width={150} height={30} />
          <Skeleton className="mt-1.5" width={130} height={13} />
        </div>
        <Skeleton width={110} height={20} />
      </div>

      <div className="mt-6 space-y-2">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </main>
  );
}
