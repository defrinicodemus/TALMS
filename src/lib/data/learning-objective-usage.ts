import { createClient } from "@/lib/supabase/server";

export interface LearningObjectiveUsage {
  materials: number;
  assignments: number;
  quizzes: number;
  meetings: number;
  total: number;
  isUsed: boolean;
}

type Client = Awaited<ReturnType<typeof createClient>>;

export function sumLearningObjectiveUsage(
  usages: LearningObjectiveUsage[],
): LearningObjectiveUsage {
  const counts = usages.reduce(
    (sum, usage) => ({
      materials: sum.materials + usage.materials,
      assignments: sum.assignments + usage.assignments,
      quizzes: sum.quizzes + usage.quizzes,
      meetings: sum.meetings + usage.meetings,
    }),
    { materials: 0, assignments: 0, quizzes: 0, meetings: 0 },
  );
  const total = counts.materials + counts.assignments + counts.quizzes + counts.meetings;
  return { ...counts, total, isUsed: total > 0 };
}

export async function getLearningObjectivesUsage(
  ids: string[],
  client?: Client,
): Promise<Record<string, LearningObjectiveUsage>> {
  if (ids.length === 0) return {};
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase.rpc("learning_objective_usage", { p_ids: ids });
  if (error) throw new Error("Gagal memeriksa penggunaan TP. Muat ulang dan coba lagi.");
  const result: Record<string, LearningObjectiveUsage> = {};
  for (const row of data ?? []) {
    const counts = {
      materials: Number(row.materials),
      assignments: Number(row.assignments),
      quizzes: Number(row.quizzes),
      meetings: Number(row.meetings),
    };
    const total = counts.materials + counts.assignments + counts.quizzes + counts.meetings;
    result[row.id] = { ...counts, total, isUsed: total > 0 };
  }
  // Missing rows are not evidence of zero usage (RLS or a concurrent deletion).
  if (ids.some((id) => !result[id]))
    throw new Error("TP tidak ditemukan atau tidak dapat diakses.");
  return result;
}

export async function getLearningObjectiveUsage(id: string, client?: Client) {
  return (await getLearningObjectivesUsage([id], client))[id];
}
