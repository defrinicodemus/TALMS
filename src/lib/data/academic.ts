import { createClient } from "@/lib/supabase/server";

export async function getAcademicStructure() {
  const supabase = await createClient();
  const [classResult, subjectResult, yearResult, studentResult, assignmentResult] =
    await Promise.all([
      supabase
        .from("classes")
        .select("id, name, grade_level, academic_year_id")
        .order("grade_level"),
      supabase.from("subjects").select("id, code, name, emoji, min_grade, max_grade").order("name"),
      supabase
        .from("academic_years")
        .select("id, year_label, semester, is_active")
        .order("is_active", { ascending: false })
        .order("year_label", { ascending: false })
        .order("semester"),
      supabase
        .from("profiles")
        .select("id, full_name, nisn, class_id")
        .eq("role", "student")
        .order("full_name"),
      supabase.from("class_teacher_subjects").select("class_id, subject_id"),
    ]);
  if (
    [classResult, subjectResult, yearResult, studentResult, assignmentResult].some(
      (result) => result.error,
    )
  ) {
    throw new Error("Data struktur akademik belum dapat dimuat. Coba lagi.");
  }
  return {
    classes: classResult.data ?? [],
    subjects: subjectResult.data ?? [],
    years: yearResult.data ?? [],
    students: studentResult.data ?? [],
    assignments: assignmentResult.data ?? [],
  };
}
