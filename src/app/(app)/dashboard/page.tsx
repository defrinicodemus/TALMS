import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/data/profile";
import {
  getStudentDashboardData,
  getPrincipalDashboardData,
  getAdminDashboardData,
  getTeacherDashboardData,
} from "@/lib/data/dashboard";
import { getSchool } from "@/lib/data/school";
import { getTeacherClassSubjects } from "@/lib/data/teaching";
import { StudentDashboard } from "@/components/dashboards/StudentDashboard";
import { TeacherDashboard } from "@/components/dashboards/TeacherDashboard";
import { PrincipalDashboard } from "@/components/dashboards/PrincipalDashboard";
import { AdminDashboard } from "@/components/dashboards/AdminDashboard";
import { PageEntranceAnimation } from "@/components/PageEntranceAnimation";

export const metadata: Metadata = { title: "Beranda" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (user.role === "student") {
    const data = await getStudentDashboardData(user.id, user.classId ?? null);
    return (
      <PageEntranceAnimation>
        <StudentDashboard data={data} />
      </PageEntranceAnimation>
    );
  }

  if (user.role === "teacher") {
    const [school, combos] = await Promise.all([getSchool(), getTeacherClassSubjects(user.id)]);
    const classIds = [...new Set(combos.map((c) => c.classId))];
    const data = await getTeacherDashboardData(user.id, classIds, combos);
    return (
      <PageEntranceAnimation>
        <TeacherDashboard
          userName={user.name}
          schoolName={school?.name ?? null}
          combos={combos}
          data={data}
        />
      </PageEntranceAnimation>
    );
  }

  if (user.role === "principal") {
    const data = await getPrincipalDashboardData();
    return (
      <PageEntranceAnimation>
        <PrincipalDashboard data={data} />
      </PageEntranceAnimation>
    );
  }

  const data = await getAdminDashboardData();
  return (
    <PageEntranceAnimation>
      <AdminDashboard data={data} />
    </PageEntranceAnimation>
  );
}
