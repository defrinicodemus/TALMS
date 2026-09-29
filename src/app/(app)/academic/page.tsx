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
  const activeClasses = activeYear
    ? classes.filter((classRow) => classRow.academic_year_id === activeYear.id)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        icon="🏛️"
        title="Struktur Akademik"
        subtitle="Kelas, mata pelajaran, dan tahun ajaran"
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <ClassesManager classes={activeClasses} years={years} activeYear={activeYear} />
        <SubjectsManager subjects={subjects} />
      </div>
      <YearsManager years={years} />
      <PromoteClassesPanel classes={classes} years={years} students={students} />
    </div>
  );
}
