"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/data/profile";
import {
  getStudentHistory,
  type GradebookReadiness,
  type GradebookReadinessActivity,
  type GradebookReadinessObjective,
  type StudentHistoryData,
} from "@/lib/data/gradebook";

type GradebookActionResult = { ok: boolean; message: string };
type ReadinessResult = { ok: true; data: GradebookReadiness } | { ok: false; message: string };

const uuid = z.string().uuid();

function validPair(classId: string, subjectId: string) {
  return uuid.safeParse(classId).success && uuid.safeParse(subjectId).success;
}

function rawArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function mapActivity(value: Record<string, unknown>): GradebookReadinessActivity {
  return {
    assignmentId: String(value.assignment_id ?? ""),
    title: String(value.title ?? "Aktivitas"),
    dueAt: typeof value.due_at === "string" ? value.due_at : null,
    submissionCount:
      typeof value.submission_count === "number" ? value.submission_count : undefined,
    studentCount: typeof value.student_count === "number" ? value.student_count : undefined,
    studentNames: Array.isArray(value.student_names)
      ? value.student_names.map((name) => String(name))
      : undefined,
  };
}

function mapReadiness(value: unknown): GradebookReadiness {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const objectives: GradebookReadinessObjective[] = rawArray(raw.unassessed_objectives).map(
    (objective) => ({
      objectiveId: String(objective.objective_id ?? ""),
      title: String(objective.title ?? "TP"),
    }),
  );
  return {
    canLock: raw.can_lock === true,
    alreadyLocked: raw.already_locked === true,
    studentCount: typeof raw.student_count === "number" ? raw.student_count : 0,
    assessmentCount: typeof raw.assessment_count === "number" ? raw.assessment_count : 0,
    openActivities: rawArray(raw.open_activities).map(mapActivity),
    ungradedActivities: rawArray(raw.ungraded_activities).map(mapActivity),
    missingActivities: rawArray(raw.missing_activities).map(mapActivity),
    unlinkedActivities: rawArray(raw.unlinked_activities).map(mapActivity),
    unassessedObjectives: objectives,
  };
}

function refreshGradePages() {
  revalidatePath("/gradebook");
  revalidatePath("/grades");
  revalidatePath("/assessments");
  revalidatePath("/subjects", "layout");
  revalidatePath("/dashboard");
}

export async function checkGradebookReadiness(
  classId: string,
  subjectId: string,
): Promise<ReadinessResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "teacher" || !validPair(classId, subjectId)) {
    return { ok: false, message: "Tidak diizinkan." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gradebook_readiness", {
    p_class_id: classId,
    p_subject_id: subjectId,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: mapReadiness(data) };
}

export async function lockAndCalculateGrades(
  classId: string,
  subjectId: string,
): Promise<GradebookActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "teacher" || !validPair(classId, subjectId)) {
    return { ok: false, message: "Tidak diizinkan." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("lock_gradebook", {
    p_class_id: classId,
    p_subject_id: subjectId,
  });
  if (error) return { ok: false, message: error.message };

  refreshGradePages();
  return { ok: true, message: "Nilai berhasil dihitung dan Buku Nilai sudah dikunci." };
}

export async function unlockGradebook(
  classId: string,
  subjectId: string,
): Promise<GradebookActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "teacher" || !validPair(classId, subjectId)) {
    return { ok: false, message: "Tidak diizinkan." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("unlock_gradebook", {
    p_class_id: classId,
    p_subject_id: subjectId,
  });
  if (error) return { ok: false, message: error.message };

  refreshGradePages();
  return {
    ok: true,
    message:
      "Kunci Buku Nilai berhasil dibuka. Nilai akhir dihapus, sedangkan nilai tugas dan kuis tetap tersimpan.",
  };
}

export async function fetchStudentHistory(
  studentId: string,
  classId: string,
  subjectId: string,
): Promise<StudentHistoryData> {
  const currentUser = await getCurrentUser();
  if (
    !currentUser ||
    currentUser.role !== "teacher" ||
    !uuid.safeParse(studentId).success ||
    !validPair(classId, subjectId)
  ) {
    throw new Error("Riwayat belajar tidak dapat diakses.");
  }

  const supabase = await createClient();
  const [teachingResult, studentResult] = await Promise.all([
    supabase
      .from("class_teacher_subjects")
      .select("id")
      .eq("teacher_id", currentUser.id)
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id")
      .eq("id", studentId)
      .eq("class_id", classId)
      .eq("role", "student")
      .maybeSingle(),
  ]);
  if (teachingResult.error || studentResult.error) {
    throw new Error("Otorisasi riwayat belajar belum dapat diperiksa. Coba lagi.");
  }
  if (!teachingResult.data || !studentResult.data) {
    throw new Error("Riwayat belajar tidak sesuai dengan penugasanmu.");
  }

  return getStudentHistory(studentId, classId, subjectId);
}
