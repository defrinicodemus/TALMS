import { createClient } from "@/lib/supabase/server";
import { listAcademicYears, listClasses } from "./school";

export async function getMasterKelasData() {
  const supabase = await createClient();
  const [
    classes,
    years,
    { data: subjects },
    { data: teachers },
    { data: assignments },
    { data: students },
  ] = await Promise.all([
    listClasses(),
    listAcademicYears(),
    supabase.from("subjects").select("id, name, emoji, min_grade, max_grade").order("name"),
    supabase.from("profiles").select("id, full_name").eq("role", "teacher").order("full_name"),
    supabase.from("class_teacher_subjects").select("class_id, subject_id, teacher_id"),
    supabase
      .from("profiles")
      .select("id, full_name, nisn, class_id, classes!profiles_class_id_fkey(name)")
      .eq("role", "student")
      .order("full_name"),
  ]);

  const classLabels = new Map(classes.map((c) => [c.id, c.label]));
  return {
    classes,
    years,
    subjects: subjects ?? [],
    teachers: (teachers ?? []).map((t) => ({ id: t.id, name: t.full_name })),
    assignments: assignments ?? [],
    students: (students ?? []).map((s) => ({
      id: s.id,
      name: s.full_name,
      nisn: s.nisn as string | null,
      classId: s.class_id as string | null,
      className:
        classLabels.get(s.class_id) ??
        (s.classes as unknown as { name: string } | null)?.name ??
        null,
    })),
  };
}
