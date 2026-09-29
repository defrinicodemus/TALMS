"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { promoteClasses } from "../actions";

type ClassRow = {
  id: string;
  name: string;
  grade_level: number;
  academic_year_id: string;
};
type YearRow = { id: string; year_label: string; semester: string; is_active: boolean };
type StudentRow = {
  id: string;
  full_name: string | null;
  nisn: string | null;
  class_id: string | null;
};

const NONE = "__none__";

export function PromoteClassesPanel({
  classes,
  years,
  students,
}: {
  classes: ClassRow[];
  years: YearRow[];
  students: StudentRow[];
}) {
  const [open, setOpen] = useState(false);
  const activeYear = years.find((y) => y.is_active) ?? years[0];
  const [sourceYearId, setSourceYearId] = useState(activeYear?.id ?? "");
  const [targetYearId, setTargetYearId] = useState("");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [excludedStudentIds, setExcludedStudentIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const sourceClasses = useMemo(
    () =>
      classes
        .filter((c) => c.academic_year_id === sourceYearId && c.grade_level <= 5)
        .sort((a, b) => a.grade_level - b.grade_level || a.name.localeCompare(b.name)),
    [classes, sourceYearId],
  );
  const targetClasses = useMemo(
    () =>
      classes
        .filter((c) => c.academic_year_id === targetYearId)
        .sort((a, b) => a.grade_level - b.grade_level || a.name.localeCompare(b.name)),
    [classes, targetYearId],
  );
  const studentsByClass = useMemo(() => {
    const grouped = new Map<string, StudentRow[]>();
    for (const student of students) {
      if (!student.class_id) continue;
      const classStudents = grouped.get(student.class_id) ?? [];
      classStudents.push(student);
      grouped.set(student.class_id, classStudents);
    }
    return grouped;
  }, [students]);

  const usedTargets = new Set(Object.values(mappings).filter(Boolean));
  const selectedCount = Object.values(mappings).filter(Boolean).length;
  const excludedIds = useMemo(() => new Set(excludedStudentIds), [excludedStudentIds]);
  const selectedStudentCount = sourceClasses.reduce((count, sourceClass) => {
    if (!mappings[sourceClass.id]) return count;
    const classStudents = studentsByClass.get(sourceClass.id) ?? [];
    return count + classStudents.filter((student) => !excludedIds.has(student.id)).length;
  }, 0);

  function handleYearChange(kind: "source" | "target", value: string) {
    setMappings({});
    setExcludedStudentIds([]);
    if (kind === "source") setSourceYearId(value);
    else setTargetYearId(value);
  }

  function handleConfirm() {
    const payload = Object.entries(mappings)
      .filter(([, targetClassId]) => Boolean(targetClassId))
      .map(([sourceClassId, targetClassId]) => ({
        sourceClassId,
        targetClassId,
        studentIds: (studentsByClass.get(sourceClassId) ?? [])
          .filter((student) => !excludedIds.has(student.id))
          .map((student) => student.id),
      }));

    startTransition(async () => {
      const result = await promoteClasses(payload);
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
        setMappings({});
        setExcludedStudentIds([]);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleMappingChange(sourceClassId: string, targetClassId: string) {
    setMappings((current) => ({
      ...current,
      [sourceClassId]: targetClassId === NONE ? "" : targetClassId,
    }));
  }

  function setStudentChecked(studentId: string, checked: boolean) {
    setExcludedStudentIds((current) =>
      checked ? current.filter((id) => id !== studentId) : [...new Set([...current, studentId])],
    );
  }

  function setClassStudentsChecked(studentIds: string[], checked: boolean) {
    setExcludedStudentIds((current) => {
      if (checked) return current.filter((id) => !studentIds.includes(id));
      return [...new Set([...current, ...studentIds])];
    });
  }

  return (
    <Card className="rounded-none border-0 p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">Kenaikan Kelas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pindahkan siswa & penugasan guru dari tahun ajaran lama ke kelas baru.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-none">
              Naikkan Kelas
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Kenaikan Kelas</DialogTitle>
            </DialogHeader>

            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Dari Tahun Ajaran
                  </p>
                  <Select value={sourceYearId} onValueChange={(v) => handleYearChange("source", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih tahun ajaran" />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y.id} value={y.id}>
                          {y.year_label} - {y.semester}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Ke Tahun Ajaran</p>
                  <Select value={targetYearId} onValueChange={(v) => handleYearChange("target", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih tahun ajaran" />
                    </SelectTrigger>
                    <SelectContent>
                      {years
                        .filter((y) => y.id !== sourceYearId)
                        .map((y) => (
                          <SelectItem key={y.id} value={y.id}>
                            {y.year_label} - {y.semester}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {sourceYearId && targetYearId && sourceClasses.length === 0 && (
                <p className="rounded-none bg-muted/50 p-3 text-sm text-muted-foreground">
                  Tidak ada kelas 1-5 di tahun ajaran asal.
                </p>
              )}
              {sourceYearId && targetYearId && targetClasses.length === 0 && (
                <p className="rounded-none bg-muted/50 p-3 text-sm text-muted-foreground">
                  Tahun ajaran tujuan belum punya kelas. Buat dulu lewat &quot;+ Tambah Kelas&quot;
                  di atas.
                </p>
              )}

              {sourceYearId &&
                targetYearId &&
                sourceClasses.length > 0 &&
                targetClasses.length > 0 && (
                  <div className="space-y-3">
                    {sourceClasses.map((sc) => {
                      const chosen = mappings[sc.id] ?? "";
                      const classStudents = studentsByClass.get(sc.id) ?? [];
                      const classStudentIds = classStudents.map((student) => student.id);
                      const selectedClassStudents = classStudents.filter(
                        (student) => !excludedIds.has(student.id),
                      );
                      const allSelected =
                        classStudentIds.length > 0 &&
                        selectedClassStudents.length === classStudentIds.length;
                      const someSelected = selectedClassStudents.length > 0;

                      return (
                        <div key={sc.id} className="rounded-none bg-muted/40 p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <div className="flex-1 text-sm font-medium">
                              {sc.name}{" "}
                              <span className="text-xs font-normal text-muted-foreground">
                                (Tingkat {sc.grade_level})
                              </span>
                            </div>
                            <Select
                              value={chosen || NONE}
                              onValueChange={(v) => handleMappingChange(sc.id, v)}
                            >
                              <SelectTrigger className="w-full sm:w-48">
                                <SelectValue placeholder="Tidak dipindahkan" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>Tidak dipindahkan</SelectItem>
                                {targetClasses
                                  .filter((tc) => tc.id === chosen || !usedTargets.has(tc.id))
                                  .map((tc) => (
                                    <SelectItem key={tc.id} value={tc.id}>
                                      {tc.name} (Tingkat {tc.grade_level})
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="mt-3 rounded-none border bg-background/70">
                            <label className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm font-medium">
                              <Checkbox
                                checked={
                                  allSelected ? true : someSelected ? "indeterminate" : false
                                }
                                disabled={classStudentIds.length === 0}
                                onCheckedChange={(checked) =>
                                  setClassStudentsChecked(classStudentIds, checked === true)
                                }
                              />
                              <span className="flex-1">Siswa yang naik kelas</span>
                              <span className="text-xs font-normal text-muted-foreground">
                                {selectedClassStudents.length}/{classStudents.length} dipilih
                              </span>
                            </label>

                            {classStudents.length > 0 ? (
                              <div className="max-h-48 divide-y overflow-y-auto">
                                {classStudents.map((student) => {
                                  const checked = !excludedIds.has(student.id);
                                  return (
                                    <label
                                      key={student.id}
                                      className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                                    >
                                      <Checkbox
                                        checked={checked}
                                        onCheckedChange={(value) =>
                                          setStudentChecked(student.id, value === true)
                                        }
                                      />
                                      <span className="min-w-0 flex-1 truncate">
                                        {student.full_name ?? "Tanpa nama"}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        {student.nisn ?? "-"}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="px-3 py-3 text-sm text-muted-foreground">
                                Belum ada siswa di kelas ini.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

              <p className="text-xs text-muted-foreground">
                Kelas 6 tidak ditampilkan di sini - siswa kelas 6 dianggap lulus, hapus akunnya
                lewat Manajemen User setelah tahun ajaran baru aktif.
              </p>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="w-full rounded-none" disabled={selectedCount === 0 || isPending}>
                    Proses Kenaikan Kelas ({selectedStudentCount} siswa)
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Proses kenaikan kelas sekarang?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {selectedStudentCount} siswa terpilih dari {selectedCount} kelas akan
                      dipindahkan ke kelas tujuan. Siswa yang tidak dicentang tetap berada di kelas
                      asal. Aksi ini tidak bisa dibatalkan otomatis.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirm}>Proses</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Card>
  );
}
