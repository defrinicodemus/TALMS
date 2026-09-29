"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/data/profile";
import { assertRole } from "@/lib/auth/guard";

const EMAIL_DOMAIN = "nggodimeda.sch.id";

type Result = { ok: boolean; message: string };

function friendlyAuthError(message: string, label: string): string {
  return message.toLowerCase().includes("already been registered")
    ? `${label} ini sudah dipakai akun lain.`
    : message;
}

export async function createStudent(formData: FormData): Promise<Result> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const name = String(formData.get("name") ?? "").trim();
  const nisn = String(formData.get("nisn") ?? "").trim();
  const classId = String(formData.get("class_id") ?? "");
  if (!name || !nisn) return { ok: false, message: "Nama dan NISN wajib diisi." };

  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("id").limit(1).single();
  if (!school) return { ok: false, message: "Data sekolah tidak ditemukan." };

  const initialProfile = {
    role: "student",
    full_name: name,
    username: nisn,
    nisn,
    class_id: classId || null,
    school_id: school.id,
  };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: `${nisn}@${EMAIL_DOMAIN}`,
    password: nisn,
    email_confirm: true,
    app_metadata: { lms_profile: initialProfile },
    // Keep the legacy payload during rollout; the hardened trigger trusts only app_metadata.
    user_metadata: initialProfile,
  });
  if (error) return { ok: false, message: friendlyAuthError(error.message, "NISN") };

  revalidatePath("/users");
  revalidatePath("/master-kelas");
  return { ok: true, message: "Siswa berhasil ditambahkan." };
}

export async function updateStudent(formData: FormData): Promise<Result> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const nisn = String(formData.get("nisn") ?? "").trim();
  const classId = String(formData.get("class_id") ?? "");
  if (!id || !name || !nisn) return { ok: false, message: "Nama dan NISN wajib diisi." };

  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.updateUserById(id, {
    email: `${nisn}@${EMAIL_DOMAIN}`,
  });
  if (authError) return { ok: false, message: friendlyAuthError(authError.message, "NISN") };

  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({ full_name: name, username: nisn, nisn, class_id: classId || null })
    .eq("id", id);

  revalidatePath("/users");
  revalidatePath("/master-kelas");
  return { ok: true, message: "Data siswa berhasil diperbarui." };
}

export async function deleteStudent(id: string): Promise<Result> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const supabase = await createClient();
  const [{ count: submissions }, { count: grades }] = await Promise.all([
    supabase.from("submissions").select("id", { count: "exact", head: true }).eq("student_id", id),
    supabase.from("grades").select("id", { count: "exact", head: true }).eq("student_id", id),
  ]);

  const blockers: string[] = [];
  if (submissions) blockers.push(`${submissions} tugas dikumpulkan`);
  if (grades) blockers.push(`${grades} nilai`);
  if (blockers.length > 0) {
    return { ok: false, message: `Tidak bisa dihapus — masih ada ${blockers.join(", ")}.` };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/users");
  revalidatePath("/master-kelas");
  return { ok: true, message: "Siswa berhasil dihapus." };
}

async function createStaffAccount(
  name: string,
  nip: string,
  role: "teacher" | "principal",
): Promise<Result> {
  if (!name || !nip) return { ok: false, message: "Nama dan NIP wajib diisi." };

  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("id").limit(1).single();
  if (!school) return { ok: false, message: "Data sekolah tidak ditemukan." };

  const initialProfile = { role, full_name: name, username: nip, nip, school_id: school.id };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: `${nip}@${EMAIL_DOMAIN}`,
    password: nip,
    email_confirm: true,
    app_metadata: { lms_profile: initialProfile },
    // Keep the legacy payload during rollout; the hardened trigger trusts only app_metadata.
    user_metadata: initialProfile,
  });
  if (error) return { ok: false, message: friendlyAuthError(error.message, "NIP") };

  revalidatePath("/users");
  return {
    ok: true,
    message:
      role === "teacher" ? "Guru berhasil ditambahkan." : "Kepala Sekolah berhasil ditambahkan.",
  };
}

export async function createTeacher(formData: FormData): Promise<Result> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const name = String(formData.get("name") ?? "").trim();
  const nip = String(formData.get("nip") ?? "").trim();
  return createStaffAccount(name, nip, "teacher");
}

export async function createPrincipal(formData: FormData): Promise<Result> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const name = String(formData.get("name") ?? "").trim();
  const nip = String(formData.get("nip") ?? "").trim();

  const supabase = await createClient();
  const { count: existing } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "principal");
  if (existing)
    return { ok: false, message: "Sudah ada Kepala Sekolah. Edit data yang sudah ada." };

  return createStaffAccount(name, nip, "principal");
}

export async function updateStaff(formData: FormData): Promise<Result> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const nip = String(formData.get("nip") ?? "").trim();
  if (!id || !name || !nip) return { ok: false, message: "Nama dan NIP wajib diisi." };

  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.updateUserById(id, {
    email: `${nip}@${EMAIL_DOMAIN}`,
  });
  if (authError) return { ok: false, message: friendlyAuthError(authError.message, "NIP") };

  const supabase = await createClient();
  await supabase.from("profiles").update({ full_name: name, username: nip, nip }).eq("id", id);

  revalidatePath("/users");
  return { ok: true, message: "Data berhasil diperbarui." };
}

export async function deleteTeacher(id: string): Promise<Result> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const supabase = await createClient();
  const { count: assignments } = await supabase
    .from("class_teacher_subjects")
    .select("id", { count: "exact", head: true })
    .eq("teacher_id", id);
  if (assignments) {
    return {
      ok: false,
      message: `Tidak bisa dihapus — masih ditugaskan mengajar ${assignments} kelas/mapel. Lepaskan dulu di Master Kelas.`,
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/users");
  return { ok: true, message: "Guru berhasil dihapus." };
}

export async function resetPasswordToDefault(id: string): Promise<Result> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["admin"]);
  if (roleError) return roleError;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, nisn, nip")
    .eq("id", id)
    .single();
  if (!profile) return { ok: false, message: "Pengguna tidak ditemukan." };

  const defaultPassword = profile.nisn ?? profile.nip;
  if (!defaultPassword) {
    return {
      ok: false,
      message: "Pengguna ini tidak punya NISN/NIP, tidak bisa direset otomatis.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, { password: defaultPassword });
  if (error) return { ok: false, message: error.message };

  return {
    ok: true,
    message: `Password ${profile.full_name} direset ke ${defaultPassword}.`,
  };
}
