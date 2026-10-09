"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/data/profile";
import {
  getLearningObjectiveUsage,
  getLearningObjectivesUsage,
  sumLearningObjectiveUsage,
  type LearningObjectiveUsage,
} from "@/lib/data/learning-objective-usage";

type Client = Awaited<ReturnType<typeof createClient>>;
type Result = { ok: boolean; message: string };
const TP_IN_USE =
  "Tujuan Pembelajaran tidak dapat dihapus karena sudah digunakan dalam aktivitas pembelajaran.";
const CP_IN_USE =
  "CP tidak dapat dihapus karena masih memiliki Tujuan Pembelajaran yang digunakan dalam aktivitas pembelajaran.";

async function teacherContext() {
  const user = await getCurrentUser();
  if (!user || user.role !== "teacher") throw new Error("Tidak diizinkan.");
  return { user, client: await createClient() };
}

async function requireTeaching(
  client: Client,
  teacherId: string,
  classId: string,
  subjectId: string,
) {
  const { data, error } = await client
    .from("class_teacher_subjects")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("class_id", classId)
    .eq("subject_id", subjectId)
    .maybeSingle();
  if (error || !data)
    throw new Error("Tidak diizinkan mengelola kurikulum kelas dan mata pelajaran ini.");
}

async function requirePlan(client: Client, teacherId: string, id: string) {
  const { data, error } = await client
    .from("curriculum_plans")
    .select("id, class_id, subject_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error("CP tidak ditemukan.");
  await requireTeaching(client, teacherId, data.class_id, data.subject_id);
  return data;
}

async function requireObjective(client: Client, teacherId: string, id: string) {
  const { data, error } = await client
    .from("learning_objectives")
    .select("id, curriculum_plan_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error("TP tidak ditemukan.");
  await requirePlan(client, teacherId, data.curriculum_plan_id);
  return data;
}

async function planUsage(client: Client, planId: string) {
  const { data, error } = await client
    .from("learning_objectives")
    .select("id")
    .eq("curriculum_plan_id", planId);
  if (error) throw new Error("Gagal memeriksa penggunaan TP pada CP ini.");
  return sumLearningObjectiveUsage(
    Object.values(
      await getLearningObjectivesUsage(
        (data ?? []).map((o) => o.id),
        client,
      ),
    ),
  );
}

function refreshCurriculum() {
  for (const path of [
    "/curriculum",
    "/classroom",
    "/subjects",
    "/grades",
    "/gradebook",
    "/attendance",
    "/students",
  ]) {
    revalidatePath(path, "layout");
  }
}

async function change(work: () => Promise<string>): Promise<Result> {
  try {
    const message = await work();
    refreshCurriculum();
    return { ok: true, message };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Perubahan gagal disimpan. Coba lagi.",
    };
  }
}

// Refresh usage before opening an edit form; stale page data must not skip a warning.
export async function inspectCurriculumUsage(
  planId: string,
  objectiveId?: string,
): Promise<{ ok: true; usage: LearningObjectiveUsage } | { ok: false; message: string }> {
  try {
    const { client, user } = await teacherContext();
    await requirePlan(client, user.id, planId);
    if (objectiveId) {
      const objective = await requireObjective(client, user.id, objectiveId);
      if (objective.curriculum_plan_id !== planId) throw new Error("TP tidak sesuai dengan CP.");
    }
    return {
      ok: true,
      usage: objectiveId
        ? await getLearningObjectiveUsage(objectiveId, client)
        : await planUsage(client, planId),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Gagal memeriksa penggunaan TP.",
    };
  }
}

export async function saveCurriculumPlan(formData: FormData): Promise<Result> {
  return change(async () => {
    const { client, user } = await teacherContext();
    const classId = String(formData.get("class_id") ?? "");
    const subjectId = String(formData.get("subject_id") ?? "");
    const cpText = String(formData.get("cp_text") ?? "").trim();
    if (!cpText) throw new Error("Capaian Pembelajaran wajib diisi.");
    await requireTeaching(client, user.id, classId, subjectId);
    const { error } = await client.from("curriculum_plans").upsert(
      {
        class_id: classId,
        subject_id: subjectId,
        teacher_id: user.id,
        cp_text: cpText,
      },
      { onConflict: "class_id,subject_id" },
    );
    if (error) throw new Error(error.message);
    return "Capaian Pembelajaran berhasil disimpan.";
  });
}

export async function deleteCurriculumPlan(id: string): Promise<Result> {
  return change(async () => {
    const { client, user } = await teacherContext();
    await requirePlan(client, user.id, id);
    if ((await planUsage(client, id)).isUsed) throw new Error(CP_IN_USE);
    const { data, error } = await client
      .from("curriculum_plans")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(["23503", "23001"].includes(error.code) ? CP_IN_USE : error.message);
    if (!data) throw new Error("CP tidak ditemukan atau tidak dapat dihapus.");
    return "CP dan TP yang belum digunakan berhasil dihapus.";
  });
}

export async function addLearningObjective(formData: FormData): Promise<Result> {
  return change(async () => {
    const { client, user } = await teacherContext();
    const classId = String(formData.get("class_id") ?? "");
    const subjectId = String(formData.get("subject_id") ?? "");
    const title = String(formData.get("title") ?? "").trim();
    if (!title) throw new Error("Judul TP wajib diisi.");
    await requireTeaching(client, user.id, classId, subjectId);
    // Preserve an existing CP's text when initializing an empty plan for its first TP.
    const { error: planError } = await client.from("curriculum_plans").upsert(
      {
        class_id: classId,
        subject_id: subjectId,
        teacher_id: user.id,
      },
      { onConflict: "class_id,subject_id", ignoreDuplicates: true },
    );
    if (planError) throw new Error(planError.message);
    const { data: plan, error } = await client
      .from("curriculum_plans")
      .select("id")
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .single();
    if (error || !plan) throw new Error("Gagal menyiapkan CP untuk TP ini.");
    // The database appends atomically using max(sort_order) + 1, not row count.
    const { error: insertError } = await client.from("learning_objectives").insert({
      curriculum_plan_id: plan.id,
      title,
    });
    if (insertError) throw new Error(insertError.message);
    return "Tujuan Pembelajaran berhasil ditambahkan.";
  });
}

export async function updateLearningObjective(formData: FormData): Promise<Result> {
  return change(async () => {
    const { client, user } = await teacherContext();
    const id = String(formData.get("id") ?? "");
    const title = String(formData.get("title") ?? "").trim();
    if (!title) throw new Error("Judul TP wajib diisi.");
    await requireObjective(client, user.id, id);
    const { data, error } = await client
      .from("learning_objectives")
      .update({ title })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("TP tidak ditemukan atau tidak dapat diperbarui.");
    return "Tujuan Pembelajaran berhasil diperbarui.";
  });
}

export async function deleteLearningObjective(id: string): Promise<Result> {
  return change(async () => {
    const { client, user } = await teacherContext();
    await requireObjective(client, user.id, id);
    if ((await getLearningObjectiveUsage(id, client)).isUsed) throw new Error(TP_IN_USE);
    const { data, error } = await client
      .from("learning_objectives")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(["23503", "23001"].includes(error.code) ? TP_IN_USE : error.message);
    if (!data) throw new Error("TP tidak ditemukan atau tidak dapat dihapus.");
    return "Tujuan Pembelajaran berhasil dihapus.";
  });
}

export async function moveLearningObjective(id: string, direction: "up" | "down"): Promise<Result> {
  return change(async () => {
    const { client, user } = await teacherContext();
    if (direction !== "up" && direction !== "down")
      throw new Error("Arah perpindahan TP tidak valid.");
    await requireObjective(client, user.id, id);
    if ((await getLearningObjectiveUsage(id, client)).isUsed) {
      throw new Error("Urutan TP dikunci karena sudah digunakan dalam aktivitas pembelajaran.");
    }
    const { error } = await client.rpc("move_learning_objective", {
      p_id: id,
      p_direction: direction,
    });
    if (error) throw new Error(error.message);
    return "Urutan TP diperbarui.";
  });
}
