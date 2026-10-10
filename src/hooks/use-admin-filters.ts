"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

// These filters only select already-loaded administrative data. Next integrates
// native history updates with useSearchParams, without refetching the whole page.
export function useAdminFilters() {
  const params = useSearchParams();
  const setFilters = useCallback((values: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(values)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return { params, setFilters };
}
