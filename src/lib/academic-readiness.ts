type ClassRow = { id: string; name: string; grade_level: number; academic_year_id: string };
type SubjectRow = { id: string; min_grade: number | null; max_grade: number | null };

export type AcademicReadiness = {
  classCount: number;
  studentCount: number;
  unplacedStudents: number;
  otherPeriodStudents: number;
  emptyClasses: string[];
  missingAssignments: number;
  classesMissingTeachers: string[];
};

export function summarizeAcademicReadiness(
  yearId: string,
  classes: ClassRow[],
  students: { class_id: string | null }[],
  subjects: SubjectRow[],
  assignments: { class_id: string; subject_id: string }[],
): AcademicReadiness {
  const selectedClasses = classes.filter((c) => c.academic_year_id === yearId);
  const ids = new Set(selectedClasses.map((c) => c.id));
  const assigned = new Set(assignments.map((a) => `${a.class_id}:${a.subject_id}`));
  const occupied = new Set(students.map((s) => s.class_id));
  let missingAssignments = 0;
  const classesMissingTeachers: string[] = [];
  for (const c of selectedClasses) {
    const missing = subjects.filter(
      (s) =>
        (s.min_grade === null || c.grade_level >= s.min_grade) &&
        (s.max_grade === null || c.grade_level <= s.max_grade) &&
        !assigned.has(`${c.id}:${s.id}`),
    ).length;
    missingAssignments += missing;
    if (missing) classesMissingTeachers.push(c.name);
  }
  return {
    classCount: selectedClasses.length,
    studentCount: students.filter((s) => s.class_id && ids.has(s.class_id)).length,
    unplacedStudents: students.filter((s) => !s.class_id).length,
    otherPeriodStudents: students.filter((s) => s.class_id && !ids.has(s.class_id)).length,
    emptyClasses: selectedClasses.filter((c) => !occupied.has(c.id)).map((c) => c.name),
    missingAssignments,
    classesMissingTeachers,
  };
}
