import { Skeleton, SkeletonCard } from '@/components/ui';

/** The editor is the slowest page here: it loads the bill, its items, its
 *  people, their claims, every proof, and the profile before it renders. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-md px-5 pt-4 pb-16" aria-busy="true">
      <span className="sr-only">Loading the bill…</span>

      <Skeleton width={80} height={14} />
      <Skeleton className="mt-3" width="65%" height={30} />

      <div className="mt-6 space-y-7">
        <SkeletonCard lines={3} />

        <div>
          <Skeleton width={60} height={15} />
          <div className="mt-2 space-y-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>

        <div>
          <Skeleton width={110} height={15} />
          <div className="mt-2">
            <SkeletonCard lines={4} />
          </div>
        </div>
      </div>
    </main>
  );
}
