import { createClient } from "@/lib/supabase/server";
import {
  getLearningObjectivesUsage,
  sumLearningObjectiveUsage,
  type LearningObjectiveUsage,
} from "./learning-objective-usage";

export type { TeacherClassSubject } from "@/lib/data/teaching";
export { getTeacherClassSubjects } from "@/lib/data/teaching";

export interface LearningObjectiveRow {
  id: string;
  title: string;
  sortOrder: number;
  usage: LearningObjectiveUsage;
}

export interface CurriculumPlanData {
  id: string | null;
  cpText: string;
  objectives: LearningObjectiveRow[];
  usage: LearningObjectiveUsage;
}

export async function getCurriculumPlan(
  classId: string,
  subjectId: string,
): Promise<CurriculumPlanData> {
  const supabase = await createClient();
  const { data: plan, error: planError } = await supabase
    .from("curriculum_plans")
    .select("id, cp_text")
    .eq("class_id", classId)
    .eq("subject_id", subjectId)
    .maybeSingle();

  if (planError) throw new Error("Gagal memuat CP.");
  if (!plan) return { id: null, cpText: "", objectives: [], usage: sumLearningObjectiveUsage([]) };

  const { data: objectives, error } = await supabase
    .from("learning_objectives")
    .select("id, title, sort_order")
    .eq("curriculum_plan_id", plan.id)
    .order("sort_order")
    .order("id");
  if (error) throw new Error("Gagal memuat TP.");
  const usage = await getLearningObjectivesUsage(
    (objectives ?? []).map((o) => o.id),
    supabase,
  );

  return {
    id: plan.id,
    cpText: plan.cp_text ?? "",
    objectives: (objectives ?? []).map((o) => ({
      id: o.id,
      title: o.title,
      sortOrder: o.sort_order,
      usage: usage[o.id],
    })),
    usage: sumLearningObjectiveUsage(Object.values(usage)),
  };
}
