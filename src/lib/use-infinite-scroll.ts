import { useEffect, useRef } from "react";

/**
 * Watches a sentinel element via IntersectionObserver.
 * Calls `onLoadMore` when the sentinel scrolls into view.
 */
export function useInfiniteScroll(
  onLoadMore: () => void,
  options: { hasMore: boolean; isLoading: boolean }
) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(onLoadMore);

  useEffect(() => {
    callbackRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    if (!options.hasMore || options.isLoading) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          callbackRef.current();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [options.hasMore, options.isLoading]);

  return sentinelRef;
}
