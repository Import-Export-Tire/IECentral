"use client";
import { usePaginatedQuery } from "convex/react";
import type { PaginatedQueryReference, PaginatedQueryArgs } from "convex/react";

export function usePaginatedList<Q extends PaginatedQueryReference>(
  query: Q,
  args: PaginatedQueryArgs<Q> | "skip",
  opts?: { initialNumItems?: number },
) {
  const { results, status, loadMore, isLoading } = usePaginatedQuery(
    query,
    args,
    { initialNumItems: opts?.initialNumItems ?? 50 },
  );
  return {
    results,
    status,
    loadMore,
    isLoading,
    isDone: status === "Exhausted",
  };
}
