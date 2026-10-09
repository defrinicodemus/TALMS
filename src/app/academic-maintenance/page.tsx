import { redirect } from "next/navigation";
import { CalendarClock, LogOut, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/data/profile";
import { createClient } from "@/lib/supabase/server";
import { ACADEMIC_MAINTENANCE_MESSAGE, isAcademicAccessOpen } from "@/lib/auth/academic-access";
import { logout } from "../(app)/actions";

export default async function AcademicMaintenancePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "admin" || (await isAcademicAccessOpen(await createClient()))) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background bg-grain p-4 sm:p-8">
      <Card className="w-full max-w-lg space-y-6 border-0 p-6 text-center shadow-soft sm:p-10">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CalendarClock className="h-8 w-8" aria-hidden="true" />
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">LMS Sekolah</p>
          <h1 className="font-display text-2xl font-bold">Administrasi Pergantian Semester</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {ACADEMIC_MAINTENANCE_MESSAGE}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Silakan kembali setelah tahun ajaran diaktifkan oleh admin. Data pembelajaran sebelumnya
            tetap tersimpan.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild>
            <a href="/dashboard">
              <RefreshCw className="mr-2 h-4 w-4" />
              Cek Kembali
            </a>
          </Button>
          <form action={logout}>
            <Button type="submit" variant="outline" className="w-full">
              <LogOut className="mr-2 h-4 w-4" />
              Keluar
            </Button>
          </form>
        </div>
      </Card>
    </main>
  );
}
