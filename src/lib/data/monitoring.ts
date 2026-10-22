import { createClient } from "@/lib/supabase/server";
import { appliesToGrade } from "@/lib/data/subjects";
import { calculateCurrentClassGrade, percentOf } from "@/lib/data/learningMetrics";

export interface MonitoringClassRow {
  classId: string;
  className: string;
  studentCount: number;
  attendancePercent: number | null;
  tugasCompletionPercent: number | null;
  kuisCompletionPercent: number | null;
}

export interface MonitoringPembelajaranData {
  academicYearLabel: string;
  semester: "ganjil" | "genap";
  totalActiveClasses: number;
  averageAttendancePercent: number | null;
  tugasCompletionPercent: number | null;
  kuisCompletionPercent: number | null;
  classRows: MonitoringClassRow[];
}

export async function getMonitoringPembelajaranData(): Promise<MonitoringPembelajaranData | null> {
  const supabase = await createClient();
  const activeYearResult = await supabase
    .from("academic_years")
    .select("id, year_label, semester")
    .eq("is_active", true)
    .maybeSingle();
  if (activeYearResult.error) throw new Error("Tahun ajaran aktif belum dapat dimuat.");
  const activeYear = activeYearResult.data;
  if (!activeYear) return null;

  const classesResult = await supabase
    .from("classes")
    .select("id, name")
    .eq("academic_year_id", activeYear.id)
    .order("grade_level");
  if (classesResult.error) throw new Error("Daftar kelas belum dapat dimuat.");
  const classes = classesResult.data ?? [];
  const classIds = classes.map((row) => row.id);

  const [meetingsResult, assignmentsResult, studentsResult] = await Promise.all([
    classIds.length > 0
      ? supabase.from("class_meetings").select("id, class_id").in("class_id", classIds)
      : Promise.resolve({ data: [] as { id: string; class_id: string }[], error: null }),
    classIds.length > 0
      ? supabase
          .from("assignments")
          .select("id, class_id, kind, is_active")
          .in("class_id", classIds)
          .eq("is_published", true)
      : Promise.resolve({
          data: [] as { id: string; class_id: string; kind: string; is_active: boolean }[],
          error: null,
        }),
    classIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, class_id")
          .eq("role", "student")
          .in("class_id", classIds)
      : Promise.resolve({ data: [] as { id: string; class_id: string | null }[], error: null }),
  ]);
  if (meetingsResult.error || assignmentsResult.error || studentsResult.error) {
    throw new Error("Data monitoring pembelajaran belum dapat dimuat.");
  }
  const meetings = meetingsResult.data ?? [];
  const assignments = (assignmentsResult.data ?? []).filter(
    (assignment) => assignment.kind !== "quiz" || assignment.is_active,
  );
  const students = studentsResult.data ?? [];

  const meetingIds = meetings.map((meeting) => meeting.id);
  const assignmentIds = assignments.map((assignment) => assignment.id);
  const [attendanceResult, submissionsResult] = await Promise.all([
    meetingIds.length > 0
      ? supabase
          .from("attendance_records")
          .select("status, meeting_id")
          .in("meeting_id", meetingIds)
      : Promise.resolve({ data: [] as { status: string; meeting_id: string }[], error: null }),
    assignmentIds.length > 0
      ? supabase
          .from("submissions")
          .select("assignment_id, status")
          .in("assignment_id", assignmentIds)
      : Promise.resolve({ data: [] as { assignment_id: string; status: string }[], error: null }),
  ]);
  if (attendanceResult.error || submissionsResult.error) {
    throw new Error("Rekap monitoring pembelajaran belum dapat dihitung.");
  }

  const classIdByMeeting = new Map(meetings.map((meeting) => [meeting.id, meeting.class_id]));
  const attendanceByClass = new Map<string, { hadir: number; total: number }>();
  for (const record of attendanceResult.data ?? []) {
    const classId = classIdByMeeting.get(record.meeting_id);
    if (!classId) continue;
    const summary = attendanceByClass.get(classId) ?? { hadir: 0, total: 0 };
    summary.total++;
    if (record.status === "hadir") summary.hadir++;
    attendanceByClass.set(classId, summary);
  }

  const studentCountByClass = new Map<string, number>();
  for (const student of students) {
    if (!student.class_id) continue;
    studentCountByClass.set(student.class_id, (studentCountByClass.get(student.class_id) ?? 0) + 1);
  }
  const submittedByAssignment = new Map<string, number>();
  for (const submission of submissionsResult.data ?? []) {
    if (submission.status !== "submitted" && submission.status !== "graded") continue;
    submittedByAssignment.set(
      submission.assignment_id,
      (submittedByAssignment.get(submission.assignment_id) ?? 0) + 1,
    );
  }

  const tugasByClass = new Map<string, { expected: number; actual: number }>();
  const kuisByClass = new Map<string, { expected: number; actual: number }>();
  let tugasExpected = 0;
  let tugasActual = 0;
  let kuisExpected = 0;
  let kuisActual = 0;
  for (const assignment of assignments) {
    const expected = studentCountByClass.get(assignment.class_id) ?? 0;
    const actual = Math.min(submittedByAssignment.get(assignment.id) ?? 0, expected);
    const target = assignment.kind === "quiz" ? kuisByClass : tugasByClass;
    const summary = target.get(assignment.class_id) ?? { expected: 0, actual: 0 };
    summary.expected += expected;
    summary.actual += actual;
    target.set(assignment.class_id, summary);
    if (assignment.kind === "quiz") {
      kuisExpected += expected;
      kuisActual += actual;
    } else {
      tugasExpected += expected;
      tugasActual += actual;
    }
  }

  const classRows = classes.map((classroom) => {
    const attendance = attendanceByClass.get(classroom.id) ?? { hadir: 0, total: 0 };
    const tugas = tugasByClass.get(classroom.id) ?? { expected: 0, actual: 0 };
    const kuis = kuisByClass.get(classroom.id) ?? { expected: 0, actual: 0 };
    return {
      classId: classroom.id,
      className: classroom.name,
      studentCount: studentCountByClass.get(classroom.id) ?? 0,
      attendancePercent: percentOf(attendance.hadir, attendance.total),
      tugasCompletionPercent: percentOf(tugas.actual, tugas.expected),
      kuisCompletionPercent: percentOf(kuis.actual, kuis.expected),
    };
  });
  const hadirCount = (attendanceResult.data ?? []).filter(
    (record) => record.status === "hadir",
  ).length;

  return {
    academicYearLabel: activeYear.year_label,
    semester: activeYear.semester,
    totalActiveClasses: classIds.length,
    averageAttendancePercent: percentOf(hadirCount, attendanceResult.data?.length ?? 0),
    tugasCompletionPercent: percentOf(tugasActual, tugasExpected),
    kuisCompletionPercent: percentOf(kuisActual, kuisExpected),
    classRows,
  };
}

export interface ClassDetailSubjectRow {
  subjectId: string;
  subjectName: string;
  materiCount: number;
  tugasCount: number;
  kuisCount: number;
}

export interface ClassDetailActivityItem {
  id: string;
  subjectId: string;
  title: string;
  createdAt: string;
  dueAt: string | null;
  status: "Aktif" | "Berlangsung" | "Tenggat Berakhir" | "Selesai";
}

export interface ClassMonitoringDetail {
  classId: string;
  className: string;
  studentCount: number;
  academicYearLabel: string;
  semester: "ganjil" | "genap";
  attendancePercent: number | null;
  tugasCompletionPercent: number | null;
  kuisCompletionPercent: number | null;
  averageGradePercent: number | null;
  gradeIsFinal: boolean;
  finalGradebookCount: number;
  totalGradebookCount: number;
  subjectRows: ClassDetailSubjectRow[];
  materialItems: ClassDetailActivityItem[];
  tugasItems: ClassDetailActivityItem[];
  kuisItems: ClassDetailActivityItem[];
}

export async function getClassMonitoringDetail(
  classId: string,
): Promise<ClassMonitoringDetail | null> {
  const supabase = await createClient();
  const activeYearResult = await supabase
    .from("academic_years")
    .select("id, year_label, semester")
    .eq("is_active", true)
    .maybeSingle();
  if (activeYearResult.error) throw new Error("Tahun ajaran aktif belum dapat dimuat.");
  const activeYear = activeYearResult.data;
  if (!activeYear) return null;

  const classResult = await supabase
    .from("classes")
    .select("id, name, grade_level")
    .eq("id", classId)
    .eq("academic_year_id", activeYear.id)
    .maybeSingle();
  if (classResult.error) throw new Error("Kelas belum dapat dimuat.");
  const classroom = classResult.data;
  if (!classroom) return null;

  const [
    studentsResult,
    subjectsResult,
    meetingsResult,
    materialsResult,
    assignmentsResult,
    ctsResult,
    locksResult,
    gradesResult,
  ] = await Promise.all([
    supabase.from("profiles").select("id").eq("class_id", classId).eq("role", "student"),
    supabase.from("subjects").select("id, name, min_grade, max_grade").order("name"),
    supabase.from("class_meetings").select("id").eq("class_id", classId),
    supabase
      .from("materials")
      .select("id, subject_id, title, created_at")
      .eq("class_id", classId)
      .eq("is_active", true),
    supabase
      .from("assignments")
      .select("id, subject_id, title, kind, due_at, created_at, is_active, learning_objective_id")
      .eq("class_id", classId)
      .eq("is_published", true),
    supabase.from("class_teacher_subjects").select("subject_id").eq("class_id", classId),
    supabase.from("gradebook_locks").select("subject_id").eq("class_id", classId),
    supabase.from("grades").select("student_id, subject_id, score").eq("class_id", classId),
  ]);
  if (
    studentsResult.error ||
    subjectsResult.error ||
    meetingsResult.error ||
    materialsResult.error ||
    assignmentsResult.error ||
    ctsResult.error ||
    locksResult.error ||
    gradesResult.error
  ) {
    throw new Error("Detail monitoring kelas belum dapat dimuat.");
  }

  const students = studentsResult.data ?? [];
  const materials = materialsResult.data ?? [];
  const assignments = (assignmentsResult.data ?? []).filter(
    (assignment) => assignment.kind !== "quiz" || assignment.is_active,
  );
  const meetingIds = (meetingsResult.data ?? []).map((meeting) => meeting.id);
  const assignmentIds = assignments.map((assignment) => assignment.id);
  const [attendanceResult, submissionsResult] = await Promise.all([
    meetingIds.length > 0
      ? supabase.from("attendance_records").select("status").in("meeting_id", meetingIds)
      : Promise.resolve({ data: [] as { status: string }[], error: null }),
    assignmentIds.length > 0
      ? supabase
          .from("submissions")
          .select("assignment_id, student_id, status, score")
          .in("assignment_id", assignmentIds)
      : Promise.resolve({
          data: [] as {
            assignment_id: string;
            student_id: string;
            status: string;
            score: number | null;
          }[],
          error: null,
        }),
  ]);
  if (attendanceResult.error || submissionsResult.error) {
    throw new Error("Rekap kelas belum dapat dihitung.");
  }

  const submittedByAssignment = new Map<string, number>();
  for (const submission of submissionsResult.data ?? []) {
    if (submission.status !== "submitted" && submission.status !== "graded") continue;
    submittedByAssignment.set(
      submission.assignment_id,
      (submittedByAssignment.get(submission.assignment_id) ?? 0) + 1,
    );
  }

  const expectedPerAssignment = students.length;
  const lockedSubjectIds = new Set((locksResult.data ?? []).map((lock) => lock.subject_id));
  const materialItems: ClassDetailActivityItem[] = materials.map((material) => ({
    id: material.id,
    subjectId: material.subject_id,
    title: material.title,
    createdAt: material.created_at,
    dueAt: null,
    status: "Aktif",
  }));
  const tugasItems: ClassDetailActivityItem[] = [];
  const kuisItems: ClassDetailActivityItem[] = [];
  let tugasExpected = 0;
  let tugasActual = 0;
  let kuisExpected = 0;
  let kuisActual = 0;
  for (const assignment of assignments) {
    const actual = Math.min(submittedByAssignment.get(assignment.id) ?? 0, expectedPerAssignment);
    const status = lockedSubjectIds.has(assignment.subject_id)
      ? "Selesai"
      : assignment.due_at && new Date(assignment.due_at).getTime() <= Date.now()
        ? "Tenggat Berakhir"
        : "Berlangsung";
    const item: ClassDetailActivityItem = {
      id: assignment.id,
      subjectId: assignment.subject_id,
      title: assignment.title,
      createdAt: assignment.created_at,
      dueAt: assignment.due_at,
      status,
    };
    if (assignment.kind === "quiz") {
      kuisExpected += expectedPerAssignment;
      kuisActual += actual;
      kuisItems.push(item);
    } else {
      tugasExpected += expectedPerAssignment;
      tugasActual += actual;
      tugasItems.push(item);
    }
  }

  const visibleSubjects = (subjectsResult.data ?? []).filter((subject) =>
    appliesToGrade(classroom.grade_level, subject.min_grade, subject.max_grade),
  );
  const subjectRows = visibleSubjects.map((subject) => ({
    subjectId: subject.id,
    subjectName: subject.name,
    materiCount: materialItems.filter((item) => item.subjectId === subject.id).length,
    tugasCount: tugasItems.filter((item) => item.subjectId === subject.id).length,
    kuisCount: kuisItems.filter((item) => item.subjectId === subject.id).length,
  }));
  const assignedSubjectIds = (ctsResult.data ?? [])
    .map((row) => row.subject_id)
    .filter((id) => visibleSubjects.some((subject) => subject.id === id));
  const gradeSummary = calculateCurrentClassGrade({
    studentIds: students.map((student) => student.id),
    subjectIds: assignedSubjectIds,
    lockedSubjectIds,
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      subjectId: assignment.subject_id,
      learningObjectiveId: assignment.learning_objective_id,
      dueAt: assignment.due_at,
    })),
    submissions: (submissionsResult.data ?? []).map((submission) => ({
      assignmentId: submission.assignment_id,
      studentId: submission.student_id,
      status: submission.status,
      score: submission.score,
    })),
    finalGrades: (gradesResult.data ?? []).map((grade) => ({
      studentId: grade.student_id,
      subjectId: grade.subject_id,
      score: grade.score,
    })),
  });
  const hadirCount = (attendanceResult.data ?? []).filter(
    (record) => record.status === "hadir",
  ).length;

  return {
    classId: classroom.id,
    className: classroom.name,
    studentCount: students.length,
    academicYearLabel: activeYear.year_label,
    semester: activeYear.semester,
    attendancePercent: percentOf(hadirCount, attendanceResult.data?.length ?? 0),
    tugasCompletionPercent: percentOf(tugasActual, tugasExpected),
    kuisCompletionPercent: percentOf(kuisActual, kuisExpected),
    averageGradePercent: gradeSummary.average,
    gradeIsFinal: gradeSummary.isFinal,
    finalGradebookCount: gradeSummary.finalGradebookCount,
    totalGradebookCount: gradeSummary.totalGradebookCount,
    subjectRows,
    materialItems,
    tugasItems,
    kuisItems,
  };
}
