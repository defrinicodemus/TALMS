import { createClient } from "@/lib/supabase/server";

export async function listStudents() {
  const supabase = await createClient();
  const { data: students } = await supabase
    .from("profiles")
    .select("id, full_name, nisn, class_id, classes!profiles_class_id_fkey(name)")
    .eq("role", "student")
    .order("full_name");

  return (students ?? []).map((s) => {
    return {
      id: s.id,
      name: s.full_name,
      nisn: s.nisn as string | null,
      classId: s.class_id as string | null,
      className: (s.classes as unknown as { name: string } | null)?.name ?? null,
    };
  });
}

export async function listTeachersWithTeaching() {
  const supabase = await createClient();
  const { data: teachers } = await supabase
    .from("profiles")
    .select("id, full_name, nip")
    .eq("role", "teacher")
    .order("full_name");

  const { data: cts } = await supabase
    .from("class_teacher_subjects")
    .select(
      "teacher_id, subjects(name), classes(name, academic_years(year_label, semester, is_active))",
    );

  const teachingByTeacher = new Map<
    string,
    { className: string; subjectName: string; periodLabel: string; isActive: boolean }[]
  >();
  for (const row of cts ?? []) {
    const subjectName = (row.subjects as unknown as { name: string } | null)?.name;
    const classroom = row.classes as unknown as {
      name: string;
      academic_years: { year_label: string; semester: string; is_active: boolean } | null;
    } | null;
    const className = classroom?.name;
    if (!subjectName || !className) continue;
    const list = teachingByTeacher.get(row.teacher_id) ?? [];
    const year = classroom?.academic_years;
    list.push({
      className,
      subjectName,
      periodLabel: year
        ? `${year.year_label} · ${year.semester === "ganjil" ? "Ganjil" : "Genap"}`
        : "Periode tidak diketahui",
      isActive: year?.is_active ?? false,
    });
    teachingByTeacher.set(row.teacher_id, list);
  }
  return (teachers ?? []).map((t) => {
    const teaching = (teachingByTeacher.get(t.id) ?? []).sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) ||
        b.periodLabel.localeCompare(a.periodLabel) ||
        a.className.localeCompare(b.className),
    );
    return {
      id: t.id,
      name: t.full_name,
      nip: t.nip as string | null,
      teaching,
    };
  });
}

export async function getPrincipal() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, nip")
    .eq("role", "principal")
    .maybeSingle();
  return data;
}

export async function listAllUsersForReset() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, nisn, nip")
    .order("full_name");

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name,
    role: p.role as string,
    identifier: p.nisn?.trim() || p.nip?.trim() || null,
  }));
}
