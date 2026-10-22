export function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function averageOfTpAverages(values: (number | null | undefined)[]): number | null {
  const scores = values.filter((value): value is number => value != null);
  const result = average(scores);
  return result == null ? null : round2(result);
}

export interface LearningMetricAssignment {
  id: string;
  subjectId: string;
  learningObjectiveId: string | null;
  dueAt: string | null;
}

export interface LearningMetricSubmission {
  assignmentId: string;
  studentId: string;
  status: string;
  score: number | null;
}

export interface LearningMetricFinalGrade {
  studentId: string;
  subjectId: string;
  score: number;
}

export interface ClassGradeSummary {
  average: number | null;
  finalGradebookCount: number;
  totalGradebookCount: number;
  isFinal: boolean;
}

/**
 * Uses the same two-step formula as Buku Nilai: activity scores are averaged
 * per TP, then the TP averages are averaged per subject. Locked subjects use
 * their immutable final snapshot from `grades`.
 */
export function calculateCurrentClassGrade({
  studentIds,
  subjectIds,
  lockedSubjectIds,
  assignments,
  submissions,
  finalGrades,
  now = Date.now(),
}: {
  studentIds: string[];
  subjectIds: string[];
  lockedSubjectIds: Set<string>;
  assignments: LearningMetricAssignment[];
  submissions: LearningMetricSubmission[];
  finalGrades: LearningMetricFinalGrade[];
  now?: number;
}): ClassGradeSummary {
  const uniqueSubjectIds = [...new Set(subjectIds)];
  const finalGradebookCount = uniqueSubjectIds.filter((id) => lockedSubjectIds.has(id)).length;
  const finalGradeByStudentSubject = new Map(
    finalGrades.map((grade) => [`${grade.studentId}:${grade.subjectId}`, grade.score]),
  );
  const submissionByStudentAssignment = new Map(
    submissions.map((submission) => [
      `${submission.studentId}:${submission.assignmentId}`,
      submission,
    ]),
  );
  const assignmentsBySubject = new Map<string, LearningMetricAssignment[]>();
  for (const assignment of assignments) {
    const rows = assignmentsBySubject.get(assignment.subjectId) ?? [];
    rows.push(assignment);
    assignmentsBySubject.set(assignment.subjectId, rows);
  }

  const studentSubjectScores: number[] = [];
  for (const studentId of studentIds) {
    for (const subjectId of uniqueSubjectIds) {
      if (lockedSubjectIds.has(subjectId)) {
        const finalGrade = finalGradeByStudentSubject.get(`${studentId}:${subjectId}`);
        if (finalGrade != null) studentSubjectScores.push(finalGrade);
        continue;
      }

      const scoresByObjective = new Map<string, number[]>();
      for (const assignment of assignmentsBySubject.get(subjectId) ?? []) {
        if (!assignment.learningObjectiveId) continue;
        const submission = submissionByStudentAssignment.get(`${studentId}:${assignment.id}`);
        let score: number | null = null;
        if (submission?.status === "graded" && submission.score != null) {
          score = submission.score;
        } else if (
          assignment.dueAt &&
          new Date(assignment.dueAt).getTime() <= now &&
          submission?.status !== "submitted"
        ) {
          score = 0;
        }
        if (score == null) continue;
        const values = scoresByObjective.get(assignment.learningObjectiveId) ?? [];
        values.push(score);
        scoresByObjective.set(assignment.learningObjectiveId, values);
      }

      const tpAverages = [...scoresByObjective.values()]
        .map(average)
        .filter((score): score is number => score != null);
      const subjectAverage = averageOfTpAverages(tpAverages);
      if (subjectAverage != null) studentSubjectScores.push(subjectAverage);
    }
  }

  const classAverage = average(studentSubjectScores);
  return {
    average: classAverage == null ? null : round2(classAverage),
    finalGradebookCount,
    totalGradebookCount: uniqueSubjectIds.length,
    isFinal: uniqueSubjectIds.length > 0 && finalGradebookCount === uniqueSubjectIds.length,
  };
}

export function calculateFinalClassAverage(grades: LearningMetricFinalGrade[]): number | null {
  const result = average(grades.map((grade) => grade.score));
  return result == null ? null : round2(result);
}

export function percentOf(actual: number, expected: number): number | null {
  return expected > 0 ? Math.min(100, Math.round((actual / expected) * 100)) : null;
}
