"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/data/profile";
import { assertRole } from "@/lib/auth/guard";
import { extractYoutubeId, extractGoogleSlidesId } from "@/lib/materialEmbeds";
import { sanitizeRichText } from "@/lib/sanitizeRichText";
import { richTextIsEmpty } from "@/lib/richTextEmpty";

const MATERIAL_KINDS = ["pdf", "video", "text", "image", "slideshow"];

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

  let url: string | null = null;
  let content: string | null = null;

  if (kind === "text") {
    const rawContent = String(formData.get("content") ?? "");
    if (richTextIsEmpty(rawContent)) return { ok: false, message: "Isi materi teks wajib diisi." };
    content = sanitizeRichText(rawContent);
  } else if (kind === "video") {
    const rawUrl = String(formData.get("url") ?? "").trim();
    const videoId = extractYoutubeId(rawUrl);
    if (!videoId) return { ok: false, message: "Tautan YouTube tidak valid." };
    url = `https://www.youtube.com/embed/${videoId}`;
  } else if (kind === "slideshow") {
    const rawUrl = String(formData.get("url") ?? "").trim();
    const slidesId = extractGoogleSlidesId(rawUrl);
    if (!slidesId) return { ok: false, message: "Tautan Google Slides tidak valid." };
    url = `https://docs.google.com/presentation/d/${slidesId}/embed`;
  } else {
    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) return { ok: false, message: "Pilih file untuk diunggah." };

    const admin = createAdminClient();
    const ext = file.name.split(".").pop() || "bin";
    const path = `${classId}/${subjectId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from("learning-materials")
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) return { ok: false, message: uploadError.message };

    const {
      data: { publicUrl },
    } = admin.storage.from("learning-materials").getPublicUrl(path);
    url = publicUrl;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("materials").insert({
    class_id: classId,
    subject_id: subjectId,
    teacher_id: currentUser.id,
    title,
    kind,
    url,
    content,
    learning_objective_id: learningObjectiveId,
    is_active: isActive,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/curriculum");
  revalidatePath("/subjects");
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

  const update: { title: string; learning_objective_id: string; content?: string } = {
    title,
    learning_objective_id: learningObjectiveId,
  };
  if (formData.has("content")) {
    const rawContent = String(formData.get("content") ?? "");
    if (richTextIsEmpty(rawContent)) return { ok: false, message: "Isi materi teks wajib diisi." };
    update.content = sanitizeRichText(rawContent);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("materials").update(update).eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/curriculum");
  revalidatePath("/subjects");
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

async function uploadAssignmentImage(
  assignmentId: string,
  classId: string,
  subjectId: string,
  file: File,
): Promise<{ url: string; name: string } | { error: string }> {
  const admin = createAdminClient();
  const ext = file.name.split(".").pop() || "bin";
  const path = `assignments/${classId}/${subjectId}/${assignmentId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error: uploadError } = await admin.storage
    .from("learning-materials")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) return { error: uploadError.message };

  const {
    data: { publicUrl },
  } = admin.storage.from("learning-materials").getPublicUrl(path);
  return { url: publicUrl, name: file.name };
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

  const dueAt = new Date(`${dueDate}T${dueTime}:00`);
  if (Number.isNaN(dueAt.getTime())) {
    return { ok: false, message: "Batas pengumpulan tidak valid." };
  }

  const description = richTextIsEmpty(rawDescription) ? null : sanitizeRichText(rawDescription);
  const kind = methods.includes("text") ? "essay" : "photo";
  const attachmentImage = formData.get("attachment_image") as File | null;

  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from("assignments")
    .insert({
      class_id: classId,
      subject_id: subjectId,
      teacher_id: currentUser.id,
      title,
      kind,
      description,
      due_at: dueAt.toISOString(),
      learning_objective_id: learningObjectiveId,
      allowed_methods: methods,
      is_published: isActive,
    })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, message: error?.message ?? "Gagal menyimpan tugas." };

  if (attachmentImage && attachmentImage.size > 0) {
    const result = await uploadAssignmentImage(inserted.id, classId, subjectId, attachmentImage);
    if ("error" in result) return { ok: false, message: result.error };
    const { error: attachError } = await supabase
      .from("assignments")
      .update({ attachment_image_url: result.url, attachment_image_name: result.name })
      .eq("id", inserted.id);
    if (attachError) return { ok: false, message: attachError.message };
  }

  revalidatePath("/classroom");
  revalidatePath("/curriculum");
  revalidatePath("/subjects");
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

  const update: { title: string; learning_objective_id: string; description?: string | null } = {
    title,
    learning_objective_id: learningObjectiveId,
  };
  if (formData.has("description")) {
    const raw = String(formData.get("description") ?? "");
    update.description = richTextIsEmpty(raw) ? null : sanitizeRichText(raw);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("assignments").update(update).eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/curriculum");
  revalidatePath("/subjects");
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
  const { error } = await supabase
    .from("assignments")
    .update({ is_published: isActive })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/subjects");
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
  const { data: assignment } = await supabase
    .from("assignments")
    .select("attachment_image_url")
    .eq("id", id)
    .single();

  if (assignment?.attachment_image_url) {
    const marker = "/learning-materials/";
    const idx = assignment.attachment_image_url.indexOf(marker);
    if (idx >= 0) {
      const path = assignment.attachment_image_url.slice(idx + marker.length);
      const admin = createAdminClient();
      await admin.storage.from("learning-materials").remove([path]);
    }
  }

  const { error } = await supabase
    .from("assignments")
    .update({ attachment_image_url: null, attachment_image_name: null })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/subjects");
  return { ok: true, message: "Lampiran berhasil dihapus." };
}

export async function deleteAssignment(id: string): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const supabase = await createClient();

  const { count } = await supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", id);
  if (count) {
    return {
      ok: false,
      message: `Tidak bisa dihapus — sudah ada ${count} submisi siswa untuk tugas ini.`,
    };
  }

  const { error } = await supabase.from("assignments").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/curriculum");
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

  const dueAt = new Date(`${dueDate}T${dueTime}:00`);
  if (Number.isNaN(dueAt.getTime())) {
    return { ok: false, message: "Tenggat kuis tidak valid." };
  }
  if (dueAt.getTime() < Date.now()) {
    return { ok: false, message: "Tenggat kuis tidak boleh tanggal/waktu yang sudah lewat." };
  }

  const timerMinutes = timerRaw ? Number(timerRaw) : null;
  if (timerMinutes !== null && (!Number.isFinite(timerMinutes) || timerMinutes <= 0)) {
    return { ok: false, message: "Estimasi waktu pengerjaan tidak valid." };
  }
  const passingGrade = kkmRaw ? Number(kkmRaw) : null;
  if (
    passingGrade !== null &&
    (!Number.isFinite(passingGrade) || passingGrade < 0 || passingGrade > 100)
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
    due_at: dueAt.toISOString(),
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
  if (!QUIZ_TYPES.includes(quizType)) return { ok: false, message: "Tipe kuis wajib dipilih." };
  if (!learningObjectiveId) {
    return { ok: false, message: "Tujuan Pembelajaran (TP) wajib dipilih." };
  }
  if (!dueDate || !dueTime) {
    return { ok: false, message: "Tenggat kuis wajib diisi." };
  }

  const dueAt = new Date(`${dueDate}T${dueTime}:00`);
  if (Number.isNaN(dueAt.getTime())) {
    return { ok: false, message: "Tenggat kuis tidak valid." };
  }

  const timerMinutes = timerRaw ? Number(timerRaw) : null;
  if (timerMinutes !== null && (!Number.isFinite(timerMinutes) || timerMinutes <= 0)) {
    return { ok: false, message: "Estimasi waktu pengerjaan tidak valid." };
  }
  const passingGrade = kkmRaw ? Number(kkmRaw) : null;
  if (
    passingGrade !== null &&
    (!Number.isFinite(passingGrade) || passingGrade < 0 || passingGrade > 100)
  ) {
    return { ok: false, message: "Passing grade (KKM) harus di antara 0-100." };
  }

  const description = richTextIsEmpty(rawDescription) ? null : sanitizeRichText(rawDescription);

  const supabase = await createClient();
  const { error } = await supabase
    .from("assignments")
    .update({
      title,
      quiz_type: quizType,
      description,
      due_at: dueAt.toISOString(),
      timer_minutes: timerMinutes,
      passing_grade: passingGrade,
      learning_objective_id: learningObjectiveId,
    })
    .eq("id", id);
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
  const { error } = await supabase.from("assignments").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/subjects");
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

  const { data: questions } = await supabase
    .from("quiz_questions")
    .select("points")
    .eq("assignment_id", id)
    .eq("is_active", true);
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

  const { error } = await supabase.from("assignments").update({ is_published: true }).eq("id", id);
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

  const { count } = await supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", id);
  if (count) {
    return {
      ok: false,
      message: `Tidak bisa dihapus — sudah ada ${count} submisi siswa untuk kuis ini.`,
    };
  }

  const { error } = await supabase.from("assignments").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  revalidatePath("/curriculum");
  return { ok: true, message: "Kuis berhasil dihapus." };
}

const QUESTION_TYPES = ["multiple_choice", "true_false", "drag_and_drop", "sequence"];

async function sumActiveQuestionPoints(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assignmentId: string,
  excludeQuestionId?: string,
): Promise<number> {
  const { data } = await supabase
    .from("quiz_questions")
    .select("id, points")
    .eq("assignment_id", assignmentId)
    .eq("is_active", true);
  return (data ?? [])
    .filter((q) => q.id !== excludeQuestionId)
    .reduce((sum, q) => sum + q.points, 0);
}

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

export async function addQuizQuestion(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const assignmentId = String(formData.get("assignment_id") ?? "");
  const questionText = String(formData.get("question_text") ?? "").trim();
  const questionType = String(formData.get("question_type") ?? "");
  const points = Number(formData.get("points") ?? 0);
  const explanation = String(formData.get("explanation") ?? "").trim();

  if (!assignmentId || !questionText) {
    return { ok: false, message: "Pertanyaan wajib diisi." };
  }
  if (!QUESTION_TYPES.includes(questionType)) {
    return { ok: false, message: "Tipe soal tidak valid." };
  }
  if (!Number.isFinite(points) || points <= 0 || points > 100) {
    return { ok: false, message: "Bobot poin harus antara 1-100." };
  }

  const parsed = parseQuestionAnswer(formData, questionType);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const { correctAnswerText, options, pairs, steps } = parsed.data;

  const supabase = await createClient();
  const usedPoints = await sumActiveQuestionPoints(supabase, assignmentId);
  if (usedPoints + points > 100) {
    return { ok: false, message: `Kuota poin tidak cukup. Sisa kuota: ${100 - usedPoints} poin.` };
  }

  const { count } = await supabase
    .from("quiz_questions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);

  const { data: question, error } = await supabase
    .from("quiz_questions")
    .insert({
      assignment_id: assignmentId,
      question_text: questionText,
      question_type: questionType,
      correct_answer_text: correctAnswerText,
      points,
      explanation: explanation || null,
      sort_order: count ?? 0,
    })
    .select("id")
    .single();
  if (error || !question) return { ok: false, message: error?.message ?? "Gagal menyimpan soal." };

  if (options.length > 0) {
    const { error: optionsError } = await supabase.from("quiz_options").insert(
      options.map((o, i) => ({
        question_id: question.id,
        option_text: o.text,
        is_correct: o.isCorrect,
        sort_order: i,
      })),
    );
    if (optionsError) return { ok: false, message: optionsError.message };
  }
  if (pairs.length > 0) {
    const { error: pairsError } = await supabase.from("quiz_pairs").insert(
      pairs.map((p, i) => ({
        question_id: question.id,
        drag_text: p.dragText,
        target_text: p.targetText,
        sort_order: i,
      })),
    );
    if (pairsError) return { ok: false, message: pairsError.message };
  }
  if (steps.length > 0) {
    const { error: stepsError } = await supabase
      .from("quiz_steps")
      .insert(
        steps.map((s, i) => ({ question_id: question.id, step_text: s, correct_order: i + 1 })),
      );
    if (stepsError) return { ok: false, message: stepsError.message };
  }

  revalidatePath("/classroom");
  return { ok: true, message: "Soal berhasil ditambahkan." };
}

export async function updateQuizQuestion(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const id = String(formData.get("id") ?? "");
  const questionText = String(formData.get("question_text") ?? "").trim();
  const questionType = String(formData.get("question_type") ?? "");
  const points = Number(formData.get("points") ?? 0);
  const explanation = String(formData.get("explanation") ?? "").trim();

  if (!id || !questionText) return { ok: false, message: "Pertanyaan wajib diisi." };
  if (!QUESTION_TYPES.includes(questionType)) {
    return { ok: false, message: "Tipe soal tidak valid." };
  }
  if (!Number.isFinite(points) || points <= 0 || points > 100) {
    return { ok: false, message: "Bobot poin harus antara 1-100." };
  }

  const parsed = parseQuestionAnswer(formData, questionType);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const { correctAnswerText, options, pairs, steps } = parsed.data;

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("quiz_questions")
    .select("assignment_id")
    .eq("id", id)
    .single();
  if (!current) return { ok: false, message: "Soal tidak ditemukan." };

  const usedByOthers = await sumActiveQuestionPoints(supabase, current.assignment_id, id);
  if (usedByOthers + points > 100) {
    return {
      ok: false,
      message: `Kuota poin tidak cukup. Sisa kuota: ${100 - usedByOthers} poin.`,
    };
  }

  const { error } = await supabase
    .from("quiz_questions")
    .update({
      question_text: questionText,
      points,
      explanation: explanation || null,
      correct_answer_text: correctAnswerText,
    })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  await supabase.from("quiz_options").delete().eq("question_id", id);
  await supabase.from("quiz_pairs").delete().eq("question_id", id);
  await supabase.from("quiz_steps").delete().eq("question_id", id);

  if (options.length > 0) {
    const { error: optionsError } = await supabase.from("quiz_options").insert(
      options.map((o, i) => ({
        question_id: id,
        option_text: o.text,
        is_correct: o.isCorrect,
        sort_order: i,
      })),
    );
    if (optionsError) return { ok: false, message: optionsError.message };
  }
  if (pairs.length > 0) {
    const { error: pairsError } = await supabase.from("quiz_pairs").insert(
      pairs.map((p, i) => ({
        question_id: id,
        drag_text: p.dragText,
        target_text: p.targetText,
        sort_order: i,
      })),
    );
    if (pairsError) return { ok: false, message: pairsError.message };
  }
  if (steps.length > 0) {
    const { error: stepsError } = await supabase
      .from("quiz_steps")
      .insert(steps.map((s, i) => ({ question_id: id, step_text: s, correct_order: i + 1 })));
    if (stepsError) return { ok: false, message: stepsError.message };
  }

  revalidatePath("/classroom");
  return { ok: true, message: "Soal berhasil diperbarui." };
}

export async function setQuizQuestionActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const supabase = await createClient();
  const { error } = await supabase
    .from("quiz_questions")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  return { ok: true, message: isActive ? "Soal diaktifkan kembali." : "Soal dinonaktifkan." };
}

export async function deleteQuizQuestion(id: string): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["teacher"]);
  if (roleError) return roleError;

  const supabase = await createClient();
  const { error } = await supabase.from("quiz_questions").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/classroom");
  return { ok: true, message: "Soal berhasil dihapus." };
}
