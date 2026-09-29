import { createClient } from "@/lib/supabase/server";
import { appliesToGrade } from "@/lib/data/subjects";
import { listAnnouncements, type AnnouncementRow } from "@/lib/data/announcements";
import type { TeacherClassSubject } from "@/lib/data/teaching";

export async function getStudentDashboardData(studentId: string, classId: string | null) {
  const supabase = await createClient();

  const [
    { data: announcements },
    { data: assignmentRows },
    { data: subjects },
    { data: materials },
    { data: klass },
  ] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, body, created_at")
      .order("created_at", { ascending: false })
      .limit(3),
    classId
      ? supabase
          .from("assignments")
          .select("id, title, kind, subject_id, due_at, is_published, subjects(name)")
          .eq("class_id", classId)
          .eq("is_published", true)
          .order("due_at")
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("subjects")
      .select("id, code, name, emoji, color, min_grade, max_grade")
      .order("name"),
    classId
      ? supabase.from("materials").select("id, subject_id, created_at").eq("class_id", classId)
      : Promise.resolve({ data: [] as never[] }),
    classId
      ? supabase.from("classes").select("grade_level").eq("id", classId).single()
      : Promise.resolve({ data: null }),
  ]);

  const assignmentIds = (assignmentRows ?? []).map((a) => a.id);
  const [{ data: submissions }, { count: materialsStudiedCount }, { data: completedSubmissions }] =
    await Promise.all([
      assignmentIds.length > 0
        ? supabase
            .from("submissions")
            .select("assignment_id, status")
            .eq("student_id", studentId)
            .in("assignment_id", assignmentIds)
        : Promise.resolve({ data: [] as { assignment_id: string; status: string }[] }),
      supabase
        .from("material_views")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId),
      supabase
        .from("submissions")
        .select("assignment_id, assignments(kind)")
        .eq("student_id", studentId)
        .in("status", ["submitted", "graded"]),
    ]);

  const statusByAssignment = new Map((submissions ?? []).map((s) => [s.assignment_id, s.status]));
  const isPending = (assignmentId: string) => {
    const status = statusByAssignment.get(assignmentId);
    return status == null || status === "belum" || status === "dikerjakan";
  };
  const pendingTugasCount = (assignmentRows ?? []).filter(
    (a) => a.kind !== "quiz" && isPending(a.id),
  ).length;
  const pendingKuisCount = (assignmentRows ?? []).filter(
    (a) => a.kind === "quiz" && isPending(a.id),
  ).length;

  let tugasCompletedCount = 0;
  let kuisCompletedCount = 0;
  for (const s of completedSubmissions ?? []) {
    const kind = (s.assignments as unknown as { kind: string } | null)?.kind;
    if (kind === "quiz") kuisCompletedCount++;
    else if (kind) tugasCompletedCount++;
  }

  const gradeLevel = klass?.grade_level ?? null;
  const visibleSubjects = (subjects ?? []).filter((s) =>
    appliesToGrade(gradeLevel, s.min_grade, s.max_grade),
  );

  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const newMaterialsCount = (materials ?? []).filter(
    (m) => new Date(m.created_at).getTime() >= sevenDaysAgo,
  ).length;

  const materialCountBySubject = new Map<string, number>();
  for (const m of materials ?? []) {
    materialCountBySubject.set(m.subject_id, (materialCountBySubject.get(m.subject_id) ?? 0) + 1);
  }
  const tugasCountBySubject = new Map<string, number>();
  const kuisCountBySubject = new Map<string, number>();
  for (const a of assignmentRows ?? []) {
    const map = a.kind === "quiz" ? kuisCountBySubject : tugasCountBySubject;
    map.set(a.subject_id, (map.get(a.subject_id) ?? 0) + 1);
  }
  const subjectsWithCounts = visibleSubjects.map((s) => ({
    ...s,
    materialCount: materialCountBySubject.get(s.id) ?? 0,
    tugasCount: tugasCountBySubject.get(s.id) ?? 0,
    kuisCount: kuisCountBySubject.get(s.id) ?? 0,
  }));

  const activeTasks = (assignmentRows ?? [])
    .filter((a) => isPending(a.id))
    .sort((a, b) => {
      if (!a.due_at && !b.due_at) return 0;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    })
    .slice(0, 3)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      subject: (a.subjects as unknown as { name: string } | null)?.name ?? "",
      due: a.due_at ? new Date(a.due_at).toLocaleDateString("id-ID") : "-",
    }));

  const hasAnyAssignments = (assignmentRows ?? []).length > 0;
  const totalMaterialsCount = (materials ?? []).length;
  const totalTugasCount = (assignmentRows ?? []).filter((a) => a.kind !== "quiz").length;
  const totalKuisCount = (assignmentRows ?? []).filter((a) => a.kind === "quiz").length;

  return {
    announcements: announcements ?? [],
    activeTasks,
    hasAnyAssignments,
    subjects: subjectsWithCounts,
    newMaterialsCount,
    pendingTugasCount,
    pendingKuisCount,
    materialsStudiedCount: materialsStudiedCount ?? 0,
    tugasCompletedCount,
    kuisCompletedCount,
    totalMaterialsCount,
    totalTugasCount,
    totalKuisCount,
  };
}

export interface PrincipalTodayActivity {
  materialsUploaded: number;
  assignmentsCreated: number;
  quizzesCreated: number;
  attendanceFilled: number;
  tugasSubmitted: number;
  kuisCompleted: number;
}

export interface PrincipalTopTeacher {
  id: string;
  name: string;
  materials: number;
  assignments: number;
  attendanceSessions: number;
}

export interface PrincipalRecentActivityItem {
  id: string;
  text: string;
  timestamp: string;
}

export interface PrincipalDashboardData {
  totalStudents: number;
  totalTeachers: number;
  totalClasses: number;
  todayActivity: PrincipalTodayActivity;
  weeklyActivity: { day: string; total: number }[];
  monthlySummary: { materials: number; assignments: number; quizzes: number };
  topTeachers: PrincipalTopTeacher[];
  monitoring: {
    mostActiveClassName: string | null;
    mostActiveSubjectName: string | null;
    tugasCompletionPercent: number | null;
    kuisCompletionPercent: number | null;
  };
  recentAnnouncements: AnnouncementRow[];
  recentActivity: PrincipalRecentActivityItem[];
}

export async function getPrincipalDashboardData(): Promise<PrincipalDashboardData> {
  const supabase = await createClient();

  const [
    { data: profiles },
    { data: classes },
    { data: subjects },
    { data: materials },
    { data: assignments },
    { data: meetings },
    { data: submissions },
    recentAnnouncements,
  ] = await Promise.all([
    supabase.from("profiles").select("id, role, class_id, full_name"),
    supabase.from("classes").select("id, name"),
    supabase.from("subjects").select("id, name"),
    supabase.from("materials").select("id, teacher_id, subject_id, class_id, created_at"),
    supabase.from("assignments").select("id, teacher_id, subject_id, class_id, kind, created_at"),
    supabase.from("class_meetings").select("id, teacher_id, subject_id, class_id, created_at"),
    supabase.from("submissions").select("id, assignment_id, student_id, status, submitted_at"),
    listAnnouncements(3),
  ]);

  const roleCounts = { student: 0, teacher: 0, principal: 0, admin: 0 };
  const teacherNameById = new Map<string, string>();
  const studentNameById = new Map<string, string>();
  const studentCountByClass = new Map<string, number>();
  for (const p of profiles ?? []) {
    roleCounts[p.role as keyof typeof roleCounts]++;
    if (p.role === "teacher") teacherNameById.set(p.id, p.full_name);
    if (p.role === "student") {
      studentNameById.set(p.id, p.full_name);
      if (p.class_id)
        studentCountByClass.set(p.class_id, (studentCountByClass.get(p.class_id) ?? 0) + 1);
    }
  }

  const classNameById = new Map((classes ?? []).map((c) => [c.id, c.name]));
  const subjectNameById = new Map((subjects ?? []).map((s) => [s.id, s.name]));
  const assignmentById = new Map((assignments ?? []).map((a) => [a.id, a]));

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(startOfToday.getTime() - 6 * 86400000);

  function dayKey(iso: string) {
    return new Date(iso).toISOString().slice(0, 10);
  }

  const dayBuckets: { key: string; day: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(startOfToday.getTime() - i * 86400000);
    dayBuckets.push({
      key: d.toISOString().slice(0, 10),
      day: d.toLocaleDateString("id-ID", { weekday: "short" }),
      total: 0,
    });
  }
  const bucketByKey = new Map(dayBuckets.map((b) => [b.key, b]));
  function addToWeekBucket(iso: string) {
    const bucket = bucketByKey.get(dayKey(iso));
    if (bucket) bucket.total++;
  }

  const todayActivity: PrincipalTodayActivity = {
    materialsUploaded: 0,
    assignmentsCreated: 0,
    quizzesCreated: 0,
    attendanceFilled: 0,
    tugasSubmitted: 0,
    kuisCompleted: 0,
  };
  const monthlySummary = { materials: 0, assignments: 0, quizzes: 0 };

  const classActivity = new Map<string, number>();
  const subjectActivity = new Map<string, number>();
  function bump(map: Map<string, number>, key: string | null | undefined) {
    if (!key) return;
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  const materialCountByTeacher = new Map<string, number>();
  const assignmentCountByTeacher = new Map<string, number>();
  const meetingCountByTeacher = new Map<string, number>();

  const timeline: { timestamp: string; text: string }[] = [];

  for (const m of materials ?? []) {
    const created = new Date(m.created_at);
    if (created >= startOfToday) todayActivity.materialsUploaded++;
    if (created >= startOfMonth) monthlySummary.materials++;
    if (created >= startOfWeek) addToWeekBucket(m.created_at);
    bump(classActivity, m.class_id);
    bump(subjectActivity, m.subject_id);
    if (m.teacher_id) {
      materialCountByTeacher.set(m.teacher_id, (materialCountByTeacher.get(m.teacher_id) ?? 0) + 1);
      timeline.push({
        timestamp: m.created_at,
        text: `Guru ${teacherNameById.get(m.teacher_id) ?? "?"} mengunggah materi`,
      });
    }
  }

  for (const a of assignments ?? []) {
    const created = new Date(a.created_at);
    const isQuiz = a.kind === "quiz";
    if (created >= startOfToday) {
      if (isQuiz) todayActivity.quizzesCreated++;
      else todayActivity.assignmentsCreated++;
    }
    if (created >= startOfMonth) {
      if (isQuiz) monthlySummary.quizzes++;
      else monthlySummary.assignments++;
    }
    if (created >= startOfWeek) addToWeekBucket(a.created_at);
    bump(classActivity, a.class_id);
    bump(subjectActivity, a.subject_id);
    if (a.teacher_id) {
      assignmentCountByTeacher.set(
        a.teacher_id,
        (assignmentCountByTeacher.get(a.teacher_id) ?? 0) + 1,
      );
      timeline.push({
        timestamp: a.created_at,
        text: `Guru ${teacherNameById.get(a.teacher_id) ?? "?"} ${isQuiz ? "membuat kuis" : "membuat tugas"}`,
      });
    }
  }

  for (const mt of meetings ?? []) {
    const created = new Date(mt.created_at);
    if (created >= startOfToday) todayActivity.attendanceFilled++;
    if (created >= startOfWeek) addToWeekBucket(mt.created_at);
    bump(classActivity, mt.class_id);
    bump(subjectActivity, mt.subject_id);
    if (mt.teacher_id) {
      meetingCountByTeacher.set(mt.teacher_id, (meetingCountByTeacher.get(mt.teacher_id) ?? 0) + 1);
      timeline.push({
        timestamp: mt.created_at,
        text: `Guru ${teacherNameById.get(mt.teacher_id) ?? "?"} mengisi presensi`,
      });
    }
  }

  const submittedByAssignment = new Map<string, number>();
  for (const s of submissions ?? []) {
    if (s.status !== "submitted" && s.status !== "graded") continue;
    submittedByAssignment.set(
      s.assignment_id,
      (submittedByAssignment.get(s.assignment_id) ?? 0) + 1,
    );

    const a = assignmentById.get(s.assignment_id);
    const isQuiz = a?.kind === "quiz";
    if (a) {
      bump(classActivity, a.class_id);
      bump(subjectActivity, a.subject_id);
    }
    if (!s.submitted_at) continue;
    const submitted = new Date(s.submitted_at);
    if (submitted >= startOfToday) {
      if (isQuiz) todayActivity.kuisCompleted++;
      else todayActivity.tugasSubmitted++;
    }
    if (submitted >= startOfWeek) addToWeekBucket(s.submitted_at);
    timeline.push({
      timestamp: s.submitted_at,
      text: `Siswa ${studentNameById.get(s.student_id) ?? "?"} ${isQuiz ? "menyelesaikan kuis" : "menyelesaikan tugas"}`,
    });
  }

  let tugasExpected = 0;
  let tugasActual = 0;
  let kuisExpected = 0;
  let kuisActual = 0;
  for (const a of assignments ?? []) {
    const expected = studentCountByClass.get(a.class_id) ?? 0;
    const actual = submittedByAssignment.get(a.id) ?? 0;
    if (a.kind === "quiz") {
      kuisExpected += expected;
      kuisActual += actual;
    } else {
      tugasExpected += expected;
      tugasActual += actual;
    }
  }

  function topEntryName(map: Map<string, number>, nameById: Map<string, string>): string | null {
    let bestKey: string | null = null;
    let bestValue = 0;
    for (const [key, value] of map) {
      if (value > bestValue) {
        bestValue = value;
        bestKey = key;
      }
    }
    return bestKey ? (nameById.get(bestKey) ?? null) : null;
  }

  const topTeachers: PrincipalTopTeacher[] = [...teacherNameById.entries()]
    .map(([id, name]) => ({
      id,
      name,
      materials: materialCountByTeacher.get(id) ?? 0,
      assignments: assignmentCountByTeacher.get(id) ?? 0,
      attendanceSessions: meetingCountByTeacher.get(id) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.materials +
        b.assignments +
        b.attendanceSessions -
        (a.materials + a.assignments + a.attendanceSessions),
    )
    .slice(0, 3);

  const recentActivity: PrincipalRecentActivityItem[] = timeline
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 5)
    .map((item, i) => ({ id: String(i), text: item.text, timestamp: item.timestamp }));

  return {
    totalStudents: roleCounts.student,
    totalTeachers: roleCounts.teacher,
    totalClasses: classes?.length ?? 0,
    todayActivity,
    weeklyActivity: dayBuckets.map((b) => ({ day: b.day, total: b.total })),
    monthlySummary,
    topTeachers,
    monitoring: {
      mostActiveClassName: topEntryName(classActivity, classNameById),
      mostActiveSubjectName: topEntryName(subjectActivity, subjectNameById),
      tugasCompletionPercent:
        tugasExpected > 0 ? Math.min(100, Math.round((tugasActual / tugasExpected) * 100)) : null,
      kuisCompletionPercent:
        kuisExpected > 0 ? Math.min(100, Math.round((kuisActual / kuisExpected) * 100)) : null,
    },
    recentAnnouncements,
    recentActivity,
  };
}

export interface TeacherAttendanceSummaryItem {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  hadirPercent: number;
  hadir: number;
  izin: number;
  sakit: number;
  alfa: number;
}

export interface TeacherUpcomingDeadline {
  id: string;
  title: string;
  kindLabel: string;
  subjectName: string;
  className: string;
  dueAt: string;
}

export interface TeacherRecentActivityItem {
  id: string;
  text: string;
  timestamp: string;
}

export interface TeacherDashboardData {
  totalClasses: number;
  totalStudents: number;
  kuisAktif: number;
  tugasBelumDinilai: number;
  attendanceSummary: TeacherAttendanceSummaryItem[];
  upcomingDeadlines: TeacherUpcomingDeadline[];
  recentAnnouncements: AnnouncementRow[];
  recentActivity: TeacherRecentActivityItem[];
}

const QUIZ_TYPE_LABEL: Record<string, string> = {
  latihan: "Kuis Latihan",
  ulangan_harian: "Ulangan Harian",
  uts: "UTS",
  uas: "UAS",
};

export async function getTeacherDashboardData(
  teacherId: string,
  classIds: string[],
  combos: TeacherClassSubject[],
): Promise<TeacherDashboardData> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  if (classIds.length === 0) {
    const recentAnnouncements = await listAnnouncements(3);
    return {
      totalClasses: 0,
      totalStudents: 0,
      kuisAktif: 0,
      tugasBelumDinilai: 0,
      attendanceSummary: [],
      upcomingDeadlines: [],
      recentAnnouncements,
      recentActivity: [],
    };
  }

  const [
    { count: totalStudents },
    { count: kuisAktif },
    { data: tugasRows },
    { data: meetingRows },
    { data: deadlineRows },
    { data: teacherAssignments },
    recentAnnouncements,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "student")
      .in("class_id", classIds),
    supabase
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .eq("kind", "quiz")
      .eq("is_published", true)
      .eq("is_active", true)
      .gt("due_at", nowIso)
      .in("class_id", classIds),
    supabase.from("assignments").select("id").neq("kind", "quiz").in("class_id", classIds),
    supabase
      .from("class_meetings")
      .select("id, class_id, subject_id, meeting_number")
      .eq("teacher_id", teacherId)
      .order("meeting_number", { ascending: false }),
    supabase
      .from("assignments")
      .select("id, title, kind, quiz_type, due_at, is_active, subject_id, class_id")
      .eq("teacher_id", teacherId)
      .eq("is_published", true)
      .gt("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(15),
    supabase.from("assignments").select("id, kind").eq("teacher_id", teacherId),
    listAnnouncements(3),
  ]);

  // Tugas belum dinilai
  const tugasIds = (tugasRows ?? []).map((a) => a.id);
  let tugasBelumDinilai = 0;
  if (tugasIds.length > 0) {
    const { data: submissions } = await supabase
      .from("submissions")
      .select("status")
      .in("assignment_id", tugasIds);
    for (const s of submissions ?? []) {
      if (s.status === "submitted") tugasBelumDinilai++;
    }
  }

  // Attendance summary: latest meeting per (class, subject) combo the teacher teaches
  const latestMeetingByComboKey = new Map<string, string>();
  for (const m of meetingRows ?? []) {
    const key = `${m.class_id}:${m.subject_id}`;
    if (!latestMeetingByComboKey.has(key)) latestMeetingByComboKey.set(key, m.id);
  }
  const latestMeetingIds = [...latestMeetingByComboKey.values()];
  const { data: attendanceRecords } =
    latestMeetingIds.length > 0
      ? await supabase
          .from("attendance_records")
          .select("meeting_id, status")
          .in("meeting_id", latestMeetingIds)
      : { data: [] as { meeting_id: string; status: string }[] };

  type AttStatus = "hadir" | "sakit" | "izin" | "alfa";
  const isAttStatus = (v: string): v is AttStatus =>
    v === "hadir" || v === "sakit" || v === "izin" || v === "alfa";
  const countsByMeetingId = new Map<string, Record<AttStatus, number>>();
  for (const r of attendanceRecords ?? []) {
    const acc = countsByMeetingId.get(r.meeting_id) ?? { hadir: 0, sakit: 0, izin: 0, alfa: 0 };
    if (isAttStatus(r.status)) acc[r.status]++;
    countsByMeetingId.set(r.meeting_id, acc);
  }

  const attendanceSummary: TeacherAttendanceSummaryItem[] = combos.map((c) => {
    const meetingId = latestMeetingByComboKey.get(`${c.classId}:${c.subjectId}`);
    const counts = (meetingId && countsByMeetingId.get(meetingId)) || {
      hadir: 0,
      sakit: 0,
      izin: 0,
      alfa: 0,
    };
    const total = counts.hadir + counts.sakit + counts.izin + counts.alfa;
    return {
      classId: c.classId,
      className: c.className,
      subjectId: c.subjectId,
      subjectName: c.subjectName,
      hadirPercent: total > 0 ? Math.round((counts.hadir / total) * 100) : 0,
      hadir: counts.hadir,
      izin: counts.izin,
      sakit: counts.sakit,
      alfa: counts.alfa,
    };
  });

  // Upcoming deadlines (tugas + kuis), skip deactivated quizzes, cap at 5
  const classNameById = new Map(combos.map((c) => [c.classId, c.className]));
  const subjectNameById = new Map(combos.map((c) => [c.subjectId, c.subjectName]));
  const upcomingDeadlines: TeacherUpcomingDeadline[] = (deadlineRows ?? [])
    .filter((a) => a.kind !== "quiz" || a.is_active)
    .slice(0, 5)
    .map((a) => ({
      id: a.id,
      title: a.title,
      kindLabel: a.kind === "quiz" ? (QUIZ_TYPE_LABEL[a.quiz_type ?? ""] ?? "Kuis") : "Tugas",
      subjectName: subjectNameById.get(a.subject_id) ?? "-",
      className: classNameById.get(a.class_id) ?? "-",
      dueAt: a.due_at as string,
    }));

  // Recent activity: students completing this teacher's tugas/kuis
  const assignmentKindById = new Map((teacherAssignments ?? []).map((a) => [a.id, a.kind]));
  const teacherAssignmentIds = (teacherAssignments ?? []).map((a) => a.id);
  let recentActivity: TeacherRecentActivityItem[] = [];
  if (teacherAssignmentIds.length > 0) {
    const { data: subs } = await supabase
      .from("submissions")
      .select("id, assignment_id, student_id, status, submitted_at")
      .in("assignment_id", teacherAssignmentIds)
      .in("status", ["submitted", "graded"])
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(5);

    const studentIds = [...new Set((subs ?? []).map((s) => s.student_id))];
    const { data: studentRows } =
      studentIds.length > 0
        ? await supabase.from("profiles").select("id, full_name").in("id", studentIds)
        : { data: [] as { id: string; full_name: string }[] };
    const studentNameById = new Map((studentRows ?? []).map((s) => [s.id, s.full_name]));

    recentActivity = (subs ?? []).map((s, i) => {
      const isQuiz = assignmentKindById.get(s.assignment_id) === "quiz";
      return {
        id: String(i),
        text: `Siswa ${studentNameById.get(s.student_id) ?? "?"} ${isQuiz ? "menyelesaikan kuis" : "menyelesaikan tugas"}`,
        timestamp: s.submitted_at as string,
      };
    });
  }

  return {
    totalClasses: classIds.length,
    totalStudents: totalStudents ?? 0,
    kuisAktif: kuisAktif ?? 0,
    tugasBelumDinilai,
    attendanceSummary,
    upcomingDeadlines,
    recentAnnouncements,
    recentActivity,
  };
}

export async function getAdminDashboardData() {
  const supabase = await createClient();
  const { data: activeYear } = await supabase
    .from("academic_years")
    .select("id, year_label")
    .eq("is_active", true)
    .maybeSingle();

  const [{ data: profiles }, { data: classRows }, { data: studentClassRows }] = await Promise.all([
    supabase.from("profiles").select("role"),
    activeYear
      ? supabase
          .from("classes")
          .select("id, name, grade_level")
          .eq("academic_year_id", activeYear.id)
          .order("grade_level")
      : Promise.resolve({ data: [] as { id: string; name: string; grade_level: number }[] }),
    supabase.from("profiles").select("class_id").eq("role", "student"),
  ]);
  const counts = { student: 0, teacher: 0, principal: 0, admin: 0 };
  for (const row of profiles ?? []) counts[row.role as keyof typeof counts]++;
  const perClass = new Map<string, number>();
  for (const row of studentClassRows ?? []) {
    if (!row.class_id) continue;
    perClass.set(row.class_id, (perClass.get(row.class_id) ?? 0) + 1);
  }
  const studentsPerClass = (classRows ?? []).map((c) => ({
    name: c.name,
    siswa: perClass.get(c.id) ?? 0,
  }));

  return {
    totalStudents: counts.student,
    totalTeachers: counts.teacher,
    totalPrincipals: counts.principal,
    totalUsers: counts.student + counts.teacher + counts.principal + counts.admin,
    activeAcademicYearLabel: activeYear?.year_label ?? null,
    studentsPerClass,
  };
}
