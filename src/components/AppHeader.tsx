"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth-context";
import { Bell } from "lucide-react";
import type { AnnouncementRow } from "@/lib/data/announcements";
import { NAV } from "@/components/AppSidebar";

export function AppHeader({
  unreadCount,
  recentAnnouncements,
  markSeen,
}: {
  unreadCount: number;
  recentAnnouncements: AnnouncementRow[];
  markSeen: () => Promise<void>;
}) {
  const { user } = useAuth();
  const path = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const [, startTransition] = useTransition();
  useEffect(() => {
    setDismissed(false);
  }, [unreadCount]);

  const pageTitle = user ? (NAV[user.role].find((item) => item.url === path)?.title ?? "") : "";
  const showBadge = !dismissed && unreadCount > 0;

  function handleNotificationsOpenChange(open: boolean) {
    if (open && unreadCount > 0) {
      setDismissed(true);
      startTransition(() => {
        markSeen();
      });
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 min-w-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
      <SidebarTrigger className="shrink-0 text-foreground" />
      <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{pageTitle}</div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <DropdownMenu onOpenChange={handleNotificationsOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="relative rounded-full"
              aria-label="Notifikasi"
            >
              <Bell className="h-4 w-4" />
              {showBadge && (
                <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Pengumuman</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {recentAnnouncements.length === 0 && (
              <div className="px-2 py-3 text-sm text-muted-foreground">Belum ada pengumuman.</div>
            )}
            {recentAnnouncements.map((a) => (
              <DropdownMenuItem key={a.id} asChild className="flex-col items-start gap-0.5">
                <Link href="/announcements">
                  <span className="text-sm font-medium">{a.title}</span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">{a.body}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="justify-center text-sm font-medium text-primary">
              <Link href="/announcements">Lihat semua pengumuman</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
