import { createClient } from "@/lib/supabase/server";
import { appliesToGrade } from "@/lib/data/subjects";
import { averageOfTpAverages, round2 } from "@/lib/data/learningMetrics";

export { averageOfTpAverages, round2 } from "@/lib/data/learningMetrics";

// Grade averages are rounded to 2 decimal places (not whole numbers) so that
// multi-step averaging (per-TP, then average-of-TP-averages, etc.) doesn't
// compound rounding error — rounding to a whole number at each step can drift
// the final grade by a couple of points versus the true average.
export interface GradebookTpColumn {
  id: string;
  title: string;
  sortOrder: number;
}

export interface GradebookStudentRow {
  studentId: string;
  fullName: string;
  nisn: string | null;
  avatar: string | null;
  tpAverages: Record<string, number | null>;
  finalGrade: number | null;
}

export interface GradebookData {
  tpColumns: GradebookTpColumn[];
  students: GradebookStudentRow[];
  isLocked: boolean;
  lockedAt: string | null;
}

export interface GradebookReadinessActivity {
  assignmentId: string;
  title: string;
  dueAt?: string | null;
  submissionCount?: number;
  studentCount?: number;
  studentNames?: string[];
}

export interface GradebookReadinessObjective {
  objectiveId: string;
  title: string;
}

export interface GradebookReadiness {
  canLock: boolean;
  alreadyLocked: boolean;
  studentCount: number;
  assessmentCount: number;
  openActivities: GradebookReadinessActivity[];
  ungradedActivities: GradebookReadinessActivity[];
  missingActivities: GradebookReadinessActivity[];
  unlinkedActivities: GradebookReadinessActivity[];
  unassessedObjectives: GradebookReadinessObjective[];
}

export async function getGradebookData(classId: string, subjectId: string): Promise<GradebookData> {
  const supabase = await createClient();

  const [planResult, studentsResult, lockResult] = await Promise.all([
    supabase
      .from("curriculum_plans")
      .select("id")
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name, nisn, avatar_emoji")
      .eq("class_id", classId)
      .eq("role", "student")
      .order("full_name"),
    supabase
      .from("gradebook_locks")
      .select("locked_at")
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .maybeSingle(),
  ]);
  if (planResult.error || studentsResult.error || lockResult.error) {
    throw new Error("Buku nilai belum dapat dimuat. Coba lagi.");
  }
  const plan = planResult.data;
  const students = studentsResult.data;
  const lock = lockResult.data;

  let tpColumns: GradebookTpColumn[] = [];
  if (plan) {
    const { data: objectives, error: objectivesError } = await supabase
      .from("learning_objectives")
      .select("id, title, sort_order")
      .eq("curriculum_plan_id", plan.id)
      .order("sort_order");
    if (objectivesError) throw new Error("Tujuan Pembelajaran belum dapat dimuat. Coba lagi.");
    tpColumns = (objectives ?? []).map((o) => ({
      id: o.id,
      title: o.title,
      sortOrder: o.sort_order,
    }));
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from("assignments")
    .select("id, learning_objective_id, due_at, is_active, is_published")
    .eq("class_id", classId)
    .eq("subject_id", subjectId)
    .not("learning_objective_id", "is", null);
  if (assignmentsError) throw new Error("Aktivitas penilaian belum dapat dimuat. Coba lagi.");

  const assignmentIds = (assignments ?? []).map((a) => a.id);

  const submissionsResult =
    assignmentIds.length > 0
      ? await supabase
          .from("submissions")
          .select("student_id, assignment_id, score, status")
          .in("assignment_id", assignmentIds)
      : {
          data: [] as {
            student_id: string;
            assignment_id: string;
            score: number | null;
            status: string;
          }[],
          error: null,
        };
  if (submissionsResult.error) throw new Error("Nilai siswa belum dapat dimuat. Coba lagi.");
  const submissions = submissionsResult.data;

  const assignmentIdsWithSubmissions = new Set(
    (submissions ?? []).map((submission) => submission.assignment_id),
  );
  const gradebookAssignments = (assignments ?? []).filter(
    (assignment) =>
      (assignment.is_active && assignment.is_published) ||
      assignmentIdsWithSubmissions.has(assignment.id),
  );
  const tpByAssignment = new Map(
    gradebookAssignments.map((assignment) => [assignment.id, assignment.learning_objective_id]),
  );

  const submissionByStudentAssignment = new Map(
    (submissions ?? []).map((submission) => [
      `${submission.student_id}:${submission.assignment_id}`,
      submission,
    ]),
  );
  const assignmentById = new Map(
    gradebookAssignments.map((assignment) => [assignment.id, assignment]),
  );

  const finalGradesByStudent = new Map<string, number>();
  if (lock) {
    const { data: gradeRows, error: gradesError } = await supabase
      .from("grades")
      .select("student_id, score, created_at")
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .order("created_at", { ascending: false });
    if (gradesError) throw new Error("Nilai akhir belum dapat dimuat. Coba lagi.");
    for (const g of gradeRows ?? []) {
      if (!finalGradesByStudent.has(g.student_id)) finalGradesByStudent.set(g.student_id, g.score);
    }
  }

  const studentRows: GradebookStudentRow[] = (students ?? []).map((st) => {
    const scoresByTp = new Map<string, number[]>();
    for (const assignment of assignmentById.values()) {
      const tpId = tpByAssignment.get(assignment.id);
      if (!tpId) continue;
      const submission = submissionByStudentAssignment.get(`${st.id}:${assignment.id}`);
      let score: number | null = null;
      if (submission?.status === "graded" && submission.score != null) {
        score = submission.score;
      } else if (
        assignment.due_at &&
        new Date(assignment.due_at).getTime() <= Date.now() &&
        submission?.status !== "submitted"
      ) {
        score = 0;
      }
      if (score != null) {
        const values = scoresByTp.get(tpId) ?? [];
        values.push(score);
        scoresByTp.set(tpId, values);
      }
    }
    const tpAverages: Record<string, number | null> = {};
    for (const tp of tpColumns) {
      const scores = scoresByTp.get(tp.id);
      tpAverages[tp.id] =
        scores && scores.length > 0
          ? round2(scores.reduce((a, b) => a + b, 0) / scores.length)
          : null;
    }
    return {
      studentId: st.id,
      fullName: st.full_name,
      nisn: st.nisn,
      avatar: st.avatar_emoji,
      tpAverages,
      finalGrade: finalGradesByStudent.get(st.id) ?? null,
    };
  });

  return {
    tpColumns,
    students: studentRows,
    isLocked: !!lock,
    lockedAt: lock?.locked_at ?? null,
  };
}

export interface HistoryMaterialRow {
  id: string;
  title: string;
  kind: string;
  viewed: boolean;
  viewedAt: string | null;
}

export interface HistoryAssignmentRow {
  id: string;
  title: string;
  submittedAt: string | null;
  score: number | null;
}

export interface HistoryTpGroup<T> {
  tpId: string;
  tpTitle: string;
  items: T[];
}

export interface StudentHistoryData {
  materialsByTp: HistoryTpGroup<HistoryMaterialRow>[];
  tugasByTp: HistoryTpGroup<HistoryAssignmentRow>[];
  kuisByTp: HistoryTpGroup<HistoryAssignmentRow>[];
  materialsViewedPercent: number;
  averageTugas: number | null;
  averageKuis: number | null;
}

const NO_TP_GROUP_ID = "tanpa-tp";

function groupByTp<T>(
  entries: {
    learningObjectiveId: string | null;
    tpTitle: string | null;
    tpSortOrder: number | null;
    item: T;
  }[],
): HistoryTpGroup<T>[] {
  const groups = new Map<string, { title: string; sortOrder: number; items: T[] }>();
  for (const e of entries) {
    const key = e.learningObjectiveId ?? NO_TP_GROUP_ID;
    const entry = groups.get(key) ?? {
      title: e.learningObjectiveId ? (e.tpTitle ?? "TP") : "Tanpa TP",
      sortOrder: e.learningObjectiveId ? (e.tpSortOrder ?? 0) : Number.MAX_SAFE_INTEGER,
      items: [] as T[],
    };
    entry.items.push(e.item);
    groups.set(key, entry);
  }
  return [...groups.entries()]
    .map(([tpId, { title, sortOrder, items }]) => ({ tpId, tpTitle: title, sortOrder, items }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ tpId, tpTitle, items }) => ({ tpId, tpTitle, items }));
}

export async function getStudentHistory(
  studentId: string,
  classId: string,
  subjectId: string,
): Promise<StudentHistoryData> {
  const supabase = await createClient();

  const [materialsResult, viewsResult, assignmentsResult] = await Promise.all([
    supabase
      .from("materials")
      .select("id, title, kind, learning_objective_id, learning_objectives(title, sort_order)")
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .eq("is_active", true),
    supabase.from("material_views").select("material_id, viewed_at").eq("student_id", studentId),
    supabase
      .from("assignments")
      .select(
        "id, title, kind, due_at, is_active, is_published, learning_objective_id, learning_objectives(title, sort_order)",
      )
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .eq("is_published", true),
  ]);
  if (materialsResult.error || viewsResult.error || assignmentsResult.error) {
    throw new Error("Riwayat belajar belum dapat dimuat. Coba lagi.");
  }
  const materials = materialsResult.data;
  const views = viewsResult.data;
  const assignments = assignmentsResult.data;

  const viewedByMaterial = new Map((views ?? []).map((v) => [v.material_id, v.viewed_at]));
  const materialRows = (materials ?? []).map((m) => {
    const lo = m.learning_objectives as unknown as { title: string; sort_order: number } | null;
    const row: HistoryMaterialRow = {
      id: m.id,
      title: m.title,
      kind: m.kind,
      viewed: viewedByMaterial.has(m.id),
      viewedAt: viewedByMaterial.get(m.id) ?? null,
    };
    return {
      learningObjectiveId: m.learning_objective_id,
      tpTitle: lo?.title ?? null,
      tpSortOrder: lo?.sort_order ?? null,
      item: row,
    };
  });
  const materialsViewedPercent =
    materialRows.length > 0
      ? Math.round((materialRows.filter((m) => m.item.viewed).length / materialRows.length) * 100)
      : 0;

  const assignmentIds = (assignments ?? []).map((a) => a.id);
  const submissionsResult =
    assignmentIds.length > 0
      ? await supabase
          .from("submissions")
          .select("assignment_id, submitted_at, score, status")
          .eq("student_id", studentId)
          .in("assignment_id", assignmentIds)
      : {
          data: [] as {
            assignment_id: string;
            submitted_at: string | null;
            score: number | null;
            status: string;
          }[],
          error: null,
        };
  if (submissionsResult.error) throw new Error("Riwayat nilai belum dapat dimuat. Coba lagi.");
  const submissions = submissionsResult.data;

  const submissionByAssignment = new Map((submissions ?? []).map((s) => [s.assignment_id, s]));
  const historyAssignments = (assignments ?? []).filter(
    (assignment) => assignment.is_active || submissionByAssignment.has(assignment.id),
  );

  const tugasEntries: Parameters<typeof groupByTp<HistoryAssignmentRow>>[0] = [];
  const kuisEntries: Parameters<typeof groupByTp<HistoryAssignmentRow>>[0] = [];
  const tugasScores: number[] = [];
  const kuisScores: number[] = [];

  for (const a of historyAssignments) {
    const sub = submissionByAssignment.get(a.id);
    const missedAfterDeadline =
      !!a.due_at &&
      new Date(a.due_at).getTime() <= Date.now() &&
      sub?.status !== "submitted" &&
      sub?.status !== "graded";
    const row: HistoryAssignmentRow = {
      id: a.id,
      title: a.title,
      submittedAt: sub?.submitted_at ?? null,
      score: sub?.score ?? (missedAfterDeadline ? 0 : null),
    };
    const lo = a.learning_objectives as unknown as { title: string; sort_order: number } | null;
    const entry = {
      learningObjectiveId: a.learning_objective_id,
      tpTitle: lo?.title ?? null,
      tpSortOrder: lo?.sort_order ?? null,
      item: row,
    };
    if (a.kind === "quiz") {
      kuisEntries.push(entry);
      if (row.score != null) kuisScores.push(row.score);
    } else {
      tugasEntries.push(entry);
      if (row.score != null) tugasScores.push(row.score);
    }
  }

  return {
    materialsByTp: groupByTp(materialRows),
    tugasByTp: groupByTp(tugasEntries),
    kuisByTp: groupByTp(kuisEntries),
    materialsViewedPercent,
    averageTugas:
      tugasScores.length > 0
        ? round2(tugasScores.reduce((a, b) => a + b, 0) / tugasScores.length)
        : null,
    averageKuis:
      kuisScores.length > 0
        ? round2(kuisScores.reduce((a, b) => a + b, 0) / kuisScores.length)
        : null,
  };
}

export interface StudentTpGrade {
  tpId: string;
  tpTitle: string;
  average: number | null;
}

export interface StudentSubjectGrade {
  subjectId: string;
  subjectName: string;
  subjectEmoji: string | null;
  subjectColor: string | null;
  overallAverage: number | null;
  isLocked: boolean;
  tpGrades: StudentTpGrade[];
}

export interface StudentGradeContext {
  className: string;
  periodLabel: string;
}

export async function getStudentGradeContext(
  classId: string | null,
): Promise<StudentGradeContext | null> {
  if (!classId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classes")
    .select("name, academic_years(year_label, semester)")
    .eq("id", classId)
    .maybeSingle();
  if (error) throw new Error("Konteks kelas dan semester belum dapat dimuat. Coba lagi.");
  if (!data) return null;
  const period = data.academic_years as unknown as {
    year_label: string;
    semester: string;
  } | null;
  return {
    className: data.name,
    periodLabel: period
      ? `${period.year_label} · ${period.semester === "ganjil" ? "Ganjil" : "Genap"}`
      : "Periode belum tersedia",
  };
}

export async function getStudentGrades(
  studentId: string,
  classId: string | null,
): Promise<StudentSubjectGrade[]> {
  if (!classId) return [];
  const supabase = await createClient();

  const [subjectsResult, classResult] = await Promise.all([
    supabase.from("subjects").select("id, name, emoji, color, min_grade, max_grade").order("name"),
    supabase.from("classes").select("grade_level").eq("id", classId).single(),
  ]);
  if (subjectsResult.error || classResult.error) {
    throw new Error("Daftar nilai belum dapat dimuat. Coba lagi.");
  }
  const subjects = subjectsResult.data;
  const klass = classResult.data;
  const gradeLevel = klass?.grade_level ?? null;
  const visibleSubjects = (subjects ?? []).filter((s) =>
    appliesToGrade(gradeLevel, s.min_grade, s.max_grade),
  );
  const visibleSubjectIds = visibleSubjects.map((s) => s.id);

  const [plansResult, assignmentsResult, locksResult] = await Promise.all([
    visibleSubjectIds.length > 0
      ? supabase
          .from("curriculum_plans")
          .select("subject_id, learning_objectives(id, title, sort_order)")
          .eq("class_id", classId)
          .in("subject_id", visibleSubjectIds)
      : Promise.resolve({ data: [] as never[], error: null }),
    supabase
      .from("assignments")
      .select(
        "id, subject_id, due_at, is_active, learning_objective_id, learning_objectives(title, sort_order)",
      )
      .eq("class_id", classId)
      .eq("is_published", true),
    visibleSubjectIds.length > 0
      ? supabase
          .from("gradebook_locks")
          .select("subject_id")
          .eq("class_id", classId)
          .in("subject_id", visibleSubjectIds)
      : Promise.resolve({ data: [] as { subject_id: string }[], error: null }),
  ]);
  if (plansResult.error || assignmentsResult.error || locksResult.error) {
    throw new Error("Nilai per mata pelajaran belum dapat dimuat. Coba lagi.");
  }
  const plans = plansResult.data;
  const assignments = assignmentsResult.data;
  const locks = locksResult.data;

  const lockedSubjectIds = new Set((locks ?? []).map((l) => l.subject_id));

  const finalGradeBySubject = new Map<string, number>();
  if (lockedSubjectIds.size > 0) {
    const { data: gradeRows, error: gradeError } = await supabase
      .from("grades")
      .select("subject_id, score, created_at")
      .eq("student_id", studentId)
      .eq("class_id", classId)
      .in("subject_id", [...lockedSubjectIds])
      .order("created_at", { ascending: false });
    if (gradeError) throw new Error("Nilai final belum dapat dimuat. Coba lagi.");
    for (const g of gradeRows ?? []) {
      if (!finalGradeBySubject.has(g.subject_id)) finalGradeBySubject.set(g.subject_id, g.score);
    }
  }

  const assignmentIds = (assignments ?? []).map((a) => a.id);
  const submissionsResult =
    assignmentIds.length > 0
      ? await supabase
          .from("submissions")
          .select("assignment_id, score, status")
          .eq("student_id", studentId)
          .in("assignment_id", assignmentIds)
      : {
          data: [] as { assignment_id: string; score: number | null; status: string }[],
          error: null,
        };
  if (submissionsResult.error) throw new Error("Nilai aktivitas belum dapat dimuat. Coba lagi.");
  const submissions = submissionsResult.data;

  const submissionByAssignment = new Map((submissions ?? []).map((s) => [s.assignment_id, s]));
  const studentAssignments = (assignments ?? []).filter(
    (assignment) => assignment.is_active || submissionByAssignment.has(assignment.id),
  );
  const assignmentById = new Map(
    studentAssignments.map((assignment) => [assignment.id, assignment]),
  );

  const tpScoresBySubject = new Map<
    string,
    Map<string, { title: string; sortOrder: number; scores: number[] }>
  >();

  for (const plan of plans ?? []) {
    const objectives =
      (plan.learning_objectives as unknown as
        { id: string; title: string; sort_order: number }[] | null) ?? [];
    const tpMap = tpScoresBySubject.get(plan.subject_id) ?? new Map();
    for (const objective of objectives) {
      if (!tpMap.has(objective.id)) {
        tpMap.set(objective.id, {
          title: objective.title,
          sortOrder: objective.sort_order,
          scores: [],
        });
      }
    }
    tpScoresBySubject.set(plan.subject_id, tpMap);
  }

  for (const a of assignmentById.values()) {
    if (a.learning_objective_id) {
      const sub = submissionByAssignment.get(a.id);
      const missedAfterDeadline =
        !!a.due_at &&
        new Date(a.due_at).getTime() <= Date.now() &&
        sub?.status !== "submitted" &&
        sub?.status !== "graded";
      const score =
        sub?.status === "graded" && sub.score != null ? sub.score : missedAfterDeadline ? 0 : null;
      if (score == null) continue;
      const lo = a.learning_objectives as unknown as { title: string; sort_order: number } | null;
      const tpMap = tpScoresBySubject.get(a.subject_id) ?? new Map();
      const entry = tpMap.get(a.learning_objective_id) ?? {
        title: lo?.title ?? "TP",
        sortOrder: lo?.sort_order ?? 0,
        scores: [] as number[],
      };
      entry.scores.push(score);
      tpMap.set(a.learning_objective_id, entry);
      tpScoresBySubject.set(a.subject_id, tpMap);
    }
  }

  return visibleSubjects.map((s) => {
    const isLocked = lockedSubjectIds.has(s.id);
    const tpMap = tpScoresBySubject.get(s.id);
    const tpGrades: StudentTpGrade[] = tpMap
      ? [...tpMap.entries()]
          .map(([tpId, { title, sortOrder, scores: tpScores }]) => ({
            tpId,
            tpTitle: title,
            sortOrder,
            average:
              tpScores.length > 0
                ? round2(tpScores.reduce((a, b) => a + b, 0) / tpScores.length)
                : null,
          }))
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(({ tpId, tpTitle, average }) => ({ tpId, tpTitle, average }))
      : [];

    return {
      subjectId: s.id,
      subjectName: s.name,
      subjectEmoji: s.emoji,
      subjectColor: s.color,
      overallAverage: isLocked
        ? (finalGradeBySubject.get(s.id) ?? null)
        : averageOfTpAverages(tpGrades.map((tp) => tp.average)),
      isLocked,
      tpGrades,
    };
  });
}

export type StudentGradeActivityStatus = "graded" | "missed" | "waiting" | "open";

export interface StudentGradeActivityRow {
  id: string;
  title: string;
  kind: "tugas" | "kuis";
  dueAt: string | null;
  gradedAt: string | null;
  score: number | null;
  status: StudentGradeActivityStatus;
}

export interface TpGradeDetail {
  tpId: string;
  tpTitle: string;
  average: number | null;
  activities: StudentGradeActivityRow[];
}

export interface StudentSubjectGradeDetail {
  subjectId: string;
  subjectName: string;
  subjectEmoji: string | null;
  subjectColor: string | null;
  overallAverage: number | null;
  isLocked: boolean;
  includedActivityCount: number;
  gradedActivityCount: number;
  missedActivityCount: number;
  waitingActivityCount: number;
  openActivityCount: number;
  totalActivityCount: number;
  assessedTpCount: number;
  totalTpCount: number;
  highestScore: number | null;
  highestScoreCount: number;
  tpDetails: TpGradeDetail[];
}

export async function getStudentSubjectGradeDetail(
  studentId: string,
  classId: string,
  subjectId: string,
): Promise<StudentSubjectGradeDetail | null> {
  const supabase = await createClient();

  const [subjectResult, classResult, planResult, assignmentsResult, lockResult] = await Promise.all(
    [
      supabase
        .from("subjects")
        .select("id, name, emoji, color, min_grade, max_grade")
        .eq("id", subjectId)
        .maybeSingle(),
      supabase.from("classes").select("grade_level").eq("id", classId).maybeSingle(),
      supabase
        .from("curriculum_plans")
        .select("id, learning_objectives(id, title, sort_order)")
        .eq("class_id", classId)
        .eq("subject_id", subjectId)
        .maybeSingle(),
      supabase
        .from("assignments")
        .select(
          "id, title, kind, due_at, is_active, learning_objective_id, learning_objectives(title, sort_order)",
        )
        .eq("class_id", classId)
        .eq("subject_id", subjectId)
        .eq("is_published", true),
      supabase
        .from("gradebook_locks")
        .select("locked_at")
        .eq("class_id", classId)
        .eq("subject_id", subjectId)
        .maybeSingle(),
    ],
  );

  if (
    subjectResult.error ||
    classResult.error ||
    planResult.error ||
    assignmentsResult.error ||
    lockResult.error
  ) {
    throw new Error("Rincian nilai belum dapat dimuat. Coba lagi.");
  }
  const subject = subjectResult.data;
  const klass = classResult.data;
  const plan = planResult.data;
  const assignments = assignmentsResult.data;
  const lock = lockResult.data;

  if (
    !subject ||
    !klass ||
    !appliesToGrade(klass.grade_level, subject.min_grade, subject.max_grade)
  )
    return null;

  const isLocked = !!lock;
  let finalGrade: number | null = null;
  if (isLocked) {
    const { data: gradeRows, error: gradeError } = await supabase
      .from("grades")
      .select("score, created_at")
      .eq("student_id", studentId)
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (gradeError) throw new Error("Nilai final belum dapat dimuat. Coba lagi.");
    finalGrade = gradeRows?.[0]?.score ?? null;
  }

  const assignmentIds = (assignments ?? []).map((a) => a.id);
  const submissionsResult =
    assignmentIds.length > 0
      ? await supabase
          .from("submissions")
          .select("assignment_id, score, status, graded_at")
          .eq("student_id", studentId)
          .in("assignment_id", assignmentIds)
      : {
          data: [] as {
            assignment_id: string;
            score: number | null;
            status: string;
            graded_at: string | null;
          }[],
          error: null,
        };
  if (submissionsResult.error) throw new Error("Rincian aktivitas belum dapat dimuat. Coba lagi.");
  const submissions = submissionsResult.data;

  const submissionByAssignment = new Map((submissions ?? []).map((s) => [s.assignment_id, s]));
  const studentAssignments = (assignments ?? []).filter(
    (assignment) => assignment.is_active || submissionByAssignment.has(assignment.id),
  );
  const assignmentById = new Map(
    studentAssignments.map((assignment) => [assignment.id, assignment]),
  );

  const tpMap = new Map<
    string,
    { title: string; sortOrder: number; activities: StudentGradeActivityRow[] }
  >();
  const objectives =
    (plan?.learning_objectives as unknown as
      { id: string; title: string; sort_order: number }[] | null) ?? [];
  for (const o of objectives) {
    tpMap.set(o.id, { title: o.title, sortOrder: o.sort_order, activities: [] });
  }

  let includedActivityCount = 0;
  let gradedActivityCount = 0;
  let missedActivityCount = 0;
  let waitingActivityCount = 0;
  let openActivityCount = 0;
  const allGradedScores: number[] = [];

  for (const a of assignmentById.values()) {
    const sub = submissionByAssignment.get(a.id);
    const missedAfterDeadline =
      !!a.due_at &&
      new Date(a.due_at).getTime() <= Date.now() &&
      sub?.status !== "submitted" &&
      sub?.status !== "graded";
    let status: StudentGradeActivityStatus;
    let score: number | null = null;
    if (sub?.status === "graded" && sub.score != null) {
      status = "graded";
      score = sub.score;
      gradedActivityCount++;
      includedActivityCount++;
      allGradedScores.push(sub.score);
    } else if (sub?.status === "submitted") {
      status = "waiting";
      waitingActivityCount++;
    } else if (missedAfterDeadline) {
      status = "missed";
      score = 0;
      missedActivityCount++;
      includedActivityCount++;
    } else {
      status = "open";
      openActivityCount++;
    }

    const kind: "tugas" | "kuis" = a.kind === "quiz" ? "kuis" : "tugas";

    if (a.learning_objective_id) {
      const lo = a.learning_objectives as unknown as { title: string; sort_order: number } | null;
      const entry = tpMap.get(a.learning_objective_id) ?? {
        title: lo?.title ?? "TP",
        sortOrder: lo?.sort_order ?? 0,
        activities: [] as StudentGradeActivityRow[],
      };
      entry.activities.push({
        id: a.id,
        title: a.title,
        kind,
        dueAt: a.due_at,
        gradedAt: sub?.graded_at ?? null,
        score,
        status,
      });
      tpMap.set(a.learning_objective_id, entry);
    }
  }

  const tpDetails: TpGradeDetail[] = [...tpMap.entries()]
    .map(([tpId, { title, sortOrder, activities }]) => {
      const scores = activities
        .map((activity) => activity.score)
        .filter((score): score is number => score != null);
      return {
        tpId,
        tpTitle: title,
        sortOrder,
        average:
          scores.length > 0 ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        activities: [...activities].sort((a, b) =>
          (b.gradedAt ?? b.dueAt ?? "").localeCompare(a.gradedAt ?? a.dueAt ?? ""),
        ),
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ tpId, tpTitle, average, activities }) => ({ tpId, tpTitle, average, activities }));

  const highestScore = allGradedScores.length > 0 ? Math.max(...allGradedScores) : null;
  const highestScoreCount =
    highestScore != null ? allGradedScores.filter((s) => s === highestScore).length : 0;

  return {
    subjectId: subject.id,
    subjectName: subject.name,
    subjectEmoji: subject.emoji,
    subjectColor: subject.color,
    overallAverage: isLocked ? finalGrade : averageOfTpAverages(tpDetails.map((tp) => tp.average)),
    isLocked,
    includedActivityCount,
    gradedActivityCount,
    missedActivityCount,
    waitingActivityCount,
    openActivityCount,
    totalActivityCount: studentAssignments.length,
    assessedTpCount: tpDetails.filter((tp) => tp.average != null).length,
    totalTpCount: tpDetails.length,
    highestScore,
    highestScoreCount,
    tpDetails,
  };
}
