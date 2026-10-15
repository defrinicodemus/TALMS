"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/data/profile";
import { assertRole } from "@/lib/auth/guard";
import { getQuizForStudent, type StudentQuizData } from "@/lib/data/subjects";
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
  if (assertRole(currentUser, ["student"])) return null;
  if (!currentUser) return null;
  return getQuizForStudent(assignmentId, currentUser.id);
}

const quizAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selectedOptionId: z.string().uuid().optional(),
  trueFalseAnswer: z.enum(["benar", "salah"]).optional(),
  dragDropAnswer: z.record(z.string().uuid(), z.string().uuid()).optional(),
  sequenceAnswer: z.array(z.string().uuid()).optional(),
});

type QuizAnswerInput = z.infer<typeof quizAnswerSchema>;

export async function submitQuizAnswers(
  assignmentId: string,
  answers: QuizAnswerInput[],
): Promise<{ ok: boolean; message: string; score?: number }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["student"]);
  if (roleError) return roleError;
  if (!currentUser) return { ok: false, message: "Tidak diizinkan." };

  const parsedAnswers = z.array(quizAnswerSchema).safeParse(answers);
  if (!z.string().uuid().safeParse(assignmentId).success || !parsedAnswers.success) {
    return { ok: false, message: "Format jawaban kuis tidak valid." };
  }
  answers = parsedAnswers.data;

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("submissions")
    .select("status")
    .eq("assignment_id", assignmentId)
    .eq("student_id", currentUser.id)
    .maybeSingle();
  if (existing?.status === "graded") {
    return { ok: false, message: "Kuis ini sudah pernah kamu kerjakan." };
  }

  const { data: questions, error: questionsError } = await supabase
    .from("quiz_questions")
    .select(
      "id, question_type, points, correct_answer_text, quiz_options(id, is_correct), quiz_pairs(id), quiz_steps(id, correct_order)",
    )
    .eq("assignment_id", assignmentId)
    .eq("is_active", true);

  if (questionsError || !questions || questions.length === 0) {
    return { ok: false, message: "Soal tidak ditemukan." };
  }

  let score = 0;
  const perQuestionPoints = new Map<string, number>();
  for (const q of questions) {
    const ans = answers.find((a) => a.questionId === q.id);
    if (!ans) continue;
    let fraction = 0;

    if (q.question_type === "multiple_choice") {
      const options = q.quiz_options as unknown as { id: string; is_correct: boolean }[];
      const correctOption = options.find((o) => o.is_correct);
      fraction = correctOption && ans.selectedOptionId === correctOption.id ? 1 : 0;
    } else if (q.question_type === "true_false") {
      fraction =
        (ans.trueFalseAnswer ?? "").toLowerCase() === (q.correct_answer_text ?? "").toLowerCase()
          ? 1
          : 0;
    } else if (q.question_type === "drag_and_drop") {
      const pairs = q.quiz_pairs as unknown as { id: string }[];
      if (pairs.length > 0 && ans.dragDropAnswer) {
        const correctCount = pairs.filter((p) => ans.dragDropAnswer?.[p.id] === p.id).length;
        fraction = correctCount / pairs.length;
      }
    } else if (q.question_type === "sequence") {
      const steps = q.quiz_steps as unknown as { id: string; correct_order: number }[];
      if (steps.length > 0 && ans.sequenceAnswer) {
        const stepById = new Map(steps.map((s) => [s.id, s.correct_order]));
        const correctCount = ans.sequenceAnswer.filter(
          (stepId, idx) => stepById.get(stepId) === idx + 1,
        ).length;
        fraction = correctCount / steps.length;
      }
    }

    const questionPoints = Math.round(fraction * q.points);
    perQuestionPoints.set(q.id, questionPoints);
    score += questionPoints;
  }
  const answerRows = questions
    .map((q) => {
      const ans = answers.find((a) => a.questionId === q.id);
      if (!ans) return null;
      return {
        question_id: q.id,
        selected_option_id: ans.selectedOptionId ?? null,
        true_false_answer: ans.trueFalseAnswer ?? null,
        drag_drop_answer: ans.dragDropAnswer ?? null,
        sequence_answer: ans.sequenceAnswer ?? null,
        points_earned: perQuestionPoints.get(q.id) ?? 0,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // This server action computes all points; the browser supplies only answers.
  // The RPC is service-role-only and rechecks eligibility before saving both
  // the submission and answer rows in one transaction.
  const admin = createAdminClient();
  const { error } = await admin.rpc("save_scored_quiz", {
    p_assignment_id: assignmentId,
    p_student_id: currentUser.id,
    p_score: score,
    p_answers: answerRows,
  });
  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/subjects");
  return { ok: true, message: "Kuis berhasil dikumpulkan!", score };
}
