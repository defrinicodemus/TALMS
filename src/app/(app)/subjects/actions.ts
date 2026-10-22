"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/data/profile";
import { assertRole } from "@/lib/auth/guard";
import { getQuizForStudent, type StudentQuizData } from "@/lib/data/subjects";
import {
  getStudentQuizContext,
  readQuizBank,
  quizBankError,
  quizTargetToken,
} from "@/lib/quizServer";
import {
  ASSIGNMENT_MAX_TEXT_LENGTH,
  ASSIGNMENT_PHOTO_BUCKET,
  assignmentMethods,
} from "@/lib/assignmentConstants";
import {
  assignmentPhotoUrl,
  discardAssignmentPhoto,
  uploadAssignmentPhoto,
  validateAssignmentPhoto,
} from "@/lib/assignmentFiles";

export async function markMaterialViewed(
  materialId: string,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["student"]);
  if (roleError) return roleError;
  if (!currentUser?.classId)
    return { ok: false, message: "Belum ada kelas pada tahun ajaran aktif." };
  if (!z.string().uuid().safeParse(materialId).success)
    return { ok: false, message: "Materi tidak valid." };

  const supabase = await createClient();
  const { data: material, error: materialError } = await supabase
    .from("materials")
    .select("id")
    .eq("id", materialId)
    .eq("class_id", currentUser.classId)
    .eq("is_active", true)
    .maybeSingle();
  if (materialError || !material)
    return {
      ok: false,
      message: "Materi tidak tersedia untuk kelasmu. Muat ulang halaman untuk memeriksa.",
    };

  const { error } = await supabase
    .from("material_views")
    .upsert(
      { material_id: materialId, student_id: currentUser.id },
      { onConflict: "material_id,student_id", ignoreDuplicates: true },
    );

  if (error) return { ok: false, message: "Status membaca belum tersimpan. Silakan coba lagi." };
  revalidatePath("/subjects", "layout");
  revalidatePath("/dashboard");
  return { ok: true, message: "Materi ditandai sudah dibaca." };
}

export async function submitAssignment(
  assignmentId: string,
  formData: FormData,
): Promise<{
  ok: boolean;
  message: string;
  submission?: {
    content: string;
    photoUrl: string | null;
    submittedAt: string;
    updatedAt: string;
  };
}> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["student"]);
  if (roleError) return roleError;
  if (!currentUser?.classId)
    return { ok: false, message: "Belum ada kelas pada tahun ajaran aktif." };
  if (!z.string().uuid().safeParse(assignmentId).success || !(formData instanceof FormData))
    return { ok: false, message: "Pengumpulan tidak valid." };
  const method = String(formData.get("method") ?? "");
  const expected = String(formData.get("expected_updated_at") ?? "") || null;
  if (expected && !z.string().datetime({ offset: true }).safeParse(expected).success)
    return { ok: false, message: "Waktu pengumpulan tidak valid. Muat ulang halaman." };

  try {
    const supabase = await createClient();
    const { data: task, error: taskError } = await supabase
      .from("assignments")
      .select("id, kind, allowed_methods, due_at")
      .eq("id", assignmentId)
      .eq("class_id", currentUser.classId)
      .eq("is_published", true)
      .neq("kind", "quiz")
      .maybeSingle();
    if (taskError || !task) return { ok: false, message: "Tugas tidak tersedia untuk kelasmu." };
    if (task.due_at && new Date(task.due_at).getTime() <= Date.now())
      return {
        ok: false,
        message: "Tenggat pengumpulan sudah berakhir. Hubungi guru untuk perpanjangan waktu.",
      };
    if (
      (method !== "text" && method !== "photo") ||
      !assignmentMethods(task.allowed_methods, task.kind).includes(method)
    )
      return { ok: false, message: "Pilih metode pengumpulan yang diizinkan guru." };
    const { data: existing, error: existingError } = await supabase
      .from("submissions")
      .select("status, score, graded_at, graded_by, updated_at")
      .eq("assignment_id", assignmentId)
      .eq("student_id", currentUser.id)
      .maybeSingle();
    if (existingError)
      return { ok: false, message: "Pengumpulan sebelumnya belum terbaca. Coba lagi." };
    if (
      existing &&
      (existing.status === "graded" ||
        existing.score != null ||
        existing.graded_at ||
        existing.graded_by)
    )
      return { ok: false, message: "Tugas ini sudah dinilai dan tidak bisa diubah lagi." };
    if ((existing?.updated_at ?? null) !== expected)
      return {
        ok: false,
        message: "Pengumpulan sudah berubah. Muat ulang halaman sebelum mengirim lagi.",
      };

    let content = String(formData.get("content") ?? "").trim();
    let uploadedPath: string | null = null;
    if (method === "text") {
      if (
        !content ||
        content.length > ASSIGNMENT_MAX_TEXT_LENGTH ||
        content.startsWith(`${ASSIGNMENT_PHOTO_BUCKET}/`)
      )
        return {
          ok: false,
          message: `Isi jawaban teks, maksimal ${ASSIGNMENT_MAX_TEXT_LENGTH.toLocaleString("id-ID")} karakter.`,
        };
    } else {
      const file = formData.get("photo");
      if (!(file instanceof File)) return { ok: false, message: "Pilih satu foto jawaban." };
      const validation = await validateAssignmentPhoto(file);
      if (!validation.ok) return validation;
      const upload = await uploadAssignmentPhoto(
        file,
        ASSIGNMENT_PHOTO_BUCKET,
        `${assignmentId}/${currentUser.id}`,
      );
      if (!upload.ok) return upload;
      uploadedPath = upload.path;
      content = `${ASSIGNMENT_PHOTO_BUCKET}/${upload.path}`;
    }
    // RPC rechecks eligibility and the previous answer under locks at the final write boundary.
    const { data, error } = await createAdminClient().rpc("save_assignment_submission", {
      p_assignment_id: assignmentId,
      p_student_id: currentUser.id,
      p_method: method,
      p_content: content,
      p_expected_updated_at: expected,
    });
    if (error || !data?.[0]) {
      // Only definitive database rejections are safe to clean up. An interrupted
      // response could have committed; never delete a potentially saved answer.
      if (
        uploadedPath &&
        error &&
        ["42501", "55000", "22023", "23503", "23505"].includes(error.code)
      )
        await discardAssignmentPhoto(ASSIGNMENT_PHOTO_BUCKET, uploadedPath);
      return {
        ok: false,
        message:
          error && ["42501", "55000", "22023"].includes(error.code)
            ? error.message
            : "Pengumpulan belum dapat dikonfirmasi. Muat ulang untuk memeriksa sebelum mencoba lagi.",
      };
    }
    const saved = data[0];
    // Signing is presentation-only: a failed preview must not report a saved answer as failed.
    const photoUrl = await assignmentPhotoUrl(content).catch(() => null);
    revalidatePath("/subjects", "layout");
    revalidatePath("/assessments");
    revalidatePath("/dashboard");
    return {
      ok: true,
      message: existing ? "Perubahan jawaban berhasil disimpan." : "Tugas berhasil dikumpulkan!",
      submission: {
        content,
        photoUrl,
        submittedAt: saved.submitted_at,
        updatedAt: saved.updated_at,
      },
    };
  } catch {
    return {
      ok: false,
      message:
        "Pengiriman belum dapat dikonfirmasi. Isian tetap tersedia; muat ulang untuk memeriksa status pengumpulan.",
    };
  }
}

export async function fetchQuizForStudent(assignmentId: string): Promise<StudentQuizData | null> {
  const currentUser = await getCurrentUser();
  if (assertRole(currentUser, ["student"]) || !currentUser?.classId) return null;
  if (!z.string().uuid().safeParse(assignmentId).success) return null;
  return getQuizForStudent(assignmentId, currentUser.id, currentUser.classId);
}

const quizAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selectedOptionId: z.string().uuid().optional(),
  trueFalseAnswer: z.enum(["benar", "salah"]).optional(),
  dragDropAnswer: z.record(z.string().uuid(), z.string().regex(/^[a-f0-9]{64}$/)).optional(),
  sequenceAnswer: z.array(z.string().uuid()).max(100).optional(),
});

type QuizAnswerInput = z.infer<typeof quizAnswerSchema>;

export async function submitQuizAnswers(
  assignmentId: string,
  answers: QuizAnswerInput[],
): Promise<{ ok: boolean; message: string; score?: number; submittedAt?: string | null }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["student"]);
  if (roleError) return roleError;
  if (!currentUser?.classId)
    return { ok: false, message: "Belum ada kelas pada tahun ajaran aktif." };

  const parsedAnswers = z.array(quizAnswerSchema).min(1).max(100).safeParse(answers);
  if (!z.string().uuid().safeParse(assignmentId).success || !parsedAnswers.success)
    return {
      ok: false,
      message:
        "Format jawaban kuis tidak valid. Muat ulang jika halaman kuis berasal dari versi lama.",
    };
  answers = parsedAnswers.data;

  try {
    const assignment = await getStudentQuizContext(assignmentId, currentUser.classId);
    if (!assignment) return { ok: false, message: "Kuis tidak tersedia untuk kelasmu." };
    const client = await createClient();
    const readSaved = async () => {
      const result = await client
        .from("submissions")
        .select("status, score, submitted_at")
        .eq("assignment_id", assignmentId)
        .eq("student_id", currentUser.id)
        .maybeSingle();
      if (result.error) throw new Error("Hasil sebelumnya belum terbaca.");
      return result.data;
    };
    const previous = await readSaved();
    // Recover a committed answer after a lost response, without creating another attempt.
    if (previous?.status === "graded")
      return {
        ok: true,
        message: "Jawaban kuis sudah tersimpan.",
        score: previous.score,
        submittedAt: previous.submitted_at,
      };
    if (
      !assignment.is_active ||
      (assignment.due_at && new Date(assignment.due_at).getTime() <= Date.now())
    )
      return { ok: false, message: "Kuis tidak aktif atau tenggat pengerjaannya sudah berakhir." };

    const questions = await readQuizBank(assignmentId);
    const bankError = quizBankError(questions);
    if (bankError)
      return {
        ok: false,
        message: "Susunan soal kuis belum valid. Hubungi guru sebelum mengumpulkan.",
      };
    const byId = new Map(answers.map((a) => [a.questionId, a]));
    if (
      answers.length !== questions.length ||
      byId.size !== questions.length ||
      questions.some((q) => !byId.has(q.id))
    )
      return { ok: false, message: "Jawab seluruh soal tepat satu kali sebelum mengumpulkan." };

    let score = 0;
    const answerRows = [];
    for (const q of questions) {
      const ans = byId.get(q.id)!;
      let fraction = 0;
      let selectedOptionId: string | null = null;
      let trueFalseAnswer: string | null = null;
      let dragDropAnswer: Record<string, string> | null = null;
      let sequenceAnswer: string[] | null = null;
      const invalid = {
        ok: false,
        message:
          "Ada jawaban yang belum lengkap atau tidak sesuai soal. Periksa kembali jawabanmu.",
      };
      if (q.question_type === "multiple_choice") {
        const chosen = q.quiz_options.find((o) => o.id === ans.selectedOptionId);
        if (!chosen) return invalid;
        selectedOptionId = chosen.id;
        fraction = chosen.is_correct ? 1 : 0;
      } else if (q.question_type === "true_false") {
        if (!ans.trueFalseAnswer) return invalid;
        trueFalseAnswer = ans.trueFalseAnswer;
        fraction = trueFalseAnswer === q.correct_answer_text ? 1 : 0;
      } else if (q.question_type === "drag_and_drop") {
        const pairs = q.quiz_pairs;
        const tokenToId = new Map(
          pairs.map((p) => [quizTargetToken(currentUser.id, assignmentId, p.id), p.id]),
        );
        const chosen = ans.dragDropAnswer ?? {};
        if (
          Object.keys(chosen).length !== pairs.length ||
          new Set(Object.values(chosen)).size !== pairs.length ||
          pairs.some((p) => !tokenToId.has(chosen[p.id]))
        )
          return invalid;
        dragDropAnswer = Object.fromEntries(pairs.map((p) => [p.id, tokenToId.get(chosen[p.id])!]));
        fraction = pairs.filter((p) => dragDropAnswer![p.id] === p.id).length / pairs.length;
      } else if (q.question_type === "sequence") {
        const chosen = ans.sequenceAnswer ?? [];
        const steps = q.quiz_steps;
        if (
          chosen.length !== steps.length ||
          new Set(chosen).size !== steps.length ||
          chosen.some((id) => !steps.some((step) => step.id === id))
        )
          return invalid;
        sequenceAnswer = chosen;
        fraction =
          chosen.filter((id, i) =>
            steps.some((step) => step.id === id && step.correct_order === i + 1),
          ).length / steps.length;
      }
      const points = Math.round(fraction * q.points);
      score += points;
      answerRows.push({
        question_id: q.id,
        selected_option_id: selectedOptionId,
        true_false_answer: trueFalseAnswer,
        drag_drop_answer: dragDropAnswer,
        sequence_answer: sequenceAnswer,
        points_earned: points,
      });
    }
    const { error } = await createAdminClient().rpc("save_scored_quiz", {
      p_assignment_id: assignmentId,
      p_student_id: currentUser.id,
      p_score: score,
      p_answers: answerRows,
    });
    if (error) {
      console.error("save_scored_quiz gagal", {
        code: error.code,
        message: error.message,
        details: error.details,
      });
      const saved = await readSaved();
      if (saved?.status === "graded")
        return {
          ok: true,
          message: "Jawaban kuis sudah tersimpan.",
          score: saved.score,
          submittedAt: saved.submitted_at,
        };
      return {
        ok: false,
        message:
          error.code === "PGRST202"
            ? "Konfigurasi penyimpanan kuis belum tersedia. Minta admin menjalankan migrasi database terbaru."
            : ["42501", "55000", "22023"].includes(error.code)
              ? error.message
              : "Pengumpulan belum dapat dikonfirmasi. Periksa status pengumpulan sebelum mencoba lagi.",
      };
    }
    revalidatePath("/subjects", "layout");
    revalidatePath("/assessments");
    revalidatePath("/dashboard");
    // The grade is committed. A failed timestamp read must not report it as unsaved.
    const saved = await readSaved().catch(() => null);
    return {
      ok: true,
      message: "Kuis berhasil dikumpulkan!",
      score,
      submittedAt: saved?.submitted_at ?? null,
    };
  } catch {
    return {
      ok: false,
      message:
        "Pengiriman belum dapat dikonfirmasi. Jawaban tetap tersedia; periksa koneksi dan status pengumpulan sebelum mencoba lagi.",
    };
  }
}
