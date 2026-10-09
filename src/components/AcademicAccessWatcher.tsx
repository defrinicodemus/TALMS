"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ACADEMIC_MAINTENANCE_PATH } from "@/lib/auth/academic-access";

// The backend blocks writes immediately. This also replaces an idle, already
// open page on focus or within 30 seconds while the tab is visible.
export function AcademicAccessWatcher() {
  const router = useRouter();
  useEffect(() => {
    let disposed = false;
    let checking = false;
    const controller = new AbortController();
    async function check() {
      if (document.visibilityState !== "visible" || checking) return;
      checking = true;
      try {
        const response = await fetch("/api/academic-status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!disposed && response.status === 503) router.replace(ACADEMIC_MAINTENANCE_PATH);
      } catch {
        // A disconnected browser cannot check status; server guards remain in force.
      } finally {
        checking = false;
      }
    }
    void check();
    const interval = window.setInterval(check, 30_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);
  return null;
}
