"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/data/profile";
import { assertRole } from "@/lib/auth/guard";
import { getQuizForStudent, type StudentQuizData } from "@/lib/data/subjects";

export async function markMaterialViewed(materialId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (assertRole(currentUser, ["student"])) return;
  if (!currentUser) return;

  const supabase = await createClient();
  await supabase
    .from("material_views")
    .upsert(
      { material_id: materialId, student_id: currentUser.id },
      { onConflict: "material_id,student_id", ignoreDuplicates: true },
    );

  revalidatePath("/subjects");
}

export async function submitAssignment(
  assignmentId: string,
  content: string,
): Promise<{ ok: boolean; message: string }> {
  const currentUser = await getCurrentUser();
  const roleError = assertRole(currentUser, ["student"]);
  if (roleError) return roleError;
  if (!currentUser) return { ok: false, message: "Tidak diizinkan." };

  if (!content.trim()) {
    return { ok: false, message: "Jawaban tidak boleh kosong." };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("submissions")
    .select("status")
    .eq("assignment_id", assignmentId)
    .eq("student_id", currentUser.id)
    .maybeSingle();

  if (existing?.status === "graded") {
    return { ok: false, message: "Tugas ini sudah dinilai dan tidak bisa diubah lagi." };
  }

  const { error } = await supabase.from("submissions").upsert(
    {
      assignment_id: assignmentId,
      student_id: currentUser.id,
      content_url: content.trim(),
      status: "submitted",
      submitted_at: new Date().toISOString(),
    },
    { onConflict: "assignment_id,student_id" },
  );

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/subjects");
  return { ok: true, message: "Tugas berhasil dikirim!" };
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
