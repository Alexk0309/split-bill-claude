import { Skeleton, SkeletonCard } from '@/components/ui';

/**
 * Reached straight after a receipt scan, so somebody is already waiting and
 * already wondering whether the photo worked.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-md px-5 pt-4 pb-28" aria-busy="true">
      <span className="sr-only">Loading the scanned receipt…</span>

      <Skeleton width={120} height={14} />
      <Skeleton className="mt-3" width="60%" height={30} />
      <Skeleton className="mt-3" width="90%" height={15} />

      <div className="mt-5 space-y-2">
        <SkeletonCard lines={1} />
        <SkeletonCard lines={1} />
        <SkeletonCard lines={1} />
        <SkeletonCard lines={1} />
      </div>
    </main>
  );
}
