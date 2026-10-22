import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface QuizBankQuestion {
  id: string;
  question_text: string;
  question_type: string;
  points: number;
  correct_answer_text: string | null;
  explanation: string | null;
  sort_order: number;
  is_active: boolean;
  quiz_options: { id: string; option_text: string; is_correct: boolean; sort_order: number }[];
  quiz_pairs: { id: string; drag_text: string; target_text: string; sort_order: number }[];
  quiz_steps: { id: string; step_text: string; correct_order: number }[];
}

// Authorize through the student's session before reading any question-bank rows
// with the server client. The caller obtains student/class IDs from getCurrentUser.
export async function getStudentQuizContext(assignmentId: string, classId: string) {
  const client = await createClient();
  const { data, error } = await client
    .from("assignments")
    .select("id, is_active, due_at, timer_minutes, passing_grade")
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .eq("kind", "quiz")
    .eq("is_published", true)
    .maybeSingle();
  if (error) throw new Error("Kuis belum dapat dibaca. Silakan coba lagi.");
  return data;
}

export async function readQuizBank(
  assignmentId: string,
  includeInactive = false,
): Promise<QuizBankQuestion[]> {
  let query = createAdminClient()
    .from("quiz_questions")
    .select(
      "id, question_text, question_type, points, correct_answer_text, explanation, sort_order, is_active, quiz_options(id, option_text, is_correct, sort_order), quiz_pairs(id, drag_text, target_text, sort_order), quiz_steps(id, step_text, correct_order)",
    )
    .eq("assignment_id", assignmentId)
    .order("sort_order");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw new Error("Soal belum dapat dibaca. Silakan coba lagi.");
  return (data ?? []) as unknown as QuizBankQuestion[];
}

// A matching target must not expose the pair ID shared with its correct prompt.
// Stable, student-scoped tokens need no attempt table and cannot be reversed by
// the browser. Saved answers still use the original IDs for existing reviews.
export function quizTargetToken(studentId: string, assignmentId: string, pairId: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Konfigurasi kuis belum tersedia.");
  return createHmac("sha256", secret)
    .update(JSON.stringify(["quiz-target-v1", studentId, assignmentId, pairId]))
    .digest("hex");
}

export function quizBankError(questions: QuizBankQuestion[]): string | null {
  if (!questions.length || questions.reduce((sum, q) => sum + q.points, 0) !== 100)
    return "Total bobot soal aktif harus tepat 100 poin.";
  for (const q of questions) {
    if (!q.question_text.trim() || !Number.isInteger(q.points) || q.points <= 0)
      return "Pertanyaan dan bobot soal belum lengkap.";
    if (q.question_type === "multiple_choice") {
      if (
        q.quiz_options.length < 2 ||
        q.quiz_options.some((o) => !o.option_text.trim()) ||
        q.quiz_options.filter((o) => o.is_correct).length !== 1
      )
        return "Pilihan ganda harus memiliki minimal dua pilihan dan satu jawaban benar.";
    } else if (q.question_type === "true_false") {
      if (!["benar", "salah"].includes(q.correct_answer_text ?? ""))
        return "Kunci jawaban Benar/Salah belum lengkap.";
    } else if (q.question_type === "drag_and_drop") {
      if (
        q.quiz_pairs.length < 2 ||
        q.quiz_pairs.some((p) => !p.drag_text.trim() || !p.target_text.trim())
      )
        return "Soal mencocokkan harus memiliki minimal dua pasangan lengkap.";
    } else if (q.question_type === "sequence") {
      const steps = q.quiz_steps.slice().sort((a, b) => a.correct_order - b.correct_order);
      if (
        steps.length < 2 ||
        steps.some((s, i) => !s.step_text.trim() || s.correct_order !== i + 1)
      )
        return "Soal mengurutkan harus memiliki minimal dua langkah dengan urutan yang valid.";
    } else return "Jenis soal belum didukung untuk penilaian otomatis.";
  }
  return null;
}
