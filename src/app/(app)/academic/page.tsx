import { PageHeader } from "@/components/PageHeader";
import { getAcademicStructure } from "@/lib/data/academic";
import { requireRole } from "@/lib/auth/guard";
import { ClassesManager } from "./ClassesManager";
import { SubjectsManager } from "./SubjectsManager";
import { YearsManager } from "./YearsManager";
import { PromoteClassesPanel } from "./PromoteClassesPanel";

export default async function AcademicPage() {
  await requireRole(["admin"]);

  const { classes, subjects, years, students } = await getAcademicStructure();
  const activeYear = years.find((year) => year.is_active) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon="🏛️"
        title="Struktur Akademik"
        subtitle="Kelola tahun ajaran, kelas, dan mata pelajaran sekolah"
        rounded="none"
      />
      <YearsManager years={years} classes={classes} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ClassesManager classes={classes} years={years} activeYear={activeYear} />
        <SubjectsManager subjects={subjects} />
      </div>
      <PromoteClassesPanel classes={classes} years={years} students={students} />
    </div>
  );
}
