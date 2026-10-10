"use client";

import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/tabs";
import { useAdminFilters } from "@/hooks/use-admin-filters";

export function UsersTabs({ children }: { children: ReactNode }) {
  const { params, setFilters } = useAdminFilters();
  const requestedTab = params.get("tab") ?? "siswa";
  const tab = ["siswa", "guru", "kepsek"].includes(requestedTab) ? requestedTab : "siswa";
  return (
    <Tabs value={tab} onValueChange={(value) => setFilters({ tab: value })}>
      {children}
    </Tabs>
  );
}
