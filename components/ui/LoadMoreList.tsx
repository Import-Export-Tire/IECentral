"use client";
import type { ReactNode } from "react";

type Status = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

export function LoadMoreList<T>({
  status,
  results,
  loadMore,
  renderItem,
  empty,
  skeleton,
  pageSize = 50,
}: {
  status: Status;
  results: T[];
  loadMore: (n: number) => void;
  renderItem: (item: T, index: number) => ReactNode;
  empty?: ReactNode;
  skeleton?: ReactNode;
  pageSize?: number;
}) {
  if (status === "LoadingFirstPage") {
    return <>{skeleton ?? null}</>;
  }
  if (results.length === 0) {
    return <>{empty ?? null}</>;
  }
  return (
    <>
      {results.map((item, i) => renderItem(item, i))}
      {status === "CanLoadMore" && (
        <div className="flex justify-center py-4">
          <button
            onClick={() => loadMore(pageSize)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent-primary)] text-white hover:opacity-90"
          >
            Load more
          </button>
        </div>
      )}
      {status === "LoadingMore" && (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 border-2 border-t-transparent border-[var(--accent-primary)] rounded-full animate-spin" />
        </div>
      )}
    </>
  );
}
export default LoadMoreList;
