"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ExpandRegion } from "@/components/ExpandRegion";
import { ChevronDown, FileText, Camera, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReviewAssignmentRow, StudentSubmissionRow } from "@/lib/data/review";
import { GradeSplitDialog } from "./GradeSplitDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAssignmentTime } from "@/lib/assignmentConstants";

const TABLE_STATUS_LABEL: Record<string, string> = {
  belum: "Belum Kumpul",
  dikerjakan: "Belum Kumpul",
  submitted: "Belum Diperiksa",
  graded: "Sudah Dinilai",
};

const STATUS_STYLE: Record<string, string> = {
  belum: "bg-muted text-muted-foreground",
  dikerjakan: "bg-muted text-muted-foreground",
  submitted: "bg-warning/15 text-warning",
  graded: "bg-primary-soft/60 text-primary",
};

export function ReviewTugasTab({
  assignments,
  submissionsByAssignmentId,
}: {
  assignments: ReviewAssignmentRow[];
  submissionsByAssignmentId: Record<string, StudentSubmissionRow[]>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="@container space-y-3">
      <h2 className="font-display text-base font-bold @sm:text-lg @md:text-xl">Daftar Tugas</h2>
      <Card className="border-0 bg-transparent p-0 shadow-none sm:rounded-md sm:bg-card sm:p-2 sm:shadow-soft">
        <div className="space-y-1">
          {assignments.map((a) => (
            <AssignmentReviewRow
              key={a.id}
              assignment={a}
              students={submissionsByAssignmentId[a.id] ?? []}
              expanded={expandedId === a.id}
              onToggle={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
            />
          ))}
          {assignments.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              Belum ada tugas untuk kelas & mapel ini.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function AssignmentReviewRow({
  assignment,
  students,
  expanded,
  onToggle,
}: {
  assignment: ReviewAssignmentRow;
  students: StudentSubmissionRow[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon =
    assignment.allowedMethods.length > 1
      ? FileText
      : assignment.allowedMethods[0] === "photo"
        ? Camera
        : Type;
  const methodLabel = assignment.allowedMethods
    .map((method) => (method === "photo" ? "Foto" : "Teks"))
    .join(" atau ");
  const [filter, setFilter] = useState("all");
  const filteredStudents = students.filter(
    (student) =>
      filter === "all" ||
      (filter === "belum"
        ? !["submitted", "graded"].includes(student.status)
        : student.status === filter),
  );
  const isOverdue = assignment.dueAt ? new Date(assignment.dueAt) < new Date() : false;

  return (
    <div className="@container rounded-md border bg-card shadow-soft sm:shadow-none">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 p-2.5 text-left hover:bg-muted/40 sm:gap-2 sm:p-3"
      >
        <div className="hidden h-9 w-9 shrink-0 place-items-center rounded-md bg-primary-soft/50 sm:grid">
          <Icon className="h-4 w-4" />
        </div>
        <div
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-semibold",
            expanded && "overflow-visible text-clip whitespace-normal",
          )}
        >
          {assignment.title}
        </div>
        <span
          className={cn(
            "hidden shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs",
            expanded ? "sm:hidden" : "sm:inline-block",
          )}
        >
          {methodLabel}
        </span>
        <span
          className={cn(
            "flex shrink-0 flex-col items-center rounded-md bg-muted px-1.5 py-0.5 text-center text-[10px] font-medium leading-tight sm:hidden",
            expanded && "hidden",
          )}
        >
          <span>
            {assignment.gradedCount}/{assignment.totalStudents}
          </span>
          <span>nilai</span>
        </span>
        <span
          className={cn(
            "hidden shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs",
            expanded ? "sm:hidden" : "sm:inline-block",
          )}
        >
          {assignment.gradedCount}/{assignment.totalStudents} dinilai
        </span>
        <span
          className={cn(
            "flex shrink-0 flex-col items-center rounded-md bg-muted px-1.5 py-0.5 text-center text-[10px] font-medium leading-tight sm:hidden",
            expanded && "hidden",
          )}
        >
          <span>
            {assignment.submittedCount}/{assignment.totalStudents}
          </span>
          <span>kumpul</span>
        </span>
        <span
          className={cn(
            "hidden shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs",
            expanded ? "sm:hidden" : "sm:inline-block",
          )}
        >
          {assignment.submittedCount}/{assignment.totalStudents} mengumpulkan
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      <ExpandRegion expanded={expanded}>
        <div className="space-y-3 border-t p-2.5 sm:p-3">
          {/* Mobile detail block */}
          <div className="space-y-1.5 sm:hidden">
            <div className="text-sm font-semibold">{assignment.title}</div>
            <div className="text-xs text-muted-foreground">
              TP: {assignment.learningObjectiveTitle ?? "-"}
            </div>
            {assignment.description ? (
              <div
                className="rich-text-content line-clamp-2 text-xs text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: assignment.description }}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Tidak ada instruksi tambahan.</p>
            )}
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-xs font-medium",
                  isOverdue ? "bg-muted text-muted-foreground" : "bg-primary-soft/60 text-primary",
                )}
              >
                {isOverdue ? "Tenggat berakhir" : "Pengumpulan dibuka"}
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{methodLabel}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                {assignment.gradedCount}/{assignment.totalStudents} dinilai
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                {assignment.submittedCount}/{assignment.totalStudents} mengumpulkan
              </span>
            </div>
          </div>

          {/* Desktop detail block */}
          <div className="hidden space-y-1.5 sm:block">
            <div className="text-xs text-muted-foreground">
              TP: {assignment.learningObjectiveTitle ?? "-"}
            </div>
            {assignment.description ? (
              <div
                className="rich-text-content line-clamp-2 text-xs text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: assignment.description }}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Tidak ada instruksi tambahan.</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-xs font-medium",
                  isOverdue ? "bg-muted text-muted-foreground" : "bg-primary-soft/60 text-primary",
                )}
              >
                {isOverdue ? "Tenggat berakhir" : "Pengumpulan dibuka"}
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{methodLabel}</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                {assignment.gradedCount}/{assignment.totalStudents} dinilai
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                {assignment.submittedCount}/{assignment.totalStudents} mengumpulkan
              </span>
            </div>
          </div>

          {/* Student table (mobile + desktop, same column rules) */}
          <div className="border-t pt-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Tenggat: {formatAssignmentTime(assignment.dueAt)}
              </p>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-full sm:w-52" aria-label="Filter status pengumpulan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua siswa</SelectItem>
                  <SelectItem value="belum">Belum Mengumpulkan</SelectItem>
                  <SelectItem value="submitted">Belum Dinilai</SelectItem>
                  <SelectItem value="graded">Sudah Dinilai</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-120 table-fixed text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="border-r p-2 text-left">Nama</th>
                    <th className="w-20 border-r p-2 text-left">Nilai</th>
                    <th className="w-32 border-r p-2 text-left">Status</th>
                    <th className="w-24 p-2 text-left">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => (
                    <tr key={s.studentId} className="border-b last:border-0">
                      <td className="truncate border-r p-2 font-medium">{s.studentName}</td>
                      <td className="border-r p-2 text-muted-foreground">{s.score ?? "-"}</td>
                      <td className="border-r p-2">
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 text-xs font-medium",
                            STATUS_STYLE[s.status],
                          )}
                        >
                          {TABLE_STATUS_LABEL[s.status] ?? s.status}
                        </span>
                      </td>
                      <td className="p-2">
                        <GradeSplitDialog
                          assignmentTitle={assignment.title}
                          student={s}
                          disabled={!s.submissionId || !["submitted", "graded"].includes(s.status)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredStudents.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  {students.length
                    ? "Tidak ada siswa dengan status ini."
                    : "Belum ada siswa di kelas ini."}
                </p>
              )}
            </div>
          </div>
        </div>
      </ExpandRegion>
    </div>
  );
}
