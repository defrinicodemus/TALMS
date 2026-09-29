"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/data/profile";
import { assertRole } from "@/lib/auth/guard";
import { validateFileUpload } from "@/lib/validateUpload";

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

  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("id").limit(1).single();
  if (!school) return { ok: false, message: "Data sekolah tidak ditemukan." };

  const { error } = await supabase
    .from("schools")
    .update({ name, address, phone })
    .eq("id", school.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/settings");
  return { ok: true, message: "Profil sekolah berhasil disimpan." };
}

export async function uploadSchoolLogo(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) return { ok: false, message: "Pilih file logo dulu." };

  const validation = validateFileUpload(file, {
    allowedTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
    maxSizeMB: 2,
  });
  if (!validation.ok) return validation;

  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("id").limit(1).single();
  if (!school) return { ok: false, message: "Data sekolah tidak ditemukan." };

  const ext = file.name.split(".").pop() || "png";
  const path = `logo/${Date.now()}.${ext}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("school-assets")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) return { ok: false, message: uploadError.message };

  const {
    data: { publicUrl },
  } = admin.storage.from("school-assets").getPublicUrl(path);

  await supabase.from("schools").update({ logo_url: publicUrl }).eq("id", school.id);
  revalidatePath("/settings");
  revalidatePath("/login");

  return { ok: true, message: "Logo sekolah berhasil diperbarui." };
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ class_id: classId || null })
    .eq("id", studentId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/master-kelas");
  revalidatePath("/users");
  return {
    ok: true,
    message: classId ? "Siswa ditambahkan ke kelas." : "Siswa dikeluarkan dari kelas.",
  };
}

export async function promoteClasses(
  mappings: { sourceClassId: string; targetClassId: string; studentIds: string[] }[],
): Promise<{ ok: boolean; message: string }> {
  if (mappings.length === 0) {
    return { ok: false, message: "Pilih minimal satu pemetaan kelas." };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return { ok: false, message: "Tidak diizinkan." };
  }

  const supabase = await createClient();
  let studentsMoved = 0;
  let assignmentsCopied = 0;

  for (const { sourceClassId, targetClassId, studentIds } of mappings) {
    const uniqueStudentIds = [...new Set(studentIds)].filter(Boolean);
    if (uniqueStudentIds.length > 0) {
      const { data: movedStudents, error: moveError } = await supabase
        .from("profiles")
        .update({ class_id: targetClassId })
        .eq("role", "student")
        .eq("class_id", sourceClassId)
        .in("id", uniqueStudentIds)
        .select("id");

      if (moveError) return { ok: false, message: moveError.message };
      studentsMoved += movedStudents?.length ?? 0;
    }

    const { data: assignments } = await supabase
      .from("class_teacher_subjects")
      .select("subject_id, teacher_id")
      .eq("class_id", sourceClassId);

    if (assignments && assignments.length > 0) {
      const rows = assignments.map((a) => ({
        class_id: targetClassId,
        subject_id: a.subject_id,
        teacher_id: a.teacher_id,
      }));
      await supabase
        .from("class_teacher_subjects")
        .upsert(rows, { onConflict: "class_id,subject_id" });
      assignmentsCopied += rows.length;
    }
  }

  revalidatePath("/academic");
  revalidatePath("/master-kelas");
  revalidatePath("/users");
  revalidatePath("/dashboard");

  return {
    ok: true,
    message: `${studentsMoved} siswa dan ${assignmentsCopied} penugasan guru berhasil dipindahkan ke kelas baru.`,
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
    .insert({ school_id: school.id, year_label: yearLabel, semester });
  if (error) {
    return {
      ok: false,
      message: error.code === "23505" ? "Tahun ajaran & semester ini sudah ada." : error.message,
    };
  }

  revalidatePath("/academic");
  return { ok: true, message: "Tahun ajaran berhasil ditambahkan." };
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
  const { data: year } = await supabase
    .from("academic_years")
    .select("school_id")
    .eq("id", id)
    .single();
  if (!year) return { ok: false, message: "Tahun ajaran tidak ditemukan." };

  await supabase
    .from("academic_years")
    .update({ is_active: false })
    .eq("school_id", year.school_id);
  const { error } = await supabase.from("academic_years").update({ is_active: true }).eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/academic");
  return { ok: true, message: "Tahun ajaran aktif berhasil diganti." };
}
