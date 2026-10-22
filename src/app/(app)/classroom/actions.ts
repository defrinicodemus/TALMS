"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/data/profile";
import { assertRole } from "@/lib/auth/guard";
import { getMaterialMediaUrl, SLIDESHOW_LINK_ERROR } from "@/lib/materialEmbeds";
import { validateMaterialFile } from "@/lib/validateUpload";
import { sanitizeRichText } from "@/lib/sanitizeRichText";
import { richTextIsEmpty } from "@/lib/richTextEmpty";
import { z } from "zod";
import { parseAssignmentDeadline } from "@/lib/assignmentConstants";
import {
  discardAssignmentPhoto,
  uploadAssignmentPhoto,
  validateAssignmentPhoto,
} from "@/lib/assignmentFiles";

const MATERIAL_KINDS = ["pdf", "video", "text", "image", "slideshow"];

type MaterialClient = Awaited<ReturnType<typeof createClient>>;

async function canManageMaterial(
  client: MaterialClient,
  teacherId: string,
  classId: string,
  subjectId: string,
  objectiveId: string,
) {
  const [{ data: teaching, error: teachingError }, { data: objective, error: objectiveError }] =
    await Promise.all([
      client
        .from("class_teacher_subjects")
        .select("id")
        .eq("teacher_id", teacherId)
        .eq("class_id", classId)
        .eq("subject_id", subjectId)
        .maybeSingle(),
      client
        .from("learning_objectives")
        .select("id, curriculum_plans!inner(class_id, subject_id)")
        .eq("id", objectiveId)
        .eq("curriculum_plans.class_id", classId)
        .eq("curriculum_plans.subject_id", subjectId)
        .maybeSingle(),
    ]);
  // Check access and TP context before invoking privileged storage operations.
  return !teachingError && !objectiveError && !!teaching && !!objective;
}

async function prepareMaterialContent(formData: FormData, kind: string, requireFile: boolean) {
  if (kind === "text") {
    const raw = String(formData.get("content") ?? "");
    if (new TextEncoder().encode(raw).length > 512 * 1024)
      throw new Error(
        "Isi materi terlalu panjang. Gunakan lampiran PDF untuk materi yang panjang.",
      );
    const content = sanitizeRichText(raw);
    if (richTextIsEmpty(content.replace(/&nbsp;|&#160;/g, " ")))
      throw new Error("Isi materi teks wajib diisi.");
    return { content };
  }
  if (kind === "video" || kind === "slideshow") {
    const url = getMaterialMediaUrl(kind, String(formData.get("url") ?? ""));
    if (!url)
      throw new Error(kind === "video" ? "Tautan YouTube tidak valid." : SLIDESHOW_LINK_ERROR);
    return { url };
  }
  if (kind !== "pdf" && kind !== "image") throw new Error("Jenis materi tidak valid.");
  const value = formData.get("file");
  if (!(value instanceof File) || (!value.size && !value.name)) {
    if (requireFile) throw new Error("Pilih file untuk diunggah.");
    return {};
  }
  const validation = validateMaterialFile(value, kind);
  if (!validation.ok) throw new Error(validation.message);
  const bytes = new Uint8Array(await value.slice(0, 12).arrayBuffer());
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  const valid =
    value.type === "application/pdf"
      ? starts(37, 80, 68, 70, 45)
      : value.type === "image/png"
        ? starts(137, 80, 78, 71, 13, 10, 26, 10)
        : value.type === "image/jpeg"
          ? starts(255, 216, 255)
          : starts(82, 73, 70, 70) && [87, 69, 66, 80].every((byte, i) => bytes[i + 8] === byte);
  if (!valid) throw new Error("Isi file tidak sesuai dengan format PDF/gambar yang dipilih.");
  return { file: value };
}

async function uploadMaterialFile(file: File, classId: string, subjectId: string) {
  const extension: Record<string, string> = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  const path = `${classId}/${subjectId}/${crypto.randomUUID()}.${extension[file.type]}`;
  const bucket = createAdminClient().storage.from("learning-materials");
  const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("File gagal diunggah. Coba lagi; isian belum dihapus.");
  return { path, url: bucket.getPublicUrl(path).data.publicUrl };
}

async function discardNewMaterialFile(path: string) {
  // Only remove a new upload after a rejected database write. Never remove the old file.
  try {
    const { error } = await createAdminClient().storage.from("learning-materials").remove([path]);
    if (error) console.error("Gagal membersihkan unggahan materi yang tidak tersimpan.");
  } catch {
    console.error("Gagal membersihkan unggahan materi yang tidak tersimpan.");
  }
}

function refreshMaterials() {
  revalidatePath("/classroom");
  revalidatePath("/curriculum");
  revalidatePath("/subjects", "layout");
}

export async function createMaterial(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const classId = String(formData.get("class_id") ?? "");
  const subjectId = String(formData.get("subject_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const learningObjectiveId = String(formData.get("learning_objective_id") ?? "");
  const isActive = String(formData.get("status") ?? "published") !== "draft";

  if (!classId || !subjectId || !title) {
    return { ok: false, message: "Kelas, mata pelajaran, dan judul wajib diisi." };
  }
  if (!MATERIAL_KINDS.includes(kind)) {
    return { ok: false, message: "Jenis materi tidak valid." };
  }
  if (!learningObjectiveId) {
    return { ok: false, message: "Tujuan Pembelajaran (TP) wajib dipilih." };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "teacher") {
    return { ok: false, message: "Tidak diizinkan." };
  }

  try {
    if (title.length > 200) throw new Error("Judul maksimal 200 karakter.");
    const prepared = await prepareMaterialContent(formData, kind, true);
    const supabase = await createClient();
    if (
      !(await canManageMaterial(supabase, currentUser.id, classId, subjectId, learningObjectiveId))
    ) {
      return {
        ok: false,
        message: "Kelas, mata pelajaran, atau TP tidak sesuai dengan penugasan Anda.",
      };
    }
    const upload = prepared.file
      ? await uploadMaterialFile(prepared.file, classId, subjectId)
      : null;
    const { error } = await supabase.from("materials").insert({
      class_id: classId,
      subject_id: subjectId,
      teacher_id: currentUser.id,
      title,
      kind,
      url: upload?.url ?? prepared.url ?? null,
      content: prepared.content ?? null,
      learning_objective_id: learningObjectiveId,
      is_active: isActive,
    });
    if (error) {
      if (upload) await discardNewMaterialFile(upload.path);
      return {
        ok: false,
        message: "Materi gagal disimpan. Periksa penugasan dan TP, lalu coba lagi.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Materi gagal disimpan. Coba lagi.",
    };
  }
  refreshMaterials();
  return {
    ok: true,
    message: isActive
      ? "Materi berhasil dipublikasikan."
      : "Materi berhasil disimpan sebagai draf.",
  };
}

export async function updateMaterial(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const learningObjectiveId = String(formData.get("learning_objective_id") ?? "");
  if (!id || !title) return { ok: false, message: "Judul wajib diisi." };
  if (!learningObjectiveId) {
    return { ok: false, message: "Tujuan Pembelajaran (TP) wajib dipilih." };
  }

  if (!currentUser) return { ok: false, message: "Tidak diizinkan." };
  try {
    if (title.length > 200) throw new Error("Judul maksimal 200 karakter.");
    const supabase = await createClient();
    const { data: material, error: readError } = await supabase
      .from("materials")
      .select("id, class_id, subject_id, kind")
      .eq("id", id)
      .maybeSingle();
    if (readError || !material)
      return { ok: false, message: "Materi tidak ditemukan atau tidak dapat diakses." };
    if (
      !(await canManageMaterial(
        supabase,
        currentUser.id,
        material.class_id,
        material.subject_id,
        learningObjectiveId,
      ))
    ) {
      return {
        ok: false,
        message: "Kelas, mata pelajaran, atau TP tidak sesuai dengan penugasan Anda.",
      };
    }
    const prepared = await prepareMaterialContent(formData, material.kind, false);
    const upload = prepared.file
      ? await uploadMaterialFile(prepared.file, material.class_id, material.subject_id)
      : null;
    const update = {
      title,
      learning_objective_id: learningObjectiveId,
      ...(prepared.content !== undefined ? { content: prepared.content } : {}),
      ...(upload || prepared.url ? { url: upload?.url ?? prepared.url } : {}),
    };
    const { data, error } = await supabase
      .from("materials")
      .update(update)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      if (upload) await discardNewMaterialFile(upload.path);
      return {
        ok: false,
        message: "Perubahan gagal disimpan. Materi dan lampiran lama tetap tersedia.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Perubahan gagal disimpan. Coba lagi.",
    };
  }
  refreshMaterials();
  return { ok: true, message: "Materi berhasil diperbarui." };
}

export async function deleteMaterial(id: string): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const supabase = await createClient();
  const { error } = await supabase.from("materials").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/curriculum");
  return { ok: true, message: "Materi berhasil dihapus." };
}

export async function setMaterialActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const supabase = await createClient();
  const { error } = await supabase.from("materials").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/subjects");
  return {
    ok: true,
    message: isActive ? "Materi diaktifkan kembali." : "Materi dinonaktifkan dari tampilan siswa.",
  };
}

const ASSIGNMENT_METHODS = ["text", "photo"];

async function prepareAssignmentAttachment(form: FormData, folder: string) {
  const file = form.get("attachment_image");
  if (file == null || (file instanceof File && !file.name && !file.size)) return null;
  if (!(file instanceof File)) throw new Error("Lampiran tidak valid.");
  const validation = await validateAssignmentPhoto(file);
  if (!validation.ok) throw new Error(validation.message);
  const upload = await uploadAssignmentPhoto(file, "learning-materials", folder);
  if (!upload.ok) throw new Error(upload.message);
  return { ...upload, name: file.name };
}

async function managedAssignment(client: MaterialClient, teacherId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data: task, error } = await client
    .from("assignments")
    .select("id, class_id, subject_id, learning_objective_id, attachment_image_url, due_at")
    .eq("id", id)
    .neq("kind", "quiz")
    .maybeSingle();
  if (error || !task) return null;
  const { data: teaching, error: teachingError } = await client
    .from("class_teacher_subjects")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("class_id", task.class_id)
    .eq("subject_id", task.subject_id)
    .maybeSingle();
  return teachingError || !teaching ? null : task;
}

function refreshAssignments() {
  revalidatePath("/classroom");
  revalidatePath("/curriculum");
  revalidatePath("/subjects", "layout");
  revalidatePath("/assessments");
  revalidatePath("/gradebook");
  revalidatePath("/grades", "layout");
  revalidatePath("/dashboard");
}

export async function createAssignment(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const classId = String(formData.get("class_id") ?? "");
  const subjectId = String(formData.get("subject_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const learningObjectiveId = String(formData.get("learning_objective_id") ?? "");
  const rawDescription = String(formData.get("description") ?? "");
  const methods = formData
    .getAll("allowed_methods")
    .map(String)
    .filter((m) => ASSIGNMENT_METHODS.includes(m));
  const dueDate = String(formData.get("due_date") ?? "").trim();
  const dueTime = String(formData.get("due_time") ?? "").trim();
  const isActive = String(formData.get("status") ?? "published") !== "draft";

  if (!classId || !subjectId || !title) {
    return { ok: false, message: "Kelas, mata pelajaran, dan judul wajib diisi." };
  }
  if (!learningObjectiveId) {
    return { ok: false, message: "Tujuan Pembelajaran (TP) wajib dipilih." };
  }
  if (methods.length === 0) {
    return { ok: false, message: "Pilih minimal satu teknik pengumpulan." };
  }
  if (!dueDate || !dueTime) {
    return { ok: false, message: "Batas pengumpulan dan jam batas wajib diisi." };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "teacher") {
    return { ok: false, message: "Tidak diizinkan." };
  }

  const dueAt = parseAssignmentDeadline(dueDate, dueTime);
  if (!dueAt) {
    return { ok: false, message: "Batas pengumpulan tidak valid." };
  }

  const description = richTextIsEmpty(rawDescription) ? null : sanitizeRichText(rawDescription);
  const kind = methods.includes("text") ? "essay" : "photo";
  if (
    ![classId, subjectId, learningObjectiveId].every(
      (id) => z.string().uuid().safeParse(id).success,
    ) ||
    title.length > 200
  )
    return {
      ok: false,
      message: "Kelas, mata pelajaran, TP, atau judul tidak valid (maksimal 200 karakter).",
    };
  if (new TextEncoder().encode(rawDescription).length > 128 * 1024)
    return {
      ok: false,
      message: "Instruksi terlalu panjang. Gunakan lampiran untuk informasi tambahan.",
    };
  try {
    const supabase = await createClient();
    if (
      !(await canManageMaterial(supabase, currentUser.id, classId, subjectId, learningObjectiveId))
    )
      return {
        ok: false,
        message: "Penugasan guru atau TP tidak sesuai kelas dan mata pelajaran.",
      };
    const id = crypto.randomUUID();
    const upload = await prepareAssignmentAttachment(
      formData,
      `assignments/${classId}/${subjectId}/${id}`,
    );
    const { error } = await supabase.from("assignments").insert({
      id,
      class_id: classId,
      subject_id: subjectId,
      teacher_id: currentUser.id,
      title,
      kind,
      description,
      due_at: dueAt,
      learning_objective_id: learningObjectiveId,
      allowed_methods: methods,
      is_published: isActive,
      attachment_image_url: upload?.url ?? null,
      attachment_image_name: upload?.name ?? null,
    });
    if (error) {
      if (upload && /^(22|23|42)/.test(error.code))
        await discardAssignmentPhoto("learning-materials", upload.path);
      return {
        ok: false,
        message:
          "Tugas belum dapat dikonfirmasi tersimpan. Periksa daftar tugas sebelum mencoba lagi.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Tugas belum berhasil disimpan. Isian tetap tersedia.",
    };
  }
  refreshAssignments();
  return {
    ok: true,
    message: isActive ? "Tugas berhasil dipublikasikan." : "Tugas berhasil disimpan sebagai draf.",
  };
}

export async function updateAssignment(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const learningObjectiveId = String(formData.get("learning_objective_id") ?? "");
  if (!id || !title) return { ok: false, message: "Judul wajib diisi." };
  if (!learningObjectiveId) {
    return { ok: false, message: "Tujuan Pembelajaran (TP) wajib dipilih." };
  }

  if (!currentUser) return { ok: false, message: "Tidak diizinkan." };
  if (title.length > 200 || !z.string().uuid().safeParse(learningObjectiveId).success)
    return { ok: false, message: "Judul atau TP tidak valid." };
  const update: {
    title: string;
    learning_objective_id: string;
    description?: string | null;
    due_at?: string;
    attachment_image_url?: string;
    attachment_image_name?: string;
  } = {
    title,
    learning_objective_id: learningObjectiveId,
  };
  if (formData.has("description")) {
    const raw = String(formData.get("description") ?? "");
    if (new TextEncoder().encode(raw).length > 128 * 1024)
      return { ok: false, message: "Instruksi terlalu panjang." };
    update.description = richTextIsEmpty(raw) ? null : sanitizeRichText(raw);
  }

  if (formData.has("due_date") || formData.has("due_time")) {
    const dueAt = parseAssignmentDeadline(
      String(formData.get("due_date") ?? ""),
      String(formData.get("due_time") ?? ""),
    );
    if (!dueAt) return { ok: false, message: "Isi tanggal dan jam tenggat yang valid (WITA)." };
    update.due_at = dueAt;
  }
  try {
    const supabase = await createClient();
    const task = await managedAssignment(supabase, currentUser.id, id);
    if (
      !task ||
      !(await canManageMaterial(
        supabase,
        currentUser.id,
        task.class_id,
        task.subject_id,
        learningObjectiveId,
      ))
    )
      return { ok: false, message: "Tugas atau TP tidak sesuai penugasanmu." };
    const upload = await prepareAssignmentAttachment(
      formData,
      `assignments/${task.class_id}/${task.subject_id}/${id}`,
    );
    if (upload) {
      update.attachment_image_url = upload.url;
      update.attachment_image_name = upload.name;
    }
    const { data, error } = await supabase
      .from("assignments")
      .update(update)
      .eq("id", id)
      .neq("kind", "quiz")
      .select("id")
      .maybeSingle();
    if (error || !data) {
      if (upload && (!error || /^(22|23|42)/.test(error.code)))
        await discardAssignmentPhoto("learning-materials", upload.path);
      return {
        ok: false,
        message:
          "Perubahan tugas belum dapat dikonfirmasi. Muat ulang untuk memeriksa; lampiran lama tidak dihapus.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Perubahan belum berhasil disimpan.",
    };
  }
  refreshAssignments();
  return { ok: true, message: "Tugas berhasil diperbarui." };
}

export async function setAssignmentActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const supabase = await createClient();
  const task = currentUser ? await managedAssignment(supabase, currentUser.id, id) : null;
  if (!task) return { ok: false, message: "Tugas tidak sesuai penugasanmu." };
  if (!isActive) {
    const { count, error: countError } = await supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", id);
    if (countError || count == null)
      return {
        ok: false,
        message: "Pengumpulan siswa belum dapat diperiksa. Status tidak diubah.",
      };
    if (count > 0)
      return {
        ok: false,
        message:
          "Tugas tidak dapat dinonaktifkan karena sudah memiliki pengumpulan siswa. Gunakan tenggat untuk menutup pengumpulan.",
      };
  } else if (!task.due_at || new Date(task.due_at).getTime() <= Date.now()) {
    return {
      ok: false,
      message: "Perpanjang tenggat tugas sebelum mengaktifkannya kembali.",
    };
  }
  const { data, error } = await supabase
    .from("assignments")
    .update({ is_published: isActive })
    .eq("id", id)
    .neq("kind", "quiz")
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, message: "Status tugas belum berhasil diubah." };
  refreshAssignments();
  return {
    ok: true,
    message: isActive ? "Tugas diaktifkan kembali." : "Tugas dinonaktifkan dari tampilan siswa.",
  };
}

export async function removeAssignmentAttachmentImage(
  id: string,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const supabase = await createClient();
  if (!currentUser || !(await managedAssignment(supabase, currentUser.id, id)))
    return { ok: false, message: "Tugas tidak sesuai penugasanmu." };
  const { data, error } = await supabase
    .from("assignments")
    .update({ attachment_image_url: null, attachment_image_name: null })
    .eq("id", id)
    .neq("kind", "quiz")
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, message: "Lampiran belum berhasil dihapus dari tugas." };
  refreshAssignments();
  return { ok: true, message: "Lampiran berhasil dihapus." };
}

export async function deleteAssignment(id: string): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const supabase = await createClient();

  if (!currentUser || !(await managedAssignment(supabase, currentUser.id, id)))
    return { ok: false, message: "Tugas tidak sesuai penugasanmu." };
  const { count, error: countError } = await supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", id);
  if (countError || count == null)
    return { ok: false, message: "Pengumpulan siswa belum dapat diperiksa. Tugas tidak dihapus." };
  if (count) {
    return {
      ok: false,
      message: `Tidak bisa dihapus — sudah ada ${count} submisi siswa untuk tugas ini.`,
    };
  }

  const { data, error } = await supabase
    .from("assignments")
    .delete()
    .eq("id", id)
    .neq("kind", "quiz")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "Tugas tidak ditemukan atau tidak dapat dihapus." };
  refreshAssignments();
  return { ok: true, message: "Tugas berhasil dihapus." };
}

const QUIZ_TYPES = ["latihan", "ulangan_harian", "uts", "uas"];

export async function createQuiz(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const classId = String(formData.get("class_id") ?? "");
  const subjectId = String(formData.get("subject_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const quizType = String(formData.get("quiz_type") ?? "");
  const learningObjectiveId = String(formData.get("learning_objective_id") ?? "");
  const rawDescription = String(formData.get("description") ?? "");
  const dueDate = String(formData.get("due_date") ?? "").trim();
  const dueTime = String(formData.get("due_time") ?? "").trim();
  const timerRaw = String(formData.get("timer_minutes") ?? "").trim();
  const kkmRaw = String(formData.get("passing_grade") ?? "").trim();

  if (!classId || !subjectId || !title) {
    return { ok: false, message: "Kelas, mata pelajaran, dan judul wajib diisi." };
  }
  if (!QUIZ_TYPES.includes(quizType)) {
    return { ok: false, message: "Tipe kuis wajib dipilih." };
  }
  if (!learningObjectiveId) {
    return { ok: false, message: "Tujuan Pembelajaran (TP) wajib dipilih." };
  }
  if (!dueDate || !dueTime) {
    return { ok: false, message: "Tenggat kuis wajib diisi." };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "teacher") {
    return { ok: false, message: "Tidak diizinkan." };
  }

  const dueAt = parseAssignmentDeadline(dueDate, dueTime);
  if (!dueAt) {
    return { ok: false, message: "Tenggat kuis tidak valid." };
  }
  if (new Date(dueAt).getTime() < Date.now()) {
    return { ok: false, message: "Tenggat kuis tidak boleh tanggal/waktu yang sudah lewat." };
  }

  const timerMinutes = timerRaw ? Number(timerRaw) : null;
  if (timerMinutes !== null && (!Number.isInteger(timerMinutes) || timerMinutes <= 0)) {
    return { ok: false, message: "Estimasi waktu pengerjaan tidak valid." };
  }
  const passingGrade = kkmRaw ? Number(kkmRaw) : null;
  if (
    passingGrade !== null &&
    (!Number.isInteger(passingGrade) || passingGrade < 0 || passingGrade > 100)
  ) {
    return { ok: false, message: "Passing grade (KKM) harus di antara 0-100." };
  }

  const description = richTextIsEmpty(rawDescription) ? null : sanitizeRichText(rawDescription);

  const supabase = await createClient();
  const { error } = await supabase.from("assignments").insert({
    class_id: classId,
    subject_id: subjectId,
    teacher_id: currentUser.id,
    title,
    kind: "quiz",
    quiz_type: quizType,
    description,
    due_at: dueAt,
    timer_minutes: timerMinutes,
    passing_grade: passingGrade,
    learning_objective_id: learningObjectiveId,
    is_published: false,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/curriculum");
  return { ok: true, message: "Kuis berhasil disimpan. Tambahkan soal lalu publikasikan kuis." };
}

export async function updateQuiz(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const quizType = String(formData.get("quiz_type") ?? "");
  const learningObjectiveId = String(formData.get("learning_objective_id") ?? "");
  const rawDescription = String(formData.get("description") ?? "");
  const dueDate = String(formData.get("due_date") ?? "").trim();
  const dueTime = String(formData.get("due_time") ?? "").trim();
  const timerRaw = String(formData.get("timer_minutes") ?? "").trim();
  const kkmRaw = String(formData.get("passing_grade") ?? "").trim();

  if (!id || !title) return { ok: false, message: "Judul wajib diisi." };
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("assignments")
    .select("id, is_published")
    .eq("id", id)
    .eq("kind", "quiz")
    .eq("teacher_id", currentUser!.id)
    .maybeSingle();
  if (readError || !current)
    return { ok: false, message: "Kuis tidak ditemukan atau belum dapat dibaca." };

  if (!current.is_published && !QUIZ_TYPES.includes(quizType))
    return { ok: false, message: "Tipe kuis wajib dipilih." };
  if (!current.is_published && !learningObjectiveId) {
    return { ok: false, message: "Tujuan Pembelajaran (TP) wajib dipilih." };
  }
  if (!dueDate || !dueTime) {
    return { ok: false, message: "Tenggat kuis wajib diisi." };
  }

  const dueAt = parseAssignmentDeadline(dueDate, dueTime);
  if (!dueAt) {
    return { ok: false, message: "Tenggat kuis tidak valid." };
  }

  const timerMinutes = timerRaw ? Number(timerRaw) : null;
  if (
    !current.is_published &&
    timerMinutes !== null &&
    (!Number.isInteger(timerMinutes) || timerMinutes <= 0)
  ) {
    return { ok: false, message: "Estimasi waktu pengerjaan tidak valid." };
  }
  const passingGrade = kkmRaw ? Number(kkmRaw) : null;
  if (
    !current.is_published &&
    passingGrade !== null &&
    (!Number.isInteger(passingGrade) || passingGrade < 0 || passingGrade > 100)
  ) {
    return { ok: false, message: "Passing grade (KKM) harus di antara 0-100." };
  }

  const description = richTextIsEmpty(rawDescription) ? null : sanitizeRichText(rawDescription);

  const { error } = await supabase
    .from("assignments")
    .update({
      title,
      ...(!current.is_published
        ? {
            quiz_type: quizType,
            timer_minutes: timerMinutes,
            passing_grade: passingGrade,
            learning_objective_id: learningObjectiveId,
          }
        : {}),
      description,
      due_at: dueAt,
    })
    .eq("id", id)
    .eq("kind", "quiz")
    .eq("teacher_id", currentUser!.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/curriculum");
  revalidatePath("/subjects");
  return { ok: true, message: "Kuis berhasil diperbarui." };
}

export async function setQuizActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const supabase = await createClient();
  const { data: quiz, error: quizError } = await supabase
    .from("assignments")
    .select("id, due_at")
    .eq("id", id)
    .eq("kind", "quiz")
    .eq("teacher_id", currentUser!.id)
    .maybeSingle();
  if (quizError || !quiz) return { ok: false, message: "Kuis tidak ditemukan." };
  if (!isActive) {
    const { count, error: countError } = await supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", id);
    if (countError || count == null)
      return { ok: false, message: "Jawaban siswa belum dapat diperiksa. Status tidak diubah." };
    if (count > 0)
      return {
        ok: false,
        message:
          "Kuis tidak dapat dinonaktifkan karena sudah memiliki jawaban siswa. Gunakan tenggat untuk menutup pengerjaan.",
      };
  } else if (!quiz.due_at || new Date(quiz.due_at).getTime() <= Date.now()) {
    return {
      ok: false,
      message: "Perpanjang tenggat kuis sebelum mengaktifkannya kembali.",
    };
  }
  const { data, error } = await supabase
    .from("assignments")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("kind", "quiz")
    .eq("teacher_id", currentUser!.id)
    .select("id")
    .maybeSingle();
  if (!error && !data) return { ok: false, message: "Kuis tidak ditemukan." };
  if (error) return { ok: false, message: error.message };

  refreshAssignments();
  return {
    ok: true,
    message: isActive ? "Kuis diaktifkan kembali." : "Kuis dinonaktifkan dari tampilan siswa.",
  };
}

export async function publishQuiz(id: string): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const supabase = await createClient();

  const { data: questions, error: questionsError } = await supabase
    .from("quiz_questions")
    .select("points")
    .eq("assignment_id", id)
    .eq("is_active", true);
  if (questionsError) return { ok: false, message: "Soal belum dapat dibaca. Coba lagi." };
  const totalPoints = (questions ?? []).reduce((sum, q) => sum + q.points, 0);
  if (totalPoints !== 100) {
    const remaining = Math.max(0, 100 - totalPoints);
    return {
      ok: false,
      message:
        totalPoints > 100
          ? `Kuis belum dapat dipublikasikan. Total bobot soal melebihi 100 poin (${totalPoints} poin). Kurangi bobot beberapa soal.`
          : `Kuis belum dapat dipublikasikan. Total bobot soal masih ${totalPoints} dari 100 poin. Tambahkan ${remaining} poin lagi.`,
    };
  }

  const { data, error } = await supabase
    .from("assignments")
    .update({ is_published: true })
    .eq("id", id)
    .eq("kind", "quiz")
    .eq("teacher_id", currentUser!.id)
    .select("id")
    .maybeSingle();
  if (!error && !data) return { ok: false, message: "Kuis tidak ditemukan." };
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/subjects");
  return { ok: true, message: "Kuis berhasil dipublikasikan dan sekarang bisa dikerjakan siswa." };
}

export async function deleteQuiz(id: string): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const supabase = await createClient();

  const { count, error: countError } = await supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", id);
  if (countError)
    return { ok: false, message: "Pengumpulan siswa belum dapat diperiksa. Coba lagi." };
  if (count) {
    return {
      ok: false,
      message: `Tidak bisa dihapus — sudah ada ${count} submisi siswa untuk kuis ini.`,
    };
  }

  const { data, error } = await supabase
    .from("assignments")
    .delete()
    .eq("id", id)
    .eq("kind", "quiz")
    .eq("teacher_id", currentUser!.id)
    .select("id")
    .maybeSingle();
  if (!error && !data) return { ok: false, message: "Kuis tidak ditemukan." };
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/curriculum");
  return { ok: true, message: "Kuis berhasil dihapus." };
}

const QUESTION_TYPES = ["multiple_choice", "true_false", "drag_and_drop", "sequence"];

interface ParsedQuestionAnswer {
  correctAnswerText: string | null;
  options: { text: string; isCorrect: boolean }[];
  pairs: { dragText: string; targetText: string }[];
  steps: string[];
}

function parseQuestionAnswer(
  formData: FormData,
  questionType: string,
): { ok: true; data: ParsedQuestionAnswer } | { ok: false; message: string } {
  if (questionType === "multiple_choice") {
    const optionTexts = formData.getAll("option_text").map((v) => String(v).trim());
    const correctIndex = Number(formData.get("correct_index") ?? -1);
    const filledCount = optionTexts.filter((t) => t.length > 0).length;
    if (filledCount < 2) {
      return { ok: false, message: "Pilihan ganda wajib punya minimal 2 opsi." };
    }
    if (correctIndex < 0 || correctIndex >= optionTexts.length || !optionTexts[correctIndex]) {
      return { ok: false, message: "Pilih salah satu opsi sebagai jawaban benar." };
    }
    const options = optionTexts
      .map((text, i) => ({ text, isCorrect: i === correctIndex }))
      .filter((o) => o.text.length > 0);
    return { ok: true, data: { correctAnswerText: null, options, pairs: [], steps: [] } };
  }
  if (questionType === "true_false") {
    const answer = String(formData.get("correct_answer_text") ?? "")
      .trim()
      .toLowerCase();
    if (answer !== "benar" && answer !== "salah") {
      return { ok: false, message: "Pilih jawaban Benar atau Salah." };
    }
    return { ok: true, data: { correctAnswerText: answer, options: [], pairs: [], steps: [] } };
  }
  if (questionType === "drag_and_drop") {
    const dragTexts = formData.getAll("pair_drag_text").map((v) => String(v).trim());
    const targetTexts = formData.getAll("pair_target_text").map((v) => String(v).trim());
    const pairs: { dragText: string; targetText: string }[] = [];
    for (let i = 0; i < Math.max(dragTexts.length, targetTexts.length); i++) {
      if (!!dragTexts[i] !== !!targetTexts[i])
        return {
          ok: false,
          message: "Lengkapi kedua sisi setiap pasangan atau kosongkan keduanya.",
        };
      if (dragTexts[i] && targetTexts[i]) {
        pairs.push({ dragText: dragTexts[i], targetText: targetTexts[i] });
      }
    }
    if (pairs.length < 2) {
      return { ok: false, message: "Drag and drop wajib punya minimal 2 pasangan." };
    }
    return { ok: true, data: { correctAnswerText: null, options: [], pairs, steps: [] } };
  }
  if (questionType === "sequence") {
    const steps = formData
      .getAll("step_text")
      .map((v) => String(v).trim())
      .filter((t) => t.length > 0);
    if (steps.length < 2) {
      return { ok: false, message: "Langkah-langkah wajib punya minimal 2 langkah." };
    }
    return { ok: true, data: { correctAnswerText: null, options: [], pairs: [], steps } };
  }
  return { ok: false, message: "Tipe soal tidak valid." };
}

async function saveQuizQuestion(
  formData: FormData,
  editing: boolean,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;
  const id = String(formData.get("id") ?? "");
  let assignmentId = String(formData.get("assignment_id") ?? "");
  const questionText = String(formData.get("question_text") ?? "").trim();
  const questionType = String(formData.get("question_type") ?? "");
  const points = Number(formData.get("points") ?? 0);
  const explanation = String(formData.get("explanation") ?? "").trim();
  if (!questionText || questionText.length > 20000 || explanation.length > 20000)
    return { ok: false, message: "Isi pertanyaan dan batasi teks hingga 20.000 karakter." };
  if (!QUESTION_TYPES.includes(questionType))
    return { ok: false, message: "Tipe soal tidak valid." };
  if (!Number.isInteger(points) || points <= 0 || points > 100)
    return { ok: false, message: "Bobot poin harus berupa bilangan bulat antara 1-100." };
  const parsed = parseQuestionAnswer(formData, questionType);
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  if (editing) {
    if (!z.string().uuid().safeParse(id).success)
      return { ok: false, message: "Soal tidak valid." };
    const { data, error } = await supabase
      .from("quiz_questions")
      .select("assignment_id")
      .eq("id", id)
      .maybeSingle();
    if (error || !data)
      return { ok: false, message: "Soal tidak ditemukan atau belum dapat dibaca." };
    assignmentId = data.assignment_id;
  }
  if (!z.string().uuid().safeParse(assignmentId).success)
    return { ok: false, message: "Kuis tidak valid." };
  const { error } = await supabase.rpc("save_quiz_question", {
    p_assignment_id: assignmentId,
    p_question_id: editing ? id : null,
    p_question: { questionText, questionType, points, explanation, ...parsed.data },
  });
  if (error)
    return {
      ok: false,
      message: ["22023", "42501", "55000"].includes(error.code)
        ? error.message
        : "Soal belum tersimpan. Isian tetap tersedia; coba lagi.",
    };
  revalidatePath("/classroom");
  return {
    ok: true,
    message: editing ? "Soal berhasil diperbarui." : "Soal berhasil ditambahkan.",
  };
}

export async function addQuizQuestion(formData: FormData) {
  return saveQuizQuestion(formData, false);
}
export async function updateQuizQuestion(formData: FormData) {
  return saveQuizQuestion(formData, true);
}

export async function setQuizQuestionActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  if (!z.string().uuid().safeParse(id).success) return { ok: false, message: "Soal tidak valid." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quiz_questions")
    .update({ is_active: isActive })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "Soal tidak ditemukan atau tidak dapat diubah." };

  revalidatePath("/classroom");
  return { ok: true, message: isActive ? "Soal diaktifkan kembali." : "Soal dinonaktifkan." };
}

export async function deleteQuizQuestion(id: string): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  if (!z.string().uuid().safeParse(id).success) return { ok: false, message: "Soal tidak valid." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quiz_questions")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "Soal tidak ditemukan atau tidak dapat diubah." };

  revalidatePath("/classroom");
  return { ok: true, message: "Soal berhasil dihapus." };
}
