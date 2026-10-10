import { createClient } from "@/lib/supabase/server";
import { round2 } from "@/lib/data/gradebook";

export async function listStudentsWithAvg() {
  const supabase = await createClient();
  const { data: students } = await supabase
    .from("profiles")
    .select("id, full_name, nisn, class_id, classes!profiles_class_id_fkey(name)")
    .eq("role", "student")
    .order("full_name");

  const { data: grades } = await supabase.from("grades").select("student_id, score");
  const avgByStudent = new Map<string, { sum: number; count: number }>();
  for (const g of grades ?? []) {
    const acc = avgByStudent.get(g.student_id) ?? { sum: 0, count: 0 };
    acc.sum += Number(g.score);
    acc.count += 1;
    avgByStudent.set(g.student_id, acc);
  }

  return (students ?? []).map((s) => {
    const acc = avgByStudent.get(s.id);
    return {
      id: s.id,
      name: s.full_name,
      nisn: s.nisn as string | null,
      classId: s.class_id as string | null,
      className: (s.classes as unknown as { name: string } | null)?.name ?? null,
      avg: acc ? round2(acc.sum / acc.count) : null,
    };
  });
}

export async function listTeachersWithStats() {
  const supabase = await createClient();
  const { data: teachers } = await supabase
    .from("profiles")
    .select("id, full_name, nip")
    .eq("role", "teacher")
    .order("full_name");

  const [{ data: cts }, { data: materials }, { data: assignments }] = await Promise.all([
    supabase
      .from("class_teacher_subjects")
      .select(
        "teacher_id, subjects(name), classes(name, academic_years(year_label, semester, is_active))",
      ),
    supabase.from("materials").select("teacher_id"),
    supabase.from("assignments").select("teacher_id"),
  ]);

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
  const countBy = (rows: { teacher_id: string | null }[] | null | undefined) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      if (!r.teacher_id) continue;
      m.set(r.teacher_id, (m.get(r.teacher_id) ?? 0) + 1);
    }
    return m;
  };
  const materialCount = countBy(materials);
  const assignmentCount = countBy(assignments);

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
      subject: teaching[0]?.subjectName ?? "-",
      teaching,
      materials: materialCount.get(t.id) ?? 0,
      quizzes: assignmentCount.get(t.id) ?? 0,
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

export async function countUsersByRole() {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("role");
  const counts = { student: 0, teacher: 0, principal: 0, admin: 0 };
  for (const row of data ?? []) counts[row.role as keyof typeof counts]++;
  return counts;
}
