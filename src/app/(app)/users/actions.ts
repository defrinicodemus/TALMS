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

// Auth and public.profiles cannot share a transaction through these APIs.
// Check both writes and compensate an Auth change if the profile write fails.
async function updateAccountIdentity(
  id: string,
  values: Record<string, string | null>,
  allowedRoles: string[],
  identifierLabel: string,
): Promise<Result> {
  const uncertain = {
    ok: false,
    message:
      "Penyimpanan belum dapat dipastikan atau dipulihkan sepenuhnya. Muat ulang dan periksa identitas login serta data pengguna sebelum mencoba kembali.",
  };
  try {
    const supabase = await createClient();
    const { data: previous, error: readError } = await supabase
      .from("profiles")
      .select("id, role, full_name, username, nisn, nip, class_id, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (readError) return { ok: false, message: "Data pengguna gagal diperiksa. Coba lagi." };
    if (!previous || !allowedRoles.includes(previous.role)) {
      return { ok: false, message: "Pengguna tidak ditemukan atau jenis akun tidak sesuai." };
    }

    const admin = createAdminClient();
    const { data: authData, error: authReadError } = await admin.auth.admin.getUserById(id);
    const oldEmail = authData?.user?.email;
    if (authReadError || !oldEmail) {
      return {
        ok: false,
        message: "Identitas login gagal diperiksa. Belum ada perubahan disimpan.",
      };
    }
    const newEmail = `${values.username}@${EMAIL_DOMAIN}`;
    const changedEmail = oldEmail !== newEmail;
    if (changedEmail) {
      const { error } = await admin.auth.admin.updateUserById(id, { email: newEmail });
      if (error) return { ok: false, message: friendlyAuthError(error.message, identifierLabel) };
    }

    let failureMessage = "Data pengguna telah berubah. Muat ulang sebelum menyimpan kembali.";
    try {
      const { data: saved, error } = await supabase
        .from("profiles")
        .update(values)
        .eq("id", id)
        .eq("updated_at", previous.updated_at)
        .select("id")
        .maybeSingle();
      if (!error && saved) return { ok: true, message: "Data berhasil diperbarui." };
      if (error) failureMessage = error.message;
    } catch {
      failureMessage = "Koneksi terputus saat menyimpan data pengguna.";
    }

    // A failed response can arrive after a committed write. Read back before
    // rolling back so we never knowingly undo Auth for an already-saved profile.
    const { data: current, error: verifyError } = await supabase
      .from("profiles")
      .select("full_name, username, nisn, nip, class_id")
      .eq("id", id)
      .maybeSingle();
    if (verifyError || !current) return uncertain;
    const { data: currentAuth, error: verifyAuthError } = await admin.auth.admin.getUserById(id);
    if (verifyAuthError || !currentAuth?.user?.email) return uncertain;
    if (
      Object.entries(values).every(
        ([key, value]) => current[key as keyof typeof current] === value,
      ) &&
      currentAuth.user.email === newEmail
    ) {
      return { ok: true, message: "Data berhasil diperbarui." };
    }

    if (changedEmail) {
      // Do not overwrite another administrator's concurrent identity change.
      if (current.username !== previous.username) return uncertain;
      if (currentAuth.user.email === newEmail) {
        const { error: rollbackError } = await admin.auth.admin.updateUserById(id, {
          email: oldEmail,
        });
        if (rollbackError) return uncertain;
      } else if (currentAuth.user.email !== oldEmail) return uncertain;
    }
    return {
      ok: false,
      message: `Data belum berhasil disimpan. ${failureMessage}${changedEmail ? " Identitas login telah dikembalikan seperti sebelumnya." : ""}`,
    };
  } catch {
    return uncertain;
  }
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

  const result = await updateAccountIdentity(
    id,
    { full_name: name, username: nisn, nisn, class_id: classId || null },
    ["student"],
    "NISN",
  );
  if (!result.ok) return result;

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

  const result = await updateAccountIdentity(
    id,
    { full_name: name, username: nip, nip },
    ["teacher", "principal"],
    "NIP",
  );
  if (!result.ok) return result;

  revalidatePath("/users");
  revalidatePath("/master-kelas");
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

  if (!id.trim()) return { ok: false, message: "Pilih pengguna yang akan direset." };
  try {
    const supabase = await createClient();
    const { data: profile, error: readError } = await supabase
      .from("profiles")
      .select("full_name, nisn, nip")
      .eq("id", id)
      .maybeSingle();
    if (readError) return { ok: false, message: "Data pengguna gagal diperiksa. Coba lagi." };
    if (!profile) return { ok: false, message: "Pengguna tidak ditemukan." };

    const defaultPassword = profile.nisn?.trim() || profile.nip?.trim();
    if (!defaultPassword) {
      return {
        ok: false,
        message: "Pengguna ini tidak punya NISN/NIP, tidak bisa direset otomatis.",
      };
    }

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.updateUserById(id, {
      password: defaultPassword,
    });
    if (error) return { ok: false, message: error.message };
    if (!data?.user)
      return {
        ok: false,
        message: "Hasil reset belum dapat dipastikan. Periksa akun sebelum mencoba kembali.",
      };

    return {
      ok: true,
      message: `Password ${profile.full_name} berhasil direset ke NISN/NIP. Minta pengguna segera mengganti password setelah masuk.`,
    };
  } catch {
    return {
      ok: false,
      message: "Hasil reset belum dapat dipastikan. Periksa akun sebelum mencoba kembali.",
    };
  }
}
