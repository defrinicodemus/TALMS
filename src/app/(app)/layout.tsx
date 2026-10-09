import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { AuthProvider } from "@/lib/auth-context";
import { getCurrentUser } from "@/lib/data/profile";
import { getSchool } from "@/lib/data/school";
import { getNotificationsData } from "@/lib/data/announcements";
import { AcademicAccessWatcher } from "@/components/AcademicAccessWatcher";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { logout, markAnnouncementsSeen } from "./actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [user, school] = await Promise.all([getCurrentUser(), getSchool()]);
  if (!user) redirect("/login");

  const notifications = await getNotificationsData(user.id);
  const { data: activeYear } =
    user.role === "admin" && school
      ? await (
          await createClient()
        )
          .from("academic_years")
          .select("id")
          .eq("school_id", school.id)
          .eq("is_active", true)
          .maybeSingle()
      : { data: null };

  return (
    <AuthProvider user={user} logout={logout}>
      {user.role !== "admin" && <AcademicAccessWatcher />}
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-background bg-grain">
          <AppSidebar schoolName={school?.name ?? null} logoUrl={school?.logo_url ?? null} />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppHeader
              unreadCount={notifications.unreadCount}
              recentAnnouncements={notifications.recent}
              markSeen={markAnnouncementsSeen}
            />
            <main className="min-w-0 flex-1 p-4 md:p-8">
              {user.role === "admin" && !activeYear && (
                <div
                  className="mb-6 border border-primary/20 bg-primary/5 p-4 text-sm"
                  role="status"
                >
                  <p className="font-semibold">Masa administrasi pergantian semester</p>
                  <p className="mt-1 text-muted-foreground">
                    Akses Murid, Guru, dan Kepsek ditutup sementara. Perubahan penempatan langsung
                    tersimpan.
                  </p>
                  <Link
                    href="/academic"
                    className="mt-2 inline-block font-medium text-primary underline underline-offset-2"
                  >
                    Kelola dan aktifkan tahun ajaran
                  </Link>
                </div>
              )}
              {user.role === "student" && !user.classId && (
                <div
                  className="mb-6 border border-primary/20 bg-primary/5 p-4 text-sm"
                  role="status"
                >
                  <p className="font-semibold">Belum ada kelas pada tahun ajaran aktif</p>
                  <p className="mt-1 text-muted-foreground">
                    Hubungi admin sekolah untuk memeriksa penempatan kelasmu.
                  </p>
                </div>
              )}
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </AuthProvider>
  );
}
