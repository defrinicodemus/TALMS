import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/guard";
import { getTeacherClassSubjects, getCurriculumPlan } from "@/lib/data/curriculum";
import { CurriculumManager } from "./CurriculumManager";

export default async function CurriculumPage() {
  const user = await requireRole(["teacher"]);

  const combos = await getTeacherClassSubjects(user.id);
  const plans = await Promise.all(combos.map((c) => getCurriculumPlan(c.classId, c.subjectId)));
  const plansByKey = Object.fromEntries(
    combos.map((c, i) => [`${c.classId}:${c.subjectId}`, plans[i]]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon="🧭"
        title="Kelola Kurikulum"
        subtitle="CP dan TP sebagai acuan materi, tugas, kuis, dan Learning Path siswa"
        rounded="blunt"
      />
      {combos.length === 0 ? (
        <Card className="rounded-md border-0 p-10 text-center shadow-soft">
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Anda belum ditugaskan mengajar kelas/mata pelajaran manapun. Hubungi admin untuk
            penugasan lewat Master Kelas.
          </p>
        </Card>
      ) : (
        <CurriculumManager combos={combos} plansByKey={plansByKey} />
      )}
    </div>
  );
}
