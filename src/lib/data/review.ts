import { createClient } from "@/lib/supabase/server";
import { assignmentMethods } from "@/lib/assignmentConstants";

export interface ReviewAssignmentRow {
  id: string;
  title: string;
  kind: string;
  allowedMethods: ("text" | "photo")[];
  description: string | null;
  dueAt: string | null;
  learningObjectiveTitle: string | null;
  totalStudents: number;
  submittedCount: number;
  gradedCount: number;
}

export async function getReviewAssignments(
  classId: string,
  subjectId: string,
): Promise<ReviewAssignmentRow[]> {
  const supabase = await createClient();
  const [{ data: assignments }, { count: totalStudents }] = await Promise.all([
    supabase
      .from("assignments")
      .select(
        "id, title, kind, allowed_methods, description, due_at, learning_objective_id, learning_objectives(title)",
      )
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .neq("kind", "quiz")
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("class_id", classId)
      .eq("role", "student"),
  ]);

  const assignmentIds = (assignments ?? []).map((a) => a.id);
  const { data: submissions } =
    assignmentIds.length > 0
      ? await supabase
          .from("submissions")
          .select("assignment_id, status")
          .in("assignment_id", assignmentIds)
      : { data: [] as { assignment_id: string; status: string }[] };

  const statsByAssignment = new Map<string, { submitted: number; graded: number }>();
  for (const s of submissions ?? []) {
    const stat = statsByAssignment.get(s.assignment_id) ?? { submitted: 0, graded: 0 };
    if (s.status === "submitted" || s.status === "graded") stat.submitted++;
    if (s.status === "graded") stat.graded++;
    statsByAssignment.set(s.assignment_id, stat);
  }

  return (assignments ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    kind: a.kind,
    allowedMethods: assignmentMethods(a.allowed_methods, a.kind),
    description: a.description,
    dueAt: a.due_at,
    learningObjectiveTitle:
      (a.learning_objectives as unknown as { title: string } | null)?.title ?? null,
    totalStudents: totalStudents ?? 0,
    submittedCount: statsByAssignment.get(a.id)?.submitted ?? 0,
    gradedCount: statsByAssignment.get(a.id)?.graded ?? 0,
  }));
}

export interface StudentSubmissionRow {
  studentId: string;
  studentName: string;
  avatar: string | null;
  submissionId: string | null;
  status: string;
  submittedAt: string | null;
  contentUrl: string | null;
  score: number | null;
  teacherComment: string | null;
}

export async function getAssignmentSubmissions(
  assignmentId: string,
  classId: string,
): Promise<StudentSubmissionRow[]> {
  const supabase = await createClient();
  const [{ data: students }, { data: submissions }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, avatar_emoji")
      .eq("class_id", classId)
      .eq("role", "student")
      .order("full_name"),
    supabase
      .from("submissions")
      .select("id, student_id, status, submitted_at, content_url, score, teacher_comment")
      .eq("assignment_id", assignmentId),
  ]);

  const submissionByStudent = new Map((submissions ?? []).map((s) => [s.student_id, s]));

  return (students ?? []).map((st) => {
    const sub = submissionByStudent.get(st.id);
    return {
      studentId: st.id,
      studentName: st.full_name,
      avatar: st.avatar_emoji,
      submissionId: sub?.id ?? null,
      status: sub?.status ?? "belum",
      submittedAt: sub?.submitted_at ?? null,
      contentUrl: sub?.content_url ?? null,
      score: sub?.score ?? null,
      teacherComment: sub?.teacher_comment ?? null,
    };
  });
}

export interface QuizResultStudentRow {
  studentId: string;
  studentName: string;
  submissionId: string | null;
  submittedAt: string | null;
  score: number | null;
  status: string;
}

export interface QuizResultRow {
  quizId: string;
  quizTitle: string;
  passingGrade: number | null;
  results: QuizResultStudentRow[];
}

export async function getQuizResults(classId: string, subjectId: string): Promise<QuizResultRow[]> {
  const supabase = await createClient();
  const [{ data: quizzes }, { data: students }] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, title, passing_grade")
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .eq("kind", "quiz")
      .eq("is_published", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("class_id", classId)
      .eq("role", "student")
      .order("full_name"),
  ]);

  const quizIds = (quizzes ?? []).map((q) => q.id);
  const { data: submissions } =
    quizIds.length > 0
      ? await supabase
          .from("submissions")
          .select("id, assignment_id, student_id, score, status, submitted_at")
          .in("assignment_id", quizIds)
      : {
          data: [] as {
            id: string;
            assignment_id: string;
            student_id: string;
            score: number | null;
            status: string;
            submitted_at: string | null;
          }[],
        };

  const subByKey = new Map(
    (submissions ?? []).map((s) => [`${s.assignment_id}:${s.student_id}`, s]),
  );

  return (quizzes ?? []).map((q) => ({
    quizId: q.id,
    quizTitle: q.title,
    passingGrade: q.passing_grade,
    results: (students ?? []).map((st) => {
      const sub = subByKey.get(`${q.id}:${st.id}`);
      return {
        studentId: st.id,
        studentName: st.full_name,
        submissionId: sub?.id ?? null,
        submittedAt: sub?.submitted_at ?? null,
        score: sub?.score ?? null,
        status: sub?.status ?? "belum",
      };
    }),
  }));
}

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
}

export async function getQuizAnswerReview(
  assignmentId: string,
  studentId: string,
): Promise<QuizAnswerReviewItem[]> {
  const supabase = await createClient();

  const [{ data: submission }, { data: questions }] = await Promise.all([
    supabase
      .from("submissions")
      .select("id")
      .eq("assignment_id", assignmentId)
      .eq("student_id", studentId)
      .maybeSingle(),
    supabase
      .from("quiz_questions")
      .select(
        "id, question_text, question_type, points, correct_answer_text, sort_order, quiz_options(id, option_text, is_correct, sort_order), quiz_pairs(id, drag_text, target_text, sort_order), quiz_steps(id, step_text, correct_order)",
      )
      .eq("assignment_id", assignmentId)
      .order("sort_order", { ascending: true }),
  ]);

  if (!submission || !questions) return [];

  const { data: answers } = await supabase
    .from("quiz_answers")
    .select(
      "question_id, selected_option_id, true_false_answer, drag_drop_answer, sequence_answer, points_earned",
    )
    .eq("submission_id", submission.id);

  const answerByQuestion = new Map((answers ?? []).map((a) => [a.question_id, a]));

  return questions.map((q) => {
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
    };
  });
}
