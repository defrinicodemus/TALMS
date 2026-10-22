import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeQuizStatus, type QuizStatus } from "@/lib/quizStatus";
import { assignmentMethods } from "@/lib/assignmentConstants";
import { assignmentPhotoUrl } from "@/lib/assignmentFiles";
import { getStudentQuizContext, readQuizBank, quizTargetToken } from "@/lib/quizServer";
import {
  buildQuizAnswerReview,
  type QuizAnswerReviewItem,
  type QuizStoredAnswer,
} from "@/lib/quizReview";

export type AssignmentStatus = "belum" | "dikerjakan" | "submitted" | "graded";

export interface MaterialContentRow {
  id: string;
  subjectId: string;
  title: string;
  kind: string;
  url: string | null;
  content: string | null;
  viewed: boolean;
  learningObjectiveTitle: string | null;
  createdAt: string;
}

export interface AssignmentContentRow {
  id: string;
  subjectId: string;
  title: string;
  kind: string;
  description: string | null;
  dueAt: string | null;
  learningObjectiveTitle: string | null;
  status: AssignmentStatus;
  score: number | null;
  teacherComment: string | null;
  submissionContent: string | null;
  questionCount: number;
  createdAt: string;
  attachmentImageUrl: string | null;
  attachmentImageName: string | null;
  isActive: boolean;
  quizStatus: QuizStatus;
}

export function appliesToGrade(
  gradeLevel: number | null,
  minGrade: number | null,
  maxGrade: number | null,
) {
  if (gradeLevel == null) return true;
  if (minGrade != null && gradeLevel < minGrade) return false;
  if (maxGrade != null && gradeLevel > maxGrade) return false;
  return true;
}

export async function getSubjectsExplorerData(classId: string | null, studentId: string | null) {
  const supabase = await createClient();
  const [{ data: subjects }, { data: klass }] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, code, name, emoji, color, min_grade, max_grade")
      .order("name"),
    classId
      ? supabase.from("classes").select("grade_level").eq("id", classId).single()
      : Promise.resolve({ data: null }),
  ]);
  const gradeLevel = klass?.grade_level ?? null;
  const visibleSubjects = (subjects ?? []).filter((s) =>
    appliesToGrade(gradeLevel, s.min_grade, s.max_grade),
  );

  const materialsBySubject: Record<string, MaterialContentRow[]> = {};
  const tugasBySubject: Record<string, AssignmentContentRow[]> = {};
  const kuisBySubject: Record<string, AssignmentContentRow[]> = {};

  if (classId) {
    const [{ data: materials }, { data: assignments }, { data: views }] = await Promise.all([
      supabase
        .from("materials")
        .select(
          "id, subject_id, title, kind, url, content, learning_objective_id, learning_objectives(title), created_at",
        )
        .eq("class_id", classId)
        .order("created_at", { ascending: false }),
      supabase
        .from("assignments")
        .select(
          "id, subject_id, title, kind, description, due_at, learning_objective_id, learning_objectives(title), created_at, attachment_image_url, attachment_image_name, is_active",
        )
        .eq("class_id", classId)
        .eq("is_published", true)
        .order("created_at", { ascending: false }),
      studentId
        ? supabase.from("material_views").select("material_id").eq("student_id", studentId)
        : Promise.resolve({ data: [] as { material_id: string }[] }),
    ]);

    const assignmentIds = (assignments ?? []).map((a) => a.id);
    const kuisIds = (assignments ?? []).filter((a) => a.kind === "quiz").map((a) => a.id);

    const [{ data: submissions }, { data: questionRows }] = await Promise.all([
      studentId && assignmentIds.length > 0
        ? supabase
            .from("submissions")
            .select("assignment_id, status, score, teacher_comment, content_url")
            .eq("student_id", studentId)
            .in("assignment_id", assignmentIds)
        : Promise.resolve({
            data: [] as {
              assignment_id: string;
              status: AssignmentStatus;
              score: number | null;
              teacher_comment: string | null;
              content_url: string | null;
            }[],
          }),
      // Question count is non-sensitive metadata (no question content), so use the admin
      // client to bypass the is_active-gated RLS — a nonaktif quiz should still show its
      // real question count on the card even though its content stays inaccessible.
      kuisIds.length > 0
        ? createAdminClient()
            .from("quiz_questions")
            .select("assignment_id")
            .eq("is_active", true)
            .in("assignment_id", kuisIds)
        : Promise.resolve({ data: [] as { assignment_id: string }[] }),
    ]);

    const submissionByAssignment = new Map((submissions ?? []).map((s) => [s.assignment_id, s]));
    const questionCountByAssignment = new Map<string, number>();
    for (const q of questionRows ?? []) {
      questionCountByAssignment.set(
        q.assignment_id,
        (questionCountByAssignment.get(q.assignment_id) ?? 0) + 1,
      );
    }

    const viewedIds = new Set((views ?? []).map((v) => v.material_id));
    for (const m of materials ?? []) {
      (materialsBySubject[m.subject_id] ??= []).push({
        id: m.id,
        subjectId: m.subject_id,
        title: m.title,
        kind: m.kind,
        url: m.url,
        content: m.content,
        viewed: viewedIds.has(m.id),
        learningObjectiveTitle:
          (m.learning_objectives as unknown as { title: string } | null)?.title ?? null,
        createdAt: m.created_at,
      });
    }
    for (const a of assignments ?? []) {
      const sub = submissionByAssignment.get(a.id);
      const row: AssignmentContentRow = {
        id: a.id,
        subjectId: a.subject_id,
        title: a.title,
        kind: a.kind,
        description: a.description,
        dueAt: a.due_at,
        learningObjectiveTitle:
          (a.learning_objectives as unknown as { title: string } | null)?.title ?? null,
        status: sub?.status ?? "belum",
        score: sub?.score ?? null,
        teacherComment: sub?.teacher_comment ?? null,
        submissionContent: sub?.content_url ?? null,
        questionCount: questionCountByAssignment.get(a.id) ?? 0,
        createdAt: a.created_at,
        attachmentImageUrl: a.attachment_image_url,
        attachmentImageName: a.attachment_image_name,
        isActive: a.is_active,
        quizStatus: computeQuizStatus(true, a.is_active, a.due_at),
      };
      const bucket = a.kind === "quiz" ? kuisBySubject : tugasBySubject;
      (bucket[a.subject_id] ??= []).push(row);
    }
  }

  return { subjects: visibleSubjects, materialsBySubject, tugasBySubject, kuisBySubject };
}

export async function getMaterialForStudent(
  materialId: string,
  studentId: string | null,
): Promise<MaterialContentRow | null> {
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("materials")
    .select(
      "id, subject_id, title, kind, url, content, learning_objective_id, learning_objectives(title), created_at",
    )
    .eq("id", materialId)
    .maybeSingle();
  if (!m) return null;

  let viewed = false;
  if (studentId) {
    const { data: view } = await supabase
      .from("material_views")
      .select("material_id")
      .eq("material_id", materialId)
      .eq("student_id", studentId)
      .maybeSingle();
    viewed = !!view;
  }

  return {
    id: m.id,
    subjectId: m.subject_id,
    title: m.title,
    kind: m.kind,
    url: m.url,
    content: m.content,
    viewed,
    learningObjectiveTitle:
      (m.learning_objectives as unknown as { title: string } | null)?.title ?? null,
    createdAt: m.created_at,
  };
}

export interface StudentAssignmentDetail extends AssignmentContentRow {
  allowedMethods: ("text" | "photo")[];
  submittedAt: string | null;
  submissionUpdatedAt: string | null;
  submissionPhotoUrl: string | null;
}

export async function getAssignmentForStudent(
  assignmentId: string,
  studentId: string | null,
): Promise<StudentAssignmentDetail | null> {
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("assignments")
    .select(
      "id, subject_id, title, kind, description, due_at, learning_objective_id, learning_objectives(title), created_at, attachment_image_url, attachment_image_name, is_active, allowed_methods",
    )
    .eq("id", assignmentId)
    .maybeSingle();
  if (!a) return null;

  let sub: {
    status: AssignmentStatus;
    score: number | null;
    teacher_comment: string | null;
    content_url: string | null;
    submitted_at: string | null;
    updated_at: string;
  } | null = null;
  if (studentId) {
    const { data } = await supabase
      .from("submissions")
      .select("status, score, teacher_comment, content_url, submitted_at, updated_at")
      .eq("assignment_id", assignmentId)
      .eq("student_id", studentId)
      .maybeSingle();
    sub = data;
  }

  let questionCount = 0;
  if (a.kind === "quiz") {
    // Same reasoning as getSubjectsExplorerData: question count is non-sensitive
    // metadata, so use the admin client to bypass the is_active-gated RLS.
    const { count } = await createAdminClient()
      .from("quiz_questions")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId)
      .eq("is_active", true);
    questionCount = count ?? 0;
  }

  return {
    id: a.id,
    subjectId: a.subject_id,
    title: a.title,
    kind: a.kind,
    description: a.description,
    dueAt: a.due_at,
    learningObjectiveTitle:
      (a.learning_objectives as unknown as { title: string } | null)?.title ?? null,
    status: sub?.status ?? "belum",
    score: sub?.score ?? null,
    teacherComment: sub?.teacher_comment ?? null,
    submissionContent: sub?.content_url ?? null,
    allowedMethods: assignmentMethods(a.allowed_methods, a.kind),
    submittedAt: sub?.submitted_at ?? null,
    submissionUpdatedAt: sub?.updated_at ?? null,
    submissionPhotoUrl: await assignmentPhotoUrl(sub?.content_url ?? null).catch(() => null),
    questionCount,
    createdAt: a.created_at,
    attachmentImageUrl: a.attachment_image_url,
    attachmentImageName: a.attachment_image_name,
    isActive: a.is_active,
    quizStatus: computeQuizStatus(true, a.is_active, a.due_at),
  };
}

export type StudentQuestionType = "multiple_choice" | "true_false" | "drag_and_drop" | "sequence";

export interface StudentQuizOption {
  id: string;
  text: string;
}

export interface StudentQuizBlock {
  id: string;
  text: string;
}

export interface StudentQuizQuestion {
  id: string;
  questionText: string;
  questionType: StudentQuestionType;
  points: number;
  options: StudentQuizOption[];
  dragBlocks: StudentQuizBlock[];
  targetBlocks: StudentQuizBlock[];
  steps: StudentQuizBlock[];
}

export interface StudentQuizData {
  questions: StudentQuizQuestion[];
  alreadySubmitted: boolean;
  score: number | null;
  timerMinutes: number | null;
  passingGrade: number | null;
  submittedAt: string | null;
  dueAt: string | null;
  isActive: boolean;
  review: QuizAnswerReviewItem[] | null;
}

function shuffle<T>(items: T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function getQuizForStudent(
  assignmentId: string,
  studentId: string,
  classId: string,
): Promise<StudentQuizData | null> {
  const assignment = await getStudentQuizContext(assignmentId, classId);
  if (!assignment) return null;
  const supabase = await createClient();
  const { data: submission, error } = await supabase
    .from("submissions")
    .select("id, status, score, submitted_at")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw new Error("Hasil kuis belum dapat dibaca. Silakan coba lagi.");
  const alreadySubmitted = submission?.status === "graded";
  const expired = !!assignment.due_at && new Date(assignment.due_at).getTime() <= Date.now();
  const questions =
    !alreadySubmitted && assignment.is_active && !expired ? await readQuizBank(assignmentId) : [];
  let review: QuizAnswerReviewItem[] | null = null;
  // Only a confirmed graded submission unlocks its feedback. No browser flag
  // or caller-supplied student ID can unlock another student's answer key.
  if (alreadySubmitted && submission) {
    const { data: answers, error: answerError } = await supabase
      .from("quiz_answers")
      .select(
        "question_id, selected_option_id, true_false_answer, drag_drop_answer, sequence_answer, points_earned",
      )
      .eq("submission_id", submission.id);
    if (answerError) throw new Error("Pembahasan belum dapat dimuat. Silakan coba lagi.");
    review = buildQuizAnswerReview(
      await readQuizBank(assignmentId, true),
      (answers ?? []) as QuizStoredAnswer[],
    );
  }

  const mapped: StudentQuizQuestion[] = (questions ?? []).map((q) => {
    const options = (
      (q.quiz_options as unknown as { id: string; option_text: string; sort_order: number }[]) ?? []
    )
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((o) => ({ id: o.id, text: o.option_text }));
    const pairs =
      (q.quiz_pairs as unknown as { id: string; drag_text: string; target_text: string }[]) ?? [];
    const steps = (q.quiz_steps as unknown as { id: string; step_text: string }[]) ?? [];
    return {
      id: q.id,
      questionText: q.question_text,
      questionType: q.question_type as StudentQuestionType,
      points: q.points,
      options,
      dragBlocks: shuffle(pairs.map((p) => ({ id: p.id, text: p.drag_text }))),
      targetBlocks: shuffle(
        pairs.map((p) => ({
          id: quizTargetToken(studentId, assignmentId, p.id),
          text: p.target_text,
        })),
      ),
      steps: shuffle(steps.map((s) => ({ id: s.id, text: s.step_text }))),
    };
  });

  return {
    questions: mapped,
    alreadySubmitted,
    score: submission?.score ?? null,
    timerMinutes: assignment.timer_minutes ?? null,
    passingGrade: assignment.passing_grade ?? null,
    submittedAt: submission?.submitted_at ?? null,
    dueAt: assignment.due_at,
    isActive: assignment.is_active,
    review,
  };
}
