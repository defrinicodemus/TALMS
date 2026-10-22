"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  BookOpen,
  User,
  Users,
  GraduationCap,
  ClipboardList,
  Settings,
  Building2,
  BarChart3,
  Bell,
  LogOut,
  Sparkles,
  Layers,
  Compass,
  CalendarCheck,
  NotebookText,
  type LucideIcon,
} from "lucide-react";
import { useAuth, type Role } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const NAV: Record<Role, { title: string; url: string; icon: LucideIcon }[]> = {
  student: [
    { title: "Beranda", url: "/dashboard", icon: LayoutDashboard },
    { title: "Mata Pelajaran", url: "/subjects", icon: BookOpen },
    { title: "Presensi Saya", url: "/my-attendance", icon: CalendarCheck },
    { title: "Nilai Saya", url: "/grades", icon: BarChart3 },
    { title: "Pengumuman", url: "/announcements", icon: Bell },
    { title: "Profil", url: "/profile", icon: User },
  ],
  teacher: [
    { title: "Beranda", url: "/dashboard", icon: LayoutDashboard },
    { title: "Kelola Kurikulum", url: "/curriculum", icon: Compass },
    { title: "Kelola Siswa & Kelas", url: "/roster", icon: Users },
    { title: "Kelola Pembelajaran", url: "/classroom", icon: BookOpen },
    { title: "Ruang Periksa", url: "/assessments", icon: ClipboardList },
    { title: "Presensi & Jurnal", url: "/attendance", icon: CalendarCheck },
    { title: "Buku Nilai", url: "/gradebook", icon: NotebookText },
    { title: "Pengumuman", url: "/announcements", icon: Bell },
    { title: "Profil", url: "/profile", icon: User },
  ],
  principal: [
    { title: "Beranda", url: "/dashboard", icon: LayoutDashboard },
    { title: "Kinerja Guru", url: "/teacher-monitoring", icon: GraduationCap },
    { title: "Monitoring Pembelajaran", url: "/students", icon: Users },
    { title: "Laporan Sekolah", url: "/grades", icon: BarChart3 },
    { title: "Pengumuman", url: "/announcements", icon: Bell },
    { title: "Profil", url: "/profile", icon: User },
  ],
  admin: [
    { title: "Beranda", url: "/dashboard", icon: LayoutDashboard },
    { title: "Manajemen Pengguna", url: "/users", icon: Users },
    { title: "Struktur Akademik", url: "/academic", icon: Building2 },
    { title: "Master Kelas", url: "/master-kelas", icon: Layers },
    { title: "Pengumuman", url: "/announcements", icon: Bell },
    { title: "Pengaturan", url: "/settings", icon: Settings },
    { title: "Profil", url: "/profile", icon: User },
  ],
};

function studentClassLabel(className?: string): string | null {
  if (!className) return null;
  const gradeNumber = className.match(/\d+/)?.[0];
  return gradeNumber ? `Siswa Kelas ${gradeNumber}` : null;
}

const ROLE_LABELS: Record<Role, string> = {
  student: "Siswa",
  teacher: "Guru",
  principal: "Kepala Sekolah",
  admin: "Admin",
};

export function AppSidebar({
  schoolName,
  logoUrl,
}: {
  schoolName?: string | null;
  logoUrl?: string | null;
}) {
  const { user, logout } = useAuth();
  const path = usePathname();
  const displaySchoolName = schoolName?.trim() || "Sekolah";
  if (!user) return null;
  const items = NAV[user.role];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border group-data-[collapsible=icon]:px-1">
        <Link
          href="/dashboard"
          aria-label={`Beranda ${displaySchoolName}`}
          className="flex min-w-0 items-center gap-2 px-2 py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0"
        >
          <div
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[10px] text-sidebar-primary-foreground group-data-[collapsible=icon]:size-8",
              logoUrl ? "bg-transparent" : "bg-sidebar-primary shadow-soft",
            )}
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`Logo ${displaySchoolName}`}
                className="h-full w-full object-contain"
              />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="break-words font-display text-base font-bold leading-tight text-sidebar-foreground">
              {displaySchoolName}
            </div>
            <div className="text-[10px] font-medium text-sidebar-foreground/60">LMS Sekolah</div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/60">Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((it) => {
                const active = path === it.url;
                return (
                  <SidebarMenuItem key={it.url}>
                    <SidebarMenuButton asChild isActive={active} tooltip={it.title}>
                      <Link href={it.url} className="flex items-center gap-3">
                        <it.icon className="h-4 w-4 shrink-0" />
                        <span>{it.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-sidebar-accent text-lg">
            {user.avatar ?? "🙂"}
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-medium text-sidebar-foreground">{user.name}</div>

            <div className="truncate text-[11px] uppercase tracking-wider text-sidebar-foreground/60">
              {user.role === "student"
                ? (studentClassLabel(user.className) ?? ROLE_LABELS.student)
                : ROLE_LABELS[user.role]}
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => logout()}
            className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
            aria-label="Keluar"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-3 pb-3 text-[10px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
          {displaySchoolName}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
