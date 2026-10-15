import { createClient } from "@/lib/supabase/server";
import { assignmentMethods } from "@/lib/assignmentConstants";
import { computeQuizStatus, type QuizStatus } from "@/lib/quizStatus";

export type MaterialKind = "pdf" | "video" | "text" | "image" | "slideshow";

export interface MaterialRow {
  id: string;
  title: string;
  kind: MaterialKind;
  url: string | null;
  content: string | null;
  learningObjectiveId: string | null;
  learningObjectiveTitle: string | null;
  isActive: boolean;
  createdAt: string;
}

export async function getClassroomMaterials(
  classId: string,
  subjectId: string,
): Promise<MaterialRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("materials")
    .select(
      "id, title, kind, url, content, learning_objective_id, learning_objectives(title), is_active, created_at",
    )
    .eq("class_id", classId)
    .eq("subject_id", subjectId)
    .order("created_at", { ascending: false });

  return (data ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    kind: m.kind,
    url: m.url,
    content: m.content,
    learningObjectiveId: m.learning_objective_id,
    learningObjectiveTitle:
      (m.learning_objectives as unknown as { title: string } | null)?.title ?? null,
    isActive: m.is_active,
    createdAt: m.created_at,
  }));
}

export type AssignmentKind = "essay" | "photo" | "audio" | "text";
export type AssignmentMethod = "text" | "photo";

export interface AssignmentRow {
  id: string;
  title: string;
  kind: AssignmentKind;
  description: string | null;
  dueAt: string | null;
  learningObjectiveId: string | null;
  learningObjectiveTitle: string | null;
  createdAt: string;
  allowedMethods: AssignmentMethod[];
  isPublished: boolean;
  attachmentImageUrl: string | null;
  attachmentImageName: string | null;
}

export async function getClassroomAssignments(
  classId: string,
  subjectId: string,
): Promise<AssignmentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("assignments")
    .select(
      "id, title, kind, description, due_at, learning_objective_id, learning_objectives(title), created_at, allowed_methods, is_published, attachment_image_url, attachment_image_name",
    )
    .eq("class_id", classId)
    .eq("subject_id", subjectId)
    .neq("kind", "quiz")
    .order("created_at", { ascending: false });

  return (data ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    kind: a.kind,
    description: a.description,
    dueAt: a.due_at,
    learningObjectiveId: a.learning_objective_id,
    learningObjectiveTitle:
      (a.learning_objectives as unknown as { title: string } | null)?.title ?? null,
    createdAt: a.created_at,
    allowedMethods: assignmentMethods(a.allowed_methods, a.kind),
    isPublished: a.is_published,
    attachmentImageUrl: a.attachment_image_url,
    attachmentImageName: a.attachment_image_name,
  }));
}

export type QuizType = "latihan" | "ulangan_harian" | "uts" | "uas";

export interface QuizRow {
  id: string;
  title: string;
  description: string | null;
  quizType: QuizType | null;
  dueAt: string | null;
  timerMinutes: number | null;
  passingGrade: number | null;
  learningObjectiveId: string | null;
  learningObjectiveTitle: string | null;
  createdAt: string;
  questionCount: number;
  totalPoints: number;
  isPublished: boolean;
  isActive: boolean;
  status: QuizStatus;
}

export async function getClassroomQuizzes(classId: string, subjectId: string): Promise<QuizRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("assignments")
    .select(
      "id, title, description, quiz_type, due_at, timer_minutes, passing_grade, learning_objective_id, learning_objectives(title), created_at, is_published, is_active, quiz_questions(id, points, is_active)",
    )
    .eq("class_id", classId)
    .eq("subject_id", subjectId)
    .eq("kind", "quiz")
    .order("created_at", { ascending: false });

  return (data ?? []).map((a) => {
    const questions =
      (a.quiz_questions as unknown as
        { id: string; points: number; is_active: boolean }[] | null) ?? [];
    const activeQuestions = questions.filter((q) => q.is_active);
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      quizType: a.quiz_type as QuizType | null,
      dueAt: a.due_at,
      timerMinutes: a.timer_minutes,
      passingGrade: a.passing_grade,
      learningObjectiveId: a.learning_objective_id,
      learningObjectiveTitle:
        (a.learning_objectives as unknown as { title: string } | null)?.title ?? null,
      createdAt: a.created_at,
      questionCount: activeQuestions.length,
      totalPoints: activeQuestions.reduce((sum, q) => sum + q.points, 0),
      isPublished: a.is_published,
      isActive: a.is_active,
      status: computeQuizStatus(a.is_published, a.is_active, a.due_at),
    };
  });
}

export type QuestionType =
  "multiple_choice" | "true_false" | "drag_and_drop" | "sequence" | "short_answer";

export interface QuizOptionRow {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface QuizPairRow {
  id: string;
  dragText: string;
  targetText: string;
  sortOrder: number;
}

export interface QuizStepRow {
  id: string;
  stepText: string;
  correctOrder: number;
}

export interface QuizQuestionRow {
  id: string;
  questionText: string;
  questionType: QuestionType;
  points: number;
  isActive: boolean;
  explanation: string | null;
  correctAnswerText: string | null;
  sortOrder: number;
  options: QuizOptionRow[];
  pairs: QuizPairRow[];
  steps: QuizStepRow[];
}

export async function getQuizQuestions(assignmentId: string): Promise<QuizQuestionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("quiz_questions")
    .select(
      "id, question_text, question_type, correct_answer_text, points, is_active, explanation, sort_order, quiz_options(id, option_text, is_correct, sort_order), quiz_pairs(id, drag_text, target_text, sort_order), quiz_steps(id, step_text, correct_order)",
    )
    .eq("assignment_id", assignmentId)
    .order("sort_order");

  return (data ?? []).map((q) => ({
    id: q.id,
    questionText: q.question_text,
    questionType: q.question_type as QuestionType,
    points: q.points,
    isActive: q.is_active,
    explanation: q.explanation,
    correctAnswerText: q.correct_answer_text,
    sortOrder: q.sort_order,
    options: (
      (q.quiz_options as unknown as
        { id: string; option_text: string; is_correct: boolean; sort_order: number }[] | null) ?? []
    )
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((o) => ({ id: o.id, text: o.option_text, isCorrect: o.is_correct })),
    pairs: (
      (q.quiz_pairs as unknown as
        { id: string; drag_text: string; target_text: string; sort_order: number }[] | null) ?? []
    )
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => ({
        id: p.id,
        dragText: p.drag_text,
        targetText: p.target_text,
        sortOrder: p.sort_order,
      })),
    steps: (
      (q.quiz_steps as unknown as
        { id: string; step_text: string; correct_order: number }[] | null) ?? []
    )
      .slice()
      .sort((a, b) => a.correct_order - b.correct_order)
      .map((s) => ({ id: s.id, stepText: s.step_text, correctOrder: s.correct_order })),
  }));
}
