import {
  buildQuizAnswerReview,
  type QuizStoredAnswer,
  type QuizAnswerReviewItem,
} from "@/lib/quizReview";
import type { QuizBankQuestion } from "@/lib/quizServer";
export type { QuizAnswerReviewItem } from "@/lib/quizReview";
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
  const [assignmentsResult, studentsResult] = await Promise.all([
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
  if (assignmentsResult.error || studentsResult.error) {
    throw new Error("Daftar tugas belum dapat dimuat. Coba lagi.");
  }
  const assignments = assignmentsResult.data;
  const totalStudents = studentsResult.count;

  const assignmentIds = (assignments ?? []).map((a) => a.id);
  const submissionsResult =
    assignmentIds.length > 0
      ? await supabase
          .from("submissions")
          .select("assignment_id, status")
          .in("assignment_id", assignmentIds)
      : { data: [] as { assignment_id: string; status: string }[], error: null };
  if (submissionsResult.error) throw new Error("Status pengumpulan belum dapat dimuat. Coba lagi.");
  const submissions = submissionsResult.data;

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
  const [studentsResult, submissionsResult] = await Promise.all([
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
  if (studentsResult.error || submissionsResult.error) {
    throw new Error("Jawaban siswa belum dapat dimuat. Coba lagi.");
  }
  const students = studentsResult.data;
  const submissions = submissionsResult.data;

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
  const [quizzesResult, studentsResult] = await Promise.all([
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
  if (quizzesResult.error || studentsResult.error) {
    throw new Error("Hasil kuis belum dapat dimuat. Coba lagi.");
  }
  const quizzes = quizzesResult.data;
  const students = studentsResult.data;

  const quizIds = (quizzes ?? []).map((q) => q.id);
  const submissionsResult =
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
          error: null,
        };
  if (submissionsResult.error) throw new Error("Nilai kuis belum dapat dimuat. Coba lagi.");
  const submissions = submissionsResult.data;

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

export async function getQuizAnswerReview(
  assignmentId: string,
  studentId: string,
): Promise<QuizAnswerReviewItem[]> {
  const supabase = await createClient();

  const [{ data: submission, error: submissionError }, { data: questions, error: questionsError }] =
    await Promise.all([
      supabase
        .from("submissions")
        .select("id")
        .eq("assignment_id", assignmentId)
        .eq("student_id", studentId)
        .maybeSingle(),
      supabase
        .from("quiz_questions")
        .select(
          "id, question_text, question_type, points, correct_answer_text, explanation, sort_order, is_active, quiz_options(id, option_text, is_correct, sort_order), quiz_pairs(id, drag_text, target_text, sort_order), quiz_steps(id, step_text, correct_order)",
        )
        .eq("assignment_id", assignmentId)
        .order("sort_order", { ascending: true }),
    ]);

  if (submissionError || questionsError)
    throw new Error("Hasil kuis belum dapat dibaca. Coba lagi.");
  if (!submission || !questions) return [];

  const { data: answers, error: answersError } = await supabase
    .from("quiz_answers")
    .select(
      "question_id, selected_option_id, true_false_answer, drag_drop_answer, sequence_answer, points_earned",
    )
    .eq("submission_id", submission.id);

  if (answersError) throw new Error("Jawaban belum dapat dibaca. Coba lagi.");
  return buildQuizAnswerReview(
    questions as unknown as QuizBankQuestion[],
    (answers ?? []) as QuizStoredAnswer[],
  );
}
