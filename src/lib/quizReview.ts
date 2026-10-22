import type { QuizBankQuestion } from "@/lib/quizServer";

export type ReviewQuestionType =
  "multiple_choice" | "true_false" | "drag_and_drop" | "sequence" | "short_answer";

const REVIEW_QUESTION_TYPE_LABEL: Record<ReviewQuestionType, string> = {
  multiple_choice: "Pilihan Ganda",
  true_false: "True or False",
  drag_and_drop: "Drag and Drop",
  sequence: "Langkah-langkah",
  short_answer: "Isian Singkat",
};

export interface QuizAnswerReviewItem {
  questionId: string;
  questionTypeLabel: string;
  questionText: string;
  points: number;
  pointsEarned: number;
  studentAnswerLabel: string;
  correctAnswerLabel: string;
  explanation: string | null;
}

export interface QuizStoredAnswer {
  question_id: string;
  selected_option_id: string | null;
  true_false_answer: string | null;
  drag_drop_answer: Record<string, string> | null;
  sequence_answer: string[] | null;
  points_earned: number;
}

export function buildQuizAnswerReview(
  questions: QuizBankQuestion[],
  answers: QuizStoredAnswer[],
): QuizAnswerReviewItem[] {
  const answerByQuestion = new Map(answers.map((a) => [a.question_id, a]));

  // Unused inactive draft questions were never presented to the student.
  // Retain answered legacy questions even if they were disabled before this protection.
  return questions
    .filter((q) => q.is_active !== false || answerByQuestion.has(q.id))
    .map((q) => {
      const ans = answerByQuestion.get(q.id);
      const questionType = q.question_type as ReviewQuestionType;
      let studentAnswerLabel = "Tidak dijawab";
      let correctAnswerLabel = "-";

      if (questionType === "multiple_choice") {
        const options = (
          q.quiz_options as unknown as { id: string; option_text: string; is_correct: boolean }[]
        ).slice();
        const chosen = options.find((o) => o.id === ans?.selected_option_id);
        const correct = options.find((o) => o.is_correct);
        studentAnswerLabel = chosen?.option_text ?? "Tidak dijawab";
        correctAnswerLabel = correct?.option_text ?? "-";
      } else if (questionType === "true_false") {
        const label = (v: string | null) =>
          v === "salah" ? "Salah" : v === "benar" ? "Benar" : null;
        studentAnswerLabel = label(ans?.true_false_answer ?? null) ?? "Tidak dijawab";
        correctAnswerLabel = label(q.correct_answer_text) ?? "-";
      } else if (questionType === "drag_and_drop") {
        const pairs = (
          q.quiz_pairs as unknown as { id: string; drag_text: string; target_text: string }[]
        ).slice();
        const dragAnswer = (ans?.drag_drop_answer as Record<string, string> | null) ?? null;
        if (dragAnswer) {
          studentAnswerLabel = pairs
            .map((p) => {
              const chosenTargetId = dragAnswer[p.id];
              const chosenTarget = pairs.find((t) => t.id === chosenTargetId);
              return `${p.drag_text} → ${chosenTarget?.target_text ?? "?"}`;
            })
            .join("; ");
        }
        correctAnswerLabel = pairs.map((p) => `${p.drag_text} → ${p.target_text}`).join("; ");
      } else if (questionType === "sequence") {
        const steps = (
          q.quiz_steps as unknown as { id: string; step_text: string; correct_order: number }[]
        ).slice();
        const stepById = new Map(steps.map((s) => [s.id, s.step_text]));
        const sequenceAnswer = (ans?.sequence_answer as string[] | null) ?? null;
        if (sequenceAnswer) {
          studentAnswerLabel = sequenceAnswer
            .map((id, i) => `${i + 1}. ${stepById.get(id) ?? "?"}`)
            .join(" ");
        }
        correctAnswerLabel = steps
          .slice()
          .sort((a, b) => a.correct_order - b.correct_order)
          .map((s, i) => `${i + 1}. ${s.step_text}`)
          .join(" ");
      }

      return {
        questionId: q.id,
        questionTypeLabel: REVIEW_QUESTION_TYPE_LABEL[questionType] ?? questionType,
        questionText: q.question_text,
        points: q.points,
        pointsEarned: ans?.points_earned ?? 0,
        studentAnswerLabel,
        correctAnswerLabel,
        explanation: q.explanation,
      };
    });
}
