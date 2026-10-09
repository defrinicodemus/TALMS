import { createClient } from "@/lib/supabase/server";
import { getActiveClassIds } from "@/lib/data/active-period";

export type TeacherActivityKind = "materi" | "tugas" | "kuis" | "presensi";

export interface TeacherActivityEvent {
  id: string;
  teacherId: string;
  kind: TeacherActivityKind;
  title: string;
  timestamp: string;
}

export interface TeacherMonitoringTeacher {
  id: string;
  name: string;
}

export interface TeacherMonitoringData {
  teachers: TeacherMonitoringTeacher[];
  events: TeacherActivityEvent[];
}

export async function getTeacherMonitoringData(): Promise<TeacherMonitoringData> {
  const supabase = await createClient();
  const classIds = await getActiveClassIds();

  const [
    { data: teacherProfiles },
    { data: materials },
    { data: assignments },
    { data: meetings },
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("role", "teacher").order("full_name"),
    supabase.from("materials").select("id, teacher_id, title, created_at").in("class_id", classIds),
    supabase
      .from("assignments")
      .select("id, teacher_id, title, kind, created_at")
      .in("class_id", classIds),
    supabase
      .from("class_meetings")
      .select("id, teacher_id, created_at, classes(name)")
      .in("class_id", classIds),
  ]);

  const events: TeacherActivityEvent[] = [];

  for (const m of materials ?? []) {
    if (!m.teacher_id) continue;
    events.push({
      id: `mat-${m.id}`,
      teacherId: m.teacher_id,
      kind: "materi",
      title: m.title,
      timestamp: m.created_at,
    });
  }

  for (const a of assignments ?? []) {
    if (!a.teacher_id) continue;
    events.push({
      id: `asg-${a.id}`,
      teacherId: a.teacher_id,
      kind: a.kind === "quiz" ? "kuis" : "tugas",
      title: a.title,
      timestamp: a.created_at,
    });
  }

  for (const mt of meetings ?? []) {
    if (!mt.teacher_id) continue;
    const className = (mt.classes as unknown as { name: string } | null)?.name ?? "-";
    events.push({
      id: `mtg-${mt.id}`,
      teacherId: mt.teacher_id,
      kind: "presensi",
      title: className,
      timestamp: mt.created_at,
    });
  }

  return {
    teachers: (teacherProfiles ?? []).map((t) => ({ id: t.id, name: t.full_name })),
    events,
  };
}

export interface TeacherMaterialItem {
  id: string;
  classId: string;
  subjectId: string;
  title: string;
  createdAt: string;
}

export interface TeacherAssignmentItem {
  id: string;
  classId: string;
  subjectId: string;
  title: string;
  dueAt: string | null;
  createdAt: string;
}

export interface TeacherMeetingItem {
  id: string;
  classId: string;
  subjectId: string;
  meetingDate: string;
}

export interface TeacherClassSubjectRow {
  classId: string;
  gradeLevel: number;
  subjectId: string;
  subjectName: string;
  materiCount: number;
  tugasCount: number;
  kuisCount: number;
  presensiCount: number;
}

export interface TeacherDetailData {
  id: string;
  name: string;
  avatar: string | null;
  subjectCount: number;
  classCount: number;
  semesterActivityTotal: number;
  materialsUploaded: number;
  assignmentsCreated: number;
  quizzesCreated: number;
  attendanceFilled: number;
  classSubjectRows: TeacherClassSubjectRow[];
  materialItems: TeacherMaterialItem[];
  tugasItems: TeacherAssignmentItem[];
  kuisItems: TeacherAssignmentItem[];
  meetingItems: TeacherMeetingItem[];
}

export async function getTeacherDetail(teacherId: string): Promise<TeacherDetailData | null> {
  const supabase = await createClient();

  const classIds = await getActiveClassIds();

  const [
    { data: teacher },
    { data: cts },
    { data: materials },
    { data: assignments },
    { data: meetings },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, avatar_emoji")
      .eq("id", teacherId)
      .eq("role", "teacher")
      .maybeSingle(),
    supabase
      .from("class_teacher_subjects")
      .select("class_id, subject_id, classes(grade_level), subjects(name)")
      .eq("teacher_id", teacherId)
      .in("class_id", classIds),
    supabase
      .from("materials")
      .select("id, class_id, subject_id, title, created_at")
      .eq("teacher_id", teacherId)
      .in("class_id", classIds),
    supabase
      .from("assignments")
      .select("id, class_id, subject_id, title, kind, due_at, created_at")
      .eq("teacher_id", teacherId)
      .in("class_id", classIds),
    supabase
      .from("class_meetings")
      .select("id, class_id, subject_id, meeting_date, created_at")
      .eq("teacher_id", teacherId)
      .in("class_id", classIds),
  ]);

  if (!teacher) return null;

  const subjectCount = new Set((cts ?? []).map((c) => c.subject_id)).size;
  const classCount = new Set((cts ?? []).map((c) => c.class_id)).size;

  const materialItems: TeacherMaterialItem[] = (materials ?? []).map((m) => ({
    id: m.id,
    classId: m.class_id,
    subjectId: m.subject_id,
    title: m.title,
    createdAt: m.created_at,
  }));

  const tugasItems: TeacherAssignmentItem[] = [];
  const kuisItems: TeacherAssignmentItem[] = [];
  for (const a of assignments ?? []) {
    const item: TeacherAssignmentItem = {
      id: a.id,
      classId: a.class_id,
      subjectId: a.subject_id,
      title: a.title,
      dueAt: a.due_at,
      createdAt: a.created_at,
    };
    if (a.kind === "quiz") kuisItems.push(item);
    else tugasItems.push(item);
  }

  const meetingItems: TeacherMeetingItem[] = (meetings ?? []).map((m) => ({
    id: m.id,
    classId: m.class_id,
    subjectId: m.subject_id,
    meetingDate: m.meeting_date,
  }));

  const classSubjectRows: TeacherClassSubjectRow[] = (cts ?? [])
    .map((c) => {
      const gradeLevel = (c.classes as unknown as { grade_level: number } | null)?.grade_level ?? 0;
      const subjectName = (c.subjects as unknown as { name: string } | null)?.name ?? "-";
      return {
        classId: c.class_id,
        gradeLevel,
        subjectId: c.subject_id,
        subjectName,
        materiCount: materialItems.filter(
          (m) => m.classId === c.class_id && m.subjectId === c.subject_id,
        ).length,
        tugasCount: tugasItems.filter(
          (t) => t.classId === c.class_id && t.subjectId === c.subject_id,
        ).length,
        kuisCount: kuisItems.filter((k) => k.classId === c.class_id && k.subjectId === c.subject_id)
          .length,
        presensiCount: meetingItems.filter(
          (p) => p.classId === c.class_id && p.subjectId === c.subject_id,
        ).length,
      };
    })
    .sort((a, b) => a.gradeLevel - b.gradeLevel || a.subjectName.localeCompare(b.subjectName));

  const materialsUploaded = materialItems.length;
  const assignmentsCreated = tugasItems.length;
  const quizzesCreated = kuisItems.length;
  const attendanceFilled = meetingItems.length;

  return {
    id: teacher.id,
    name: teacher.full_name,
    avatar: teacher.avatar_emoji,
    subjectCount,
    classCount,
    semesterActivityTotal:
      materialsUploaded + assignmentsCreated + quizzesCreated + attendanceFilled,
    materialsUploaded,
    assignmentsCreated,
    quizzesCreated,
    attendanceFilled,
    classSubjectRows,
    materialItems,
    tugasItems,
    kuisItems,
    meetingItems,
  };
}
