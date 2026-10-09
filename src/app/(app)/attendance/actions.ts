"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/data/profile";
import { assertRole } from "@/lib/auth/guard";
import {
  getAttendanceRecap,
  getMeetingData,
  type AttendanceRecap,
  type AttendanceStatus,
  type MeetingData,
} from "@/lib/data/attendance";

const EMPTY_MEETING_DATA: MeetingData = {
  meetingId: null,
  meetingDate: "",
  materialTaught: "",
  learningObjectiveId: null,
  notes: "",
  students: [],
  tpOptions: [],
  lastInputAt: null,
};

export async function fetchMeetingData(
  classId: string,
  subjectId: string,
  meetingNumber: number,
): Promise<MeetingData> {
  const currentUser = await getCurrentUser();
  if (assertRole(currentUser, ["teacher"])) return EMPTY_MEETING_DATA;
  return getMeetingData(classId, subjectId, meetingNumber);
}

export async function fetchAttendanceRecap(
  classId: string,
  subjectId: string,
): Promise<AttendanceRecap> {
  const currentUser = await getCurrentUser();
  if (assertRole(currentUser, ["teacher"])) return { meetingNumbers: [], students: [] };
  return getAttendanceRecap(classId, subjectId);
}

export async function saveMeeting(
  classId: string,
  subjectId: string,
  meetingNumber: number,
  payload: {
    meetingDate: string;
    materialTaught: string;
    learningObjectiveId: string | null;
    notes: string;
    attendance: { studentId: string; status: AttendanceStatus }[];
  },
): Promise<{ ok: boolean; message: string; lastInputAt?: string }> {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "teacher") {
    return { ok: false, message: "Tidak diizinkan." };
  }

  const supabase = await createClient();

  const { data: meeting, error: meetingError } = await supabase
    .from("class_meetings")
    .upsert(
      {
        class_id: classId,
        subject_id: subjectId,
        meeting_number: meetingNumber,
        meeting_date: payload.meetingDate,
        material_taught: payload.materialTaught || null,
        learning_objective_id: payload.learningObjectiveId,
        notes: payload.notes || null,
        teacher_id: currentUser.id,
      },
      { onConflict: "class_id,subject_id,meeting_number" },
    )
    .select("id")
    .single();
  if (meetingError || !meeting) {
    return { ok: false, message: meetingError?.message ?? "Gagal menyimpan pertemuan." };
  }

  let lastInputAt: string | undefined;
  if (payload.attendance.length > 0) {
    const { data: records, error: attendanceError } = await supabase
      .from("attendance_records")
      .upsert(
        payload.attendance.map((a) => ({
          meeting_id: meeting.id,
          student_id: a.studentId,
          status: a.status,
        })),
        { onConflict: "meeting_id,student_id" },
      )
      .select("updated_at");
    if (attendanceError) return { ok: false, message: attendanceError.message };
    lastInputAt = records?.reduce<string | undefined>(
      (max, r) => (!max || r.updated_at > max ? r.updated_at : max),
      undefined,
    );
  }

  revalidatePath("/attendance");
  revalidatePath("/curriculum");
  return { ok: true, message: "Presensi dan jurnal hari ini berhasil disimpan.", lastInputAt };
}
