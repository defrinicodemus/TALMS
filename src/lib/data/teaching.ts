import { createClient } from "@/lib/supabase/server";

export interface TeacherClassSubject {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
}

export async function getTeacherClassSubjects(teacherId: string): Promise<TeacherClassSubject[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("class_teacher_subjects")
    .select(
      "class_id, subject_id, classes!inner(name, academic_years!inner(is_active)), subjects(name)",
    )
    .eq("teacher_id", teacherId)
    .eq("classes.academic_years.is_active", true);

  return (data ?? [])
    .map((row) => ({
      classId: row.class_id,
      className: (row.classes as unknown as { name: string } | null)?.name ?? "-",
      subjectId: row.subject_id,
      subjectName: (row.subjects as unknown as { name: string } | null)?.name ?? "-",
    }))
    .sort(
      (a, b) =>
        a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName),
    );
}
