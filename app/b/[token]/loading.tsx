import { Skeleton } from '@/components/ui';

/**
 * The guest page, opened from a WhatsApp link on somebody else's phone and
 * often on a restaurant's wifi. A blank screen here reads as a broken link,
 * which is the one impression this product cannot afford to give.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-md px-5 pt-6 pb-36" aria-busy="true">
      <span className="sr-only">Loading the bill…</span>

      <Skeleton width="70%" height={26} />
      <Skeleton className="mt-2" width="45%" height={15} />

      <div className="mt-6 space-y-2">
        {[68, 68, 68, 68, 68].map((height, i) => (
          <Skeleton key={i} height={height} className="rounded-2xl" />
        ))}
      </div>
    </main>
  );
}
