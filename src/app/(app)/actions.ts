"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/data/profile";
import { assertRole } from "@/lib/auth/guard";
import { SCHOOL_LOGO_UPLOAD, validateFileUpload } from "@/lib/validateUpload";
import type { StudentTransfer } from "@/lib/academic-transfers";

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function changePassword(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { ok: false, message: "Semua kolom wajib diisi." };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, message: "Konfirmasi kata sandi baru tidak cocok." };
  }
  if (newPassword.length < 6) {
    return { ok: false, message: "Kata sandi baru minimal 6 karakter." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: "Sesi tidak valid, silakan login ulang." };

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError) return { ok: false, message: "Kata sandi lama salah." };

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) return { ok: false, message: updateError.message };

  return { ok: true, message: "Kata sandi berhasil diubah." };
}

export async function updateOwnProfile(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) return { ok: false, message: "Sesi tidak valid, silakan login ulang." };

  const avatarEmoji = String(formData.get("avatar_emoji") ?? "").trim();
  if (!avatarEmoji) return { ok: false, message: "Pilih avatar terlebih dahulu." };

  const update: { avatar_emoji: string; full_name?: string } = { avatar_emoji: avatarEmoji };

  if (currentUser.role === "admin") {
    const fullName = String(formData.get("full_name") ?? "").trim();
    if (!fullName) return { ok: false, message: "Nama tidak boleh kosong." };
    update.full_name = fullName;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(update).eq("id", currentUser.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/profile");
  return { ok: true, message: "Profil berhasil diperbarui." };
}

export async function publishAnnouncement(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim() || "Umum";
  if (!title || !body) return { ok: false, message: "Judul dan isi pengumuman wajib diisi." };

  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return { ok: false, message: "Tidak diizinkan." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: school } = await supabase.from("schools").select("id").limit(1).single();
  if (!user || !school) return { ok: false, message: "Sesi tidak valid, silakan login ulang." };

  const { error } = await supabase.from("announcements").insert({
    school_id: school.id,
    author_id: user.id,
    title,
    body,
    category,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/announcements");
  revalidatePath("/dashboard");
  return { ok: true, message: "Pengumuman berhasil diterbitkan." };
}

export async function markAnnouncementsSeen() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("profiles")
    .update({ last_seen_announcements_at: new Date().toISOString() })
    .eq("id", user.id);
  revalidatePath("/", "layout");
}

export async function saveSchoolSettings(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!name) return { ok: false, message: "Nama sekolah wajib diisi." };

  try {
    const supabase = await createClient();
    const { data: school, error: readError } = await supabase
      .from("schools")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (readError) return { ok: false, message: "Data sekolah gagal diperiksa. Coba lagi." };
    if (!school) return { ok: false, message: "Data sekolah tidak ditemukan." };

    const { data: saved, error } = await supabase
      .from("schools")
      .update({ name, address, phone })
      .eq("id", school.id)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!saved)
      return { ok: false, message: "Profil sekolah belum tersimpan. Muat ulang dan coba lagi." };
  } catch {
    return {
      ok: false,
      message:
        "Hasil penyimpanan belum dapat dipastikan. Muat ulang dan periksa profil sekolah sebelum mencoba kembali.",
    };
  }

  revalidatePath("/", "layout");
  return { ok: true, message: "Profil sekolah berhasil disimpan." };
}

export async function uploadSchoolLogo(
  formData: FormData,
): Promise<{ ok: boolean; message: string; logoUrl?: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, message: "Pilih file logo dulu." };

  const validation = validateFileUpload(file, SCHOOL_LOGO_UPLOAD);
  if (!validation.ok) return validation;

  try {
    const supabase = await createClient();
    const { data: school, error: readError } = await supabase
      .from("schools")
      .select("id, logo_url")
      .limit(1)
      .maybeSingle();
    if (readError) return { ok: false, message: "Data sekolah gagal diperiksa. Coba lagi." };
    if (!school) return { ok: false, message: "Data sekolah tidak ditemukan." };

    const extensions: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/svg+xml": "svg",
    };
    const path = `logo/${school.id}/${crypto.randomUUID()}.${extensions[file.type]}`;
    const storage = createAdminClient().storage.from("school-assets");
    const { error: uploadError } = await storage.upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) return { ok: false, message: uploadError.message };
    const {
      data: { publicUrl },
    } = storage.getPublicUrl(path);

    let saved = false;
    let failureMessage = "Logo telah berubah. Muat ulang sebelum menggantinya kembali.";
    try {
      let update = supabase.from("schools").update({ logo_url: publicUrl }).eq("id", school.id);
      update =
        school.logo_url === null
          ? update.is("logo_url", null)
          : update.eq("logo_url", school.logo_url);
      const result = await update.select("id").maybeSingle();
      saved = !result.error && Boolean(result.data);
      if (result.error) failureMessage = result.error.message;
    } catch {
      failureMessage = "Koneksi terputus saat menyimpan logo.";
    }

    if (!saved) {
      // A lost response can follow a committed update. Never delete the new
      // object until we know it is not the school's saved logo.
      const { data: current, error: verifyError } = await supabase
        .from("schools")
        .select("logo_url")
        .eq("id", school.id)
        .maybeSingle();
      if (verifyError || !current) {
        return {
          ok: false,
          message:
            "Status logo belum dapat dipastikan. Muat ulang dan periksa logo sebelum mencoba kembali.",
        };
      }
      saved = current.logo_url === publicUrl;
      if (!saved) {
        let cleaned = false;
        try {
          const { error: cleanupError } = await storage.remove([path]);
          cleaned = !cleanupError;
        } catch {
          /* Report incomplete cleanup without touching the previous logo. */
        }
        return {
          ok: false,
          message: `Logo belum tersimpan. ${failureMessage}${cleaned ? "" : " File unggahan sementara belum dapat dibersihkan."}`,
        };
      }
    }

    revalidatePath("/", "layout");
    return { ok: true, message: "Logo sekolah berhasil diperbarui.", logoUrl: publicUrl };
  } catch {
    return {
      ok: false,
      message:
        "Status unggahan belum dapat dipastikan. Muat ulang dan periksa logo sebelum mencoba kembali.",
    };
  }
}

export async function createClass(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const name = String(formData.get("name") ?? "").trim();
  const gradeLevel = Number(formData.get("grade_level"));
  const academicYearId = String(formData.get("academic_year_id") ?? "");
  if (!name || !gradeLevel || !academicYearId) {
    return { ok: false, message: "Nama kelas, tingkat, dan tahun ajaran wajib diisi." };
  }

  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("id").limit(1).single();
  if (!school) return { ok: false, message: "Data sekolah tidak ditemukan." };

  const { error } = await supabase.from("classes").insert({
    school_id: school.id,
    academic_year_id: academicYearId,
    name,
    grade_level: gradeLevel,
  });
  if (error) {
    return {
      ok: false,
      message:
        error.code === "23505"
          ? "Nama kelas ini sudah dipakai di tahun ajaran tersebut."
          : error.message,
    };
  }

  revalidatePath("/academic");
  revalidatePath("/master-kelas");
  revalidatePath("/users");
  return { ok: true, message: "Kelas berhasil ditambahkan." };
}

export async function updateClass(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const gradeLevel = Number(formData.get("grade_level"));
  if (!id || !name || !gradeLevel) {
    return { ok: false, message: "Nama kelas dan tingkat wajib diisi." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("classes")
    .update({ name, grade_level: gradeLevel })
    .eq("id", id);
  if (error) {
    return {
      ok: false,
      message:
        error.code === "23505"
          ? "Nama kelas ini sudah dipakai di tahun ajaran tersebut."
          : error.message,
    };
  }

  revalidatePath("/academic");
  revalidatePath("/master-kelas");
  revalidatePath("/users");
  return { ok: true, message: "Kelas berhasil diperbarui." };
}

export async function deleteClass(id: string): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const supabase = await createClient();

  const [
    { count: students },
    { count: materials },
    { count: assignments },
    { count: grades },
    { count: teacherAssignments },
    { count: announcements },
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("class_id", id),
    supabase.from("materials").select("id", { count: "exact", head: true }).eq("class_id", id),
    supabase.from("assignments").select("id", { count: "exact", head: true }).eq("class_id", id),
    supabase.from("grades").select("id", { count: "exact", head: true }).eq("class_id", id),
    supabase
      .from("class_teacher_subjects")
      .select("id", { count: "exact", head: true })
      .eq("class_id", id),
    supabase
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .eq("target_class_id", id),
  ]);

  const blockers: string[] = [];
  if (students) blockers.push(`${students} siswa`);
  if (materials) blockers.push(`${materials} materi`);
  if (assignments) blockers.push(`${assignments} tugas`);
  if (grades) blockers.push(`${grades} nilai`);
  if (teacherAssignments) blockers.push(`${teacherAssignments} penugasan guru`);
  if (announcements) blockers.push(`${announcements} pengumuman`);

  if (blockers.length > 0) {
    return {
      ok: false,
      message: `Tidak bisa dihapus — masih dipakai oleh ${blockers.join(", ")}.`,
    };
  }

  await supabase.from("classes").delete().eq("id", id);
  revalidatePath("/academic");
  revalidatePath("/master-kelas");
  revalidatePath("/users");
  return { ok: true, message: "Kelas berhasil dihapus." };
}

export async function deleteSubject(id: string): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const supabase = await createClient();

  const [
    { count: materials },
    { count: assignments },
    { count: grades },
    { count: assignedTeachers },
  ] = await Promise.all([
    supabase.from("materials").select("id", { count: "exact", head: true }).eq("subject_id", id),
    supabase.from("assignments").select("id", { count: "exact", head: true }).eq("subject_id", id),
    supabase.from("grades").select("id", { count: "exact", head: true }).eq("subject_id", id),
    supabase
      .from("class_teacher_subjects")
      .select("id", { count: "exact", head: true })
      .eq("subject_id", id),
  ]);

  const blockers: string[] = [];
  if (materials) blockers.push(`${materials} materi`);
  if (assignments) blockers.push(`${assignments} tugas`);
  if (grades) blockers.push(`${grades} nilai`);
  if (assignedTeachers) blockers.push(`${assignedTeachers} penugasan guru`);

  if (blockers.length > 0) {
    return {
      ok: false,
      message: `Tidak bisa dihapus — masih dipakai oleh ${blockers.join(", ")}.`,
    };
  }

  await supabase.from("subjects").delete().eq("id", id);
  revalidatePath("/academic");
  return { ok: true, message: "Mata pelajaran berhasil dihapus." };
}

export async function deleteAcademicYear(id: string): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const supabase = await createClient();

  const { data: year } = await supabase
    .from("academic_years")
    .select("is_active")
    .eq("id", id)
    .single();
  if (year?.is_active) {
    return {
      ok: false,
      message:
        "Tidak bisa menghapus tahun ajaran yang sedang aktif. Aktifkan tahun ajaran lain dulu.",
    };
  }

  const { count: classes } = await supabase
    .from("classes")
    .select("id", { count: "exact", head: true })
    .eq("academic_year_id", id);

  if (classes) {
    return { ok: false, message: `Tidak bisa dihapus — masih dipakai oleh ${classes} kelas.` };
  }

  await supabase.from("academic_years").delete().eq("id", id);
  revalidatePath("/academic");
  return { ok: true, message: "Tahun ajaran berhasil dihapus." };
}

const SUBJECT_COLOR_PALETTE = [
  "oklch(0.78 0.14 50)",
  "oklch(0.7 0.14 195)",
  "oklch(0.7 0.16 25)",
  "oklch(0.65 0.18 145)",
  "oklch(0.72 0.12 280)",
  "oklch(0.72 0.16 330)",
];

function parseGrade(formData: FormData, field: string): number | null {
  const raw = String(formData.get(field) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function createSubject(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const emoji = String(formData.get("emoji") ?? "").trim();
  const minGrade = parseGrade(formData, "min_grade");
  const maxGrade = parseGrade(formData, "max_grade");
  if (!code || !name) {
    return { ok: false, message: "Kode dan nama mata pelajaran wajib diisi." };
  }

  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("id").limit(1).single();
  if (!school) return { ok: false, message: "Data sekolah tidak ditemukan." };

  const { count } = await supabase
    .from("subjects")
    .select("id", { count: "exact", head: true })
    .eq("school_id", school.id);
  const color = SUBJECT_COLOR_PALETTE[(count ?? 0) % SUBJECT_COLOR_PALETTE.length];

  const { error } = await supabase.from("subjects").insert({
    school_id: school.id,
    code,
    name,
    emoji: emoji || null,
    color,
    min_grade: minGrade,
    max_grade: maxGrade,
  });
  if (error) {
    return {
      ok: false,
      message: error.code === "23505" ? "Kode mata pelajaran ini sudah dipakai." : error.message,
    };
  }

  revalidatePath("/academic");
  return { ok: true, message: "Mata pelajaran berhasil ditambahkan." };
}

export async function updateSubject(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const emoji = String(formData.get("emoji") ?? "").trim();
  const minGrade = parseGrade(formData, "min_grade");
  const maxGrade = parseGrade(formData, "max_grade");
  if (!id || !name) return { ok: false, message: "Nama mata pelajaran wajib diisi." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("subjects")
    .update({ name, emoji: emoji || null, min_grade: minGrade, max_grade: maxGrade })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/academic");
  return { ok: true, message: "Mata pelajaran berhasil diperbarui." };
}

export async function setClassSubjectTeacher(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const classId = String(formData.get("class_id") ?? "");
  const subjectId = String(formData.get("subject_id") ?? "");
  const teacherId = String(formData.get("teacher_id") ?? "");
  if (!classId || !subjectId) {
    return { ok: false, message: "Kelas dan mata pelajaran wajib dipilih." };
  }

  const supabase = await createClient();
  if (!teacherId) {
    const { error } = await supabase
      .from("class_teacher_subjects")
      .delete()
      .eq("class_id", classId)
      .eq("subject_id", subjectId);
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase
      .from("class_teacher_subjects")
      .upsert(
        { class_id: classId, subject_id: subjectId, teacher_id: teacherId },
        { onConflict: "class_id,subject_id" },
      );
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath("/master-kelas");
  return { ok: true, message: "Penugasan guru disimpan." };
}

export async function assignStudentToClass(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const studentId = String(formData.get("student_id") ?? "");
  const classId = String(formData.get("class_id") ?? "");
  if (!studentId) return { ok: false, message: "Siswa tidak valid." };

  if (!formData.has("expected_class_id")) {
    return { ok: false, message: "Muat ulang halaman untuk memeriksa penempatan siswa terbaru." };
  }
  const previousClassId = String(formData.get("expected_class_id") ?? "");
  if (
    classId &&
    previousClassId &&
    classId !== previousClassId &&
    formData.get("confirm_move") !== "true"
  ) {
    return { ok: false, message: "Konfirmasikan perpindahan siswa dari kelas sebelumnya." };
  }

  const supabase = await createClient();
  let update = supabase
    .from("profiles")
    .update({ class_id: classId || null })
    .eq("id", studentId)
    .eq("role", "student");
  update = previousClassId ? update.eq("class_id", previousClassId) : update.is("class_id", null);
  const { data: saved, error } = await update.select("id").maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!saved)
    return {
      ok: false,
      message: "Penempatan siswa telah berubah atau siswa tidak ditemukan. Muat ulang halaman.",
    };

  revalidatePath("/master-kelas");
  revalidatePath("/users");
  return {
    ok: true,
    message: classId ? "Siswa ditambahkan ke kelas." : "Siswa dikeluarkan dari kelas.",
  };
}

export async function promoteClasses(
  input: StudentTransfer,
): Promise<{ ok: boolean; message: string }> {
  const roleError = assertRole(await getCurrentUser(), ["admin"]);
  if (roleError) return roleError;
  if (
    !input ||
    !["semester", "promotion"].includes(input.kind) ||
    !input.sourceYearId ||
    !input.targetYearId ||
    input.sourceYearId === input.targetYearId ||
    !Array.isArray(input.mappings) ||
    input.mappings.length === 0 ||
    input.mappings.some(
      (m) =>
        !m?.sourceClassId ||
        !m.targetClassId ||
        !Array.isArray(m.studentIds) ||
        m.studentIds.length === 0,
    )
  ) {
    return {
      ok: false,
      message: "Pilih periode, kelas tujuan, dan minimal satu siswa yang valid.",
    };
  }

  const supabase = await createClient();
  // The RPC checks the school's administration mode and all placements under
  // the same lock used for activation, then commits every move atomically.
  const { data: studentsMoved, error } = await supabase.rpc("transfer_academic_students", {
    p_kind: input.kind,
    p_source_year_id: input.sourceYearId,
    p_target_year_id: input.targetYearId,
    p_mappings: input.mappings,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/academic");
  revalidatePath("/master-kelas");
  revalidatePath("/users");
  revalidatePath("/dashboard");

  return {
    ok: true,
    message: `${studentsMoved} siswa berhasil dipindahkan. Periode tujuan tetap belum aktif.`,
  };
}

export async function createAcademicYear(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const yearLabel = String(formData.get("year_label") ?? "").trim();
  const semester = String(formData.get("semester") ?? "");
  if (!yearLabel || (semester !== "ganjil" && semester !== "genap")) {
    return { ok: false, message: "Tahun ajaran dan semester wajib diisi." };
  }

  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("id").limit(1).single();
  if (!school) return { ok: false, message: "Data sekolah tidak ditemukan." };

  const { error } = await supabase
    .from("academic_years")
    .insert({ school_id: school.id, year_label: yearLabel, semester, is_active: false });
  if (error) {
    return {
      ok: false,
      message: error.code === "23505" ? "Tahun ajaran & semester ini sudah ada." : error.message,
    };
  }

  revalidatePath("/academic");
  return { ok: true, message: "Tahun ajaran ditambahkan dengan status Belum Aktif." };
}

export async function setActiveAcademicYear(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Tahun ajaran tidak valid." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_active_academic_year", { p_id: id });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/academic");
  revalidatePath("/master-kelas");
  revalidatePath("/users");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { ok: true, message: "Tahun ajaran aktif berhasil diganti." };
}

export async function deactivateAcademicYear(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const roleError = assertRole(await getCurrentUser(), ["admin"]);
  if (roleError) return roleError;
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Tahun ajaran tidak valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("deactivate_academic_year", { p_id: id });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Tahun ajaran dinonaktifkan. Masa administrasi dimulai." };
}
