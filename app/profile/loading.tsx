import { Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <main className="mx-auto max-w-md px-5 pt-6 pb-16" aria-busy="true">
      <span className="sr-only">Loading your payment details…</span>

      <Skeleton width={80} height={14} />
      <Skeleton className="mt-3" width="60%" height={30} />

      <div className="mt-6 space-y-5">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <Skeleton width={120} height={13} />
            <Skeleton className="mt-2" height={48} />
          </div>
        ))}
      </div>
    </main>
  );
}
