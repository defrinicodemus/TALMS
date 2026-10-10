import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Share the school lookup between metadata, layout, and page in one request.
export const getSchool = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("schools")
    .select("id, name, tagline, address, phone, logo_url")
    .limit(1)
    .single();
  return data;
});

export async function listClasses() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("classes")
    .select(
      "id, name, grade_level, academic_year_id, academic_years(year_label, semester, is_active)",
    )
    .order("grade_level");
  return (data ?? [])
    .map((row) => {
      const year = row.academic_years as unknown as {
        year_label: string;
        semester: string;
        is_active: boolean;
      } | null;
      const yearLabel = year?.year_label ?? "Tahun ajaran tidak diketahui";
      const semester = year?.semester ?? "";
      const semesterLabel = semester === "ganjil" ? "Ganjil" : semester === "genap" ? "Genap" : "";
      return {
        id: row.id,
        name: row.name,
        grade_level: row.grade_level,
        academicYearId: row.academic_year_id,
        label: [row.name, yearLabel, semesterLabel].filter(Boolean).join(" · "),
        yearLabel,
        semester,
        isActive: year?.is_active ?? false,
      };
    })
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) ||
        b.yearLabel.localeCompare(a.yearLabel) ||
        a.semester.localeCompare(b.semester) ||
        a.grade_level - b.grade_level ||
        a.name.localeCompare(b.name),
    );
}

export async function listSubjects() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("subjects")
    .select("id, code, name, emoji, color")
    .order("name");
  return data ?? [];
}

export async function listAcademicYears() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("academic_years")
    .select("id, year_label, semester, is_active")
    .order("is_active", { ascending: false })
    .order("year_label", { ascending: false })
    .order("semester");
  return data ?? [];
}
