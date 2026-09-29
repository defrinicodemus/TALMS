"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { UserMinus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { setClassSubjectTeacher, assignStudentToClass } from "../actions";

type ClassOption = { id: string; name: string; grade_level: number };
type Subject = {
  id: string;
  name: string;
  emoji: string | null;
  min_grade: number | null;
  max_grade: number | null;
};
type Teacher = { id: string; name: string };

function appliesToGrade(gradeLevel: number, minGrade: number | null, maxGrade: number | null) {
  if (minGrade != null && gradeLevel < minGrade) return false;
  if (maxGrade != null && gradeLevel > maxGrade) return false;
  return true;
}
type Assignment = { class_id: string; subject_id: string; teacher_id: string };
type Student = {
  id: string;
  name: string;
  nisn: string | null;
  classId: string | null;
  className: string | null;
};

const NONE = "__none__";

export function MasterKelasManager({
  classes,
  subjects,
  teachers,
  assignments,
  students,
}: {
  classes: ClassOption[];
  subjects: Subject[];
  teachers: Teacher[];
  assignments: Assignment[];
  students: Student[];
}) {
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  const teacherBySubject = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignments) if (a.class_id === classId) m.set(a.subject_id, a.teacher_id);
    return m;
  }, [assignments, classId]);

  const studentsInClass = useMemo(
    () => students.filter((s) => s.classId === classId),
    [students, classId],
  );
  const studentsOutside = useMemo(
    () => students.filter((s) => s.classId !== classId),
    [students, classId],
  );
  const selectedClass = classes.find((c) => c.id === classId);
  const selectedClassName = selectedClass?.name ?? "-";
  const visibleSubjects = useMemo(() => {
    if (!selectedClass) return subjects;
    return subjects.filter((s) =>
      appliesToGrade(selectedClass.grade_level, s.min_grade, s.max_grade),
    );
  }, [subjects, selectedClass]);

  function handleTeacherChange(subjectId: string, teacherId: string) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("class_id", classId);
      formData.set("subject_id", subjectId);
      if (teacherId !== NONE) formData.set("teacher_id", teacherId);
      const result = await setClassSubjectTeacher(formData);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  function handleAddStudent(studentId: string) {
    setPickerOpen(false);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("student_id", studentId);
      formData.set("class_id", classId);
      const result = await assignStudentToClass(formData);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  function handleRemoveStudent(studentId: string) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("student_id", studentId);
      const result = await assignStudentToClass(formData);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-none border-0 p-6 shadow-soft">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Kelas:</span>
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger className="w-[200px] rounded-none">
              <SelectValue placeholder="Pilih kelas" />
            </SelectTrigger>
            <SelectContent>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {!classId ? (
        <p className="text-sm text-muted-foreground">
          Belum ada kelas. Tambahkan kelas di Struktur Akademik dulu.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="rounded-none border-0 p-6 shadow-soft">
            <h2 className="font-display text-xl font-bold">Guru & Mata Pelajaran</h2>
            <div className="mt-1 text-xs text-muted-foreground">{selectedClassName}</div>
            <div className="mt-4 space-y-2">
              {visibleSubjects.map((s) => {
                const current = teacherBySubject.get(s.id) ?? NONE;
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="text-lg">{s.emoji}</span>
                      {s.name}
                    </div>
                    <Select
                      value={current}
                      onValueChange={(v) => handleTeacherChange(s.id, v)}
                      disabled={isPending}
                    >
                      <SelectTrigger className="w-[180px] rounded-none">
                        <SelectValue placeholder="Belum ditugaskan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— Belum ditugaskan —</SelectItem>
                        {teachers.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
              {visibleSubjects.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Tidak ada mata pelajaran untuk tingkat kelas ini.
                </p>
              )}
            </div>
          </Card>

          <Card className="rounded-none border-0 p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-xl font-bold">Siswa</h2>
                <div className="mt-1 text-xs text-muted-foreground">{selectedClassName}</div>
              </div>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" className="rounded-none" disabled={isPending}>
                    + Tambah Siswa
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="end">
                  <Command>
                    <CommandInput placeholder="Cari nama siswa..." />
                    <CommandList>
                      <CommandEmpty>Tidak ditemukan.</CommandEmpty>
                      <CommandGroup>
                        {studentsOutside.map((s) => (
                          <CommandItem
                            key={s.id}
                            value={`${s.name}-${s.id}`}
                            onSelect={() => handleAddStudent(s.id)}
                          >
                            <span>{s.name}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {s.className ?? "Belum ada kelas"}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="mt-4 space-y-2">
              {studentsInClass.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-none border px-3 py-2"
                >
                  <div className="text-sm font-medium">
                    {s.name}
                    <span className="ml-2 text-xs text-muted-foreground">{s.nisn ?? "-"}</span>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="rounded-none" disabled={isPending}>
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Keluarkan {s.name} dari {selectedClassName}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Siswa akan menjadi tanpa kelas sampai ditambahkan ke kelas lain.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleRemoveStudent(s.id)}>
                          Keluarkan
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
              {studentsInClass.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada siswa di kelas ini.</p>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
