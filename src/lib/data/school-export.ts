import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ExportPeriod = {
  id: string;
  year_label: string;
  semester: "ganjil" | "genap";
};
type School = { id: string; name: string; address: string | null; phone: string | null };
type ExportClass = {
  id: string;
  name: string;
  grade_level: number;
};
type Student = { id: string; full_name: string; nisn: string | null; class_id: string };
type Staff = { id: string; full_name: string; nip: string | null; role: "teacher" | "principal" };
type Subject = { id: string; name: string; code: string | null };
type Assignment = { id: string; class_id: string; subject_id: string; teacher_id: string };

export type SchoolExportData = {
  school: School;
  period: ExportPeriod;
  classes: ExportClass[];
  students: Student[];
  staff: Staff[];
  subjects: Subject[];
  assignments: Assignment[];
};

export class SchoolExportError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export async function getActiveExportPeriod(client: SupabaseClient, schoolId: string) {
  const { data, error } = await client
    .from("academic_years")
    .select("id, year_label, semester")
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new SchoolExportError("Tahun ajaran aktif belum dapat diperiksa. Coba lagi.");
  return data as ExportPeriod | null;
}

// Resolve the school from the authenticated admin, never from a request parameter.
export async function getSchoolExportContext(client: SupabaseClient, adminId: string) {
  const { data: admin, error: adminError } = await client
    .from("profiles")
    .select("school_id, role")
    .eq("id", adminId)
    .maybeSingle();
  if (adminError) throw new SchoolExportError("Akses ekspor belum dapat diperiksa. Coba lagi.");
  if (!admin || admin.role !== "admin")
    throw new SchoolExportError("Hanya Admin yang dapat mengekspor data sekolah.", 403);
  if (!admin.school_id)
    throw new SchoolExportError("Akun Admin belum terhubung dengan sekolah.", 409);

  const [{ data: school, error }, period] = await Promise.all([
    client.from("schools").select("id, name, address, phone").eq("id", admin.school_id).single(),
    getActiveExportPeriod(client, admin.school_id),
  ]);
  if (error || !school)
    throw new SchoolExportError("Profil sekolah belum dapat dibaca. Coba lagi.");
  return { school: school as School, period };
}

// Explicit paging avoids silently truncating exports at Supabase's response limit.
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error || !data)
      throw new SchoolExportError(
        "Data sekolah belum berhasil dibaca seluruhnya. Coba unduh lagi.",
        500,
        { cause: error },
      );
    rows.push(...(data as T[]));
    if (data.length < pageSize) return rows;
  }
}

// Keep IN filters short even when a school has many classes.
async function readByClasses<T>(
  classIds: string[],
  page: (
    ids: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  for (let start = 0; start < classIds.length; start += 100) {
    const ids = classIds.slice(start, start + 100);
    rows.push(...(await readAll<T>((from, to) => page(ids, from, to))));
  }
  return rows;
}

export async function readSchoolExportData(
  client: SupabaseClient,
  school: School,
  period: ExportPeriod,
): Promise<SchoolExportData> {
  const classes = await readAll<ExportClass>((from, to) =>
    client
      .from("classes")
      .select("id, name, grade_level")
      .eq("school_id", school.id)
      .eq("academic_year_id", period.id)
      .order("id")
      .range(from, to),
  );
  const classIds = classes.map((row) => row.id);
  const [students, assignments, allStaff, allSubjects] = await Promise.all([
    readByClasses<Student>(classIds, (ids, from, to) =>
      client
        .from("profiles")
        .select("id, full_name, nisn, class_id")
        .eq("school_id", school.id)
        .eq("role", "student")
        .in("class_id", ids)
        .order("id")
        .range(from, to),
    ),
    readByClasses<Assignment>(classIds, (ids, from, to) =>
      client
        .from("class_teacher_subjects")
        .select("id, class_id, subject_id, teacher_id")
        .in("class_id", ids)
        .order("id")
        .range(from, to),
    ),
    readAll<Staff>((from, to) =>
      client
        .from("profiles")
        .select("id, full_name, nip, role")
        .eq("school_id", school.id)
        .in("role", ["teacher", "principal"])
        .order("id")
        .range(from, to),
    ),
    readAll<Subject>((from, to) =>
      client
        .from("subjects")
        .select("id, name, code")
        .eq("school_id", school.id)
        .order("id")
        .range(from, to),
    ),
  ]);
  const teacherIds = new Set(assignments.map((row) => row.teacher_id));
  const subjectIds = new Set(assignments.map((row) => row.subject_id));
  const staff = allStaff.filter((row) => row.role === "principal" || teacherIds.has(row.id));
  const subjects = allSubjects.filter((row) => subjectIds.has(row.id));
  const availableTeachers = new Set(
    staff.filter((row) => row.role === "teacher").map((row) => row.id),
  );
  if (
    [...teacherIds].some((id) => !availableTeachers.has(id)) ||
    subjects.length !== subjectIds.size
  )
    throw new SchoolExportError(
      "Relasi penugasan guru belum lengkap. Periksa Master Kelas lalu coba lagi.",
      409,
    );

  return { school, period, classes, students, staff, subjects, assignments };
}

export async function assertExportPeriodUnchanged(
  client: SupabaseClient,
  schoolId: string,
  period: ExportPeriod,
) {
  const current = await getActiveExportPeriod(client, schoolId);
  if (
    !current ||
    current.id !== period.id ||
    current.year_label !== period.year_label ||
    current.semester !== period.semester
  )
    throw new SchoolExportError(
      "Tahun ajaran aktif berubah saat ekspor. Muat ulang halaman lalu unduh kembali.",
      409,
    );
}
