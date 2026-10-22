"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/data/profile";
import { getQuizAnswerReview, type QuizAnswerReviewItem } from "@/lib/data/review";
import { z } from "zod";
import { assignmentPhotoUrl } from "@/lib/assignmentFiles";

export async function fetchTaskSubmission(submissionId: string) {
  const user = await getCurrentUser();
  if (user?.role !== "teacher" || !z.string().uuid().safeParse(submissionId).success) return null;
  const client = await createClient();
  const { data: submission, error } = await client
    .from("submissions")
    .select(
      "content_url, submitted_at, updated_at, status, score, teacher_comment, assignments!inner(class_id, subject_id, kind)",
    )
    .eq("id", submissionId)
    .neq("assignments.kind", "quiz")
    .maybeSingle();
  if (error || !submission) return null;
  const task = submission.assignments as unknown as {
    class_id: string;
    subject_id: string;
    kind: string;
  };
  const { data: teaching, error: teachingError } = await client
    .from("class_teacher_subjects")
    .select("id")
    .eq("teacher_id", user.id)
    .eq("class_id", task.class_id)
    .eq("subject_id", task.subject_id)
    .maybeSingle();
  if (teachingError || !teaching) return null;
  return {
    contentUrl: submission.content_url as string | null,
    submittedAt: submission.submitted_at as string | null,
    updatedAt: submission.updated_at as string,
    status: submission.status as string,
    score: submission.score as number | null,
    teacherComment: submission.teacher_comment as string | null,
    photoUrl: await assignmentPhotoUrl(submission.content_url).catch(() => null),
  };
}

export async function fetchQuizAnswerReview(
  assignmentId: string,
  studentId: string,
): Promise<QuizAnswerReviewItem[]> {
  const currentUser = await getCurrentUser();
  if (
    !currentUser ||
    currentUser.role !== "teacher" ||
    !z.string().uuid().safeParse(assignmentId).success ||
    !z.string().uuid().safeParse(studentId).success
  ) {
    throw new Error("Hasil kuis tidak dapat diakses.");
  }

  const client = await createClient();
  const [quizResult, studentResult] = await Promise.all([
    client
      .from("assignments")
      .select("class_id, subject_id")
      .eq("id", assignmentId)
      .eq("kind", "quiz")
      .maybeSingle(),
    client
      .from("profiles")
      .select("class_id")
      .eq("id", studentId)
      .eq("role", "student")
      .maybeSingle(),
  ]);
  if (quizResult.error || studentResult.error) {
    throw new Error("Otorisasi hasil kuis belum dapat diperiksa. Coba lagi.");
  }
  if (
    !quizResult.data ||
    !studentResult.data ||
    studentResult.data.class_id !== quizResult.data.class_id
  ) {
    throw new Error("Hasil kuis tidak sesuai dengan kelas siswa.");
  }

  const { data: teaching, error: teachingError } = await client
    .from("class_teacher_subjects")
    .select("id")
    .eq("teacher_id", currentUser.id)
    .eq("class_id", quizResult.data.class_id)
    .eq("subject_id", quizResult.data.subject_id)
    .maybeSingle();
  if (teachingError) throw new Error("Penugasan Guru belum dapat diperiksa. Coba lagi.");
  if (!teaching) throw new Error("Hasil kuis tidak sesuai dengan penugasanmu.");

  return getQuizAnswerReview(assignmentId, studentId);
}

export async function gradeSubmission(
  formData: FormData,
): Promise<{ ok: boolean; message: string; conflict?: boolean }> {
  const submissionId = String(formData.get("submission_id") ?? "");
  const scoreRaw = String(formData.get("score") ?? "").trim();
  const comment = String(formData.get("teacher_comment") ?? "").trim();
  const expected = String(formData.get("expected_updated_at") ?? "");

  if (
    !z.string().uuid().safeParse(submissionId).success ||
    !z.string().datetime({ offset: true }).safeParse(expected).success
  )
    return { ok: false, message: "Pengumpulan tidak valid. Buka ulang jawaban siswa." };
  if (comment.length > 5000) return { ok: false, message: "Umpan balik maksimal 5.000 karakter." };

  const score = Number(scoreRaw);
  if (!scoreRaw || !Number.isFinite(score) || score < 0 || score > 100) {
    return { ok: false, message: "Nilai harus berupa angka 0-100." };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "teacher") {
    return { ok: false, message: "Tidak diizinkan." };
  }

  const supabase = await createClient();

  const { data: submission } = await supabase
    .from("submissions")
    .select("assignment_id, status, updated_at, assignments!inner(class_id, subject_id, kind)")
    .eq("id", submissionId)
    .neq("assignments.kind", "quiz")
    .single();
  if (!submission) return { ok: false, message: "Submisi tidak ditemukan." };
  if (submission.updated_at !== expected)
    return {
      ok: false,
      conflict: true,
      message:
        "Jawaban atau penilaian sudah berubah. Buka ulang untuk memeriksa versi terbaru sebelum menyimpan nilai.",
    };
  if (!["submitted", "graded"].includes(submission.status))
    return { ok: false, message: "Siswa belum mengumpulkan jawaban." };

  const assignment = submission.assignments as unknown as {
    class_id: string;
    subject_id: string;
  } | null;
  if (assignment) {
    const { data: teaching, error: teachingError } = await supabase
      .from("class_teacher_subjects")
      .select("id")
      .eq("teacher_id", currentUser.id)
      .eq("class_id", assignment.class_id)
      .eq("subject_id", assignment.subject_id)
      .maybeSingle();
    if (teachingError || !teaching)
      return { ok: false, message: "Pengumpulan tidak sesuai penugasanmu." };
    const { data: lock, error: lockError } = await supabase
      .from("gradebook_locks")
      .select("id")
      .eq("class_id", assignment.class_id)
      .eq("subject_id", assignment.subject_id)
      .maybeSingle();
    if (lockError)
      return { ok: false, message: "Status buku nilai belum dapat diperiksa. Coba lagi." };
    if (lock) {
      return {
        ok: false,
        message: "Buku nilai untuk kelas & mapel ini sudah dikunci, nilai tidak bisa diubah.",
      };
    }
  }

  const { data: saved, error } = await supabase
    .from("submissions")
    .update({
      score,
      teacher_comment: comment || null,
      status: "graded",
      graded_at: new Date().toISOString(),
      graded_by: currentUser.id,
    })
    .eq("id", submissionId)
    .eq("updated_at", expected)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!saved)
    return {
      ok: false,
      conflict: true,
      message: "Jawaban atau penilaian berubah saat disimpan. Buka ulang jawaban terbaru.",
    };

  revalidatePath("/assessments");
  revalidatePath("/gradebook");
  revalidatePath("/grades");
  revalidatePath("/subjects", "layout");
  revalidatePath("/dashboard");
  return { ok: true, message: "Nilai berhasil disimpan." };
}
