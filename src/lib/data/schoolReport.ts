import { createClient } from "@/lib/supabase/server";
import { calculateFinalClassAverage, percentOf } from "@/lib/data/learningMetrics";

export interface SchoolReportTeacherRow {
  teacherId: string;
  name: string;
  materiCount: number;
  tugasCount: number;
  kuisCount: number;
  presensiCount: number;
  totalActivity: number;
}

export interface SchoolReportClassRow {
  classId: string;
  className: string;
  studentCount: number;
  attendanceHadir: number;
  attendanceTotal: number;
  attendancePercent: number | null;
  tugasActual: number;
  tugasExpected: number;
  tugasCompletionPercent: number | null;
  kuisActual: number;
  kuisExpected: number;
  kuisCompletionPercent: number | null;
  averageGradePercent: number | null;
  finalGradebookCount: number;
  totalGradebookCount: number;
}

export interface SchoolReportData {
  activeYearId: string;
  academicYearLabel: string;
  semester: "ganjil" | "genap";
  totalGuruAktif: number;
  totalSiswaAktif: number;
  materiPublishedCount: number;
  aktivitasPembelajaranCount: number;
  finalGradebookCount: number;
  totalGradebookCount: number;
  teacherRows: SchoolReportTeacherRow[];
  classRows: SchoolReportClassRow[];
}

export async function getSchoolReportData(): Promise<SchoolReportData | null> {
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
    .select("id, name, grade_level")
    .eq("academic_year_id", activeYear.id)
    .order("grade_level");
  if (classesResult.error) throw new Error("Kelas tahun ajaran aktif belum dapat dimuat.");
  const classes = classesResult.data ?? [];
  const classIds = classes.map((classroom) => classroom.id);

  const [
    studentsResult,
    ctsResult,
    meetingsResult,
    materialsResult,
    assignmentsResult,
    locksResult,
    gradesResult,
  ] = await Promise.all([
    classIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, class_id")
          .eq("role", "student")
          .in("class_id", classIds)
      : Promise.resolve({ data: [] as { id: string; class_id: string | null }[], error: null }),
    classIds.length > 0
      ? supabase
          .from("class_teacher_subjects")
          .select("teacher_id, class_id, subject_id")
          .in("class_id", classIds)
      : Promise.resolve({
          data: [] as { teacher_id: string; class_id: string; subject_id: string }[],
          error: null,
        }),
    classIds.length > 0
      ? supabase.from("class_meetings").select("id, class_id, teacher_id").in("class_id", classIds)
      : Promise.resolve({
          data: [] as { id: string; class_id: string; teacher_id: string | null }[],
          error: null,
        }),
    classIds.length > 0
      ? supabase
          .from("materials")
          .select("id, class_id, teacher_id")
          .in("class_id", classIds)
          .eq("is_active", true)
      : Promise.resolve({
          data: [] as { id: string; class_id: string; teacher_id: string | null }[],
          error: null,
        }),
    classIds.length > 0
      ? supabase
          .from("assignments")
          .select("id, class_id, teacher_id, kind, is_active")
          .in("class_id", classIds)
          .eq("is_published", true)
      : Promise.resolve({
          data: [] as {
            id: string;
            class_id: string;
            teacher_id: string | null;
            kind: string;
            is_active: boolean;
          }[],
          error: null,
        }),
    classIds.length > 0
      ? supabase.from("gradebook_locks").select("class_id, subject_id").in("class_id", classIds)
      : Promise.resolve({ data: [] as { class_id: string; subject_id: string }[], error: null }),
    classIds.length > 0
      ? supabase
          .from("grades")
          .select("student_id, subject_id, class_id, score")
          .eq("academic_year_id", activeYear.id)
          .in("class_id", classIds)
      : Promise.resolve({
          data: [] as {
            student_id: string;
            subject_id: string;
            class_id: string;
            score: number;
          }[],
          error: null,
        }),
  ]);
  if (
    studentsResult.error ||
    ctsResult.error ||
    meetingsResult.error ||
    materialsResult.error ||
    assignmentsResult.error ||
    locksResult.error ||
    gradesResult.error
  ) {
    throw new Error("Data utama laporan sekolah belum dapat dimuat.");
  }

  const students = studentsResult.data ?? [];
  const assignments = (assignmentsResult.data ?? []).filter(
    (assignment) => assignment.kind !== "quiz" || assignment.is_active,
  );
  const meetings = meetingsResult.data ?? [];
  const materials = materialsResult.data ?? [];
  const cts = ctsResult.data ?? [];
  const locks = locksResult.data ?? [];
  const grades = gradesResult.data ?? [];
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
    throw new Error("Rekap laporan sekolah belum dapat dihitung.");
  }

  const studentCountByClass = new Map<string, number>();
  for (const student of students) {
    if (!student.class_id) continue;
    studentCountByClass.set(student.class_id, (studentCountByClass.get(student.class_id) ?? 0) + 1);
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
  for (const assignment of assignments) {
    const expected = studentCountByClass.get(assignment.class_id) ?? 0;
    const actual = Math.min(submittedByAssignment.get(assignment.id) ?? 0, expected);
    const target = assignment.kind === "quiz" ? kuisByClass : tugasByClass;
    const summary = target.get(assignment.class_id) ?? { expected: 0, actual: 0 };
    summary.expected += expected;
    summary.actual += actual;
    target.set(assignment.class_id, summary);
  }

  const expectedBookKeys = new Set(cts.map((row) => `${row.class_id}:${row.subject_id}`));
  const lockedBookKeys = new Set(
    locks
      .map((row) => `${row.class_id}:${row.subject_id}`)
      .filter((key) => expectedBookKeys.has(key)),
  );
  const classRows = classes.map((classroom) => {
    const attendance = attendanceByClass.get(classroom.id) ?? { hadir: 0, total: 0 };
    const tugas = tugasByClass.get(classroom.id) ?? { expected: 0, actual: 0 };
    const kuis = kuisByClass.get(classroom.id) ?? { expected: 0, actual: 0 };
    const classBookKeys = [...expectedBookKeys].filter((key) => key.startsWith(`${classroom.id}:`));
    const finalGradebookCount = classBookKeys.filter((key) => lockedBookKeys.has(key)).length;
    const lockedSubjectIds = new Set(
      locks
        .filter(
          (lock) =>
            lock.class_id === classroom.id &&
            expectedBookKeys.has(`${lock.class_id}:${lock.subject_id}`),
        )
        .map((lock) => lock.subject_id),
    );
    const classFinalGrades = grades
      .filter((grade) => grade.class_id === classroom.id && lockedSubjectIds.has(grade.subject_id))
      .map((grade) => ({
        studentId: grade.student_id,
        subjectId: grade.subject_id,
        score: grade.score,
      }));
    return {
      classId: classroom.id,
      className: classroom.name,
      studentCount: studentCountByClass.get(classroom.id) ?? 0,
      attendanceHadir: attendance.hadir,
      attendanceTotal: attendance.total,
      attendancePercent: percentOf(attendance.hadir, attendance.total),
      tugasActual: tugas.actual,
      tugasExpected: tugas.expected,
      tugasCompletionPercent: percentOf(tugas.actual, tugas.expected),
      kuisActual: kuis.actual,
      kuisExpected: kuis.expected,
      kuisCompletionPercent: percentOf(kuis.actual, kuis.expected),
      averageGradePercent: calculateFinalClassAverage(classFinalGrades),
      finalGradebookCount,
      totalGradebookCount: classBookKeys.length,
    };
  });

  const teacherIds = [...new Set(cts.map((row) => row.teacher_id))];
  const teacherProfilesResult =
    teacherIds.length > 0
      ? await supabase.from("profiles").select("id, full_name").in("id", teacherIds)
      : { data: [] as { id: string; full_name: string }[], error: null };
  if (teacherProfilesResult.error) throw new Error("Rekap guru belum dapat dimuat.");
  const teacherRows = (teacherProfilesResult.data ?? [])
    .map((teacher) => {
      const materiCount = materials.filter((material) => material.teacher_id === teacher.id).length;
      const tugasCount = assignments.filter(
        (assignment) => assignment.teacher_id === teacher.id && assignment.kind !== "quiz",
      ).length;
      const kuisCount = assignments.filter(
        (assignment) => assignment.teacher_id === teacher.id && assignment.kind === "quiz",
      ).length;
      const presensiCount = meetings.filter((meeting) => meeting.teacher_id === teacher.id).length;
      return {
        teacherId: teacher.id,
        name: teacher.full_name,
        materiCount,
        tugasCount,
        kuisCount,
        presensiCount,
        totalActivity: materiCount + tugasCount + kuisCount + presensiCount,
      };
    })
    .sort((a, b) => b.totalActivity - a.totalActivity);

  return {
    activeYearId: activeYear.id,
    academicYearLabel: activeYear.year_label,
    semester: activeYear.semester,
    totalGuruAktif: teacherIds.length,
    totalSiswaAktif: students.length,
    materiPublishedCount: materials.length,
    aktivitasPembelajaranCount: assignments.length,
    finalGradebookCount: lockedBookKeys.size,
    totalGradebookCount: expectedBookKeys.size,
    teacherRows,
    classRows,
  };
}
