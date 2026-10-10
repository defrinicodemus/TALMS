"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import {
  academicYearStart,
  isTransferTarget,
  transferYearLabel,
  type TransferKind,
} from "@/lib/academic-transfers";
import { promoteClasses } from "../actions";

type ClassRow = { id: string; name: string; grade_level: number; academic_year_id: string };
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const activeYear = years.find((y) => y.is_active);
  const [kind, setKind] = useState<TransferKind>(
    activeYear?.semester === "genap" ? "promotion" : "semester",
  );
  const [sourceYearId, setSourceYearId] = useState("");
  const [targetYearId, setTargetYearId] = useState("");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [excludedStudentIds, setExcludedStudentIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const processLabel = kind === "semester" ? "Pergantian Semester" : "Kenaikan Kelas";

  const sourceYears = years.filter(
    (y) =>
      y.semester === (kind === "semester" ? "ganjil" : "genap") &&
      academicYearStart(y.year_label) !== null,
  );
  const sourceYear = sourceYears.find((y) => y.id === sourceYearId);
  const targetYears = sourceYear
    ? years.filter((y) => !y.is_active && isTransferTarget(sourceYear, y, kind))
    : [];
  const targetYear = targetYears.find((y) => y.id === targetYearId);
  const sourceClasses = classes
    .filter(
      (c) =>
        c.academic_year_id === sourceYear?.id &&
        c.grade_level >= 1 &&
        c.grade_level <= (kind === "semester" ? 6 : 5),
    )
    .sort((a, b) => a.grade_level - b.grade_level || a.name.localeCompare(b.name));
  const targetClasses = classes
    .filter((c) => c.academic_year_id === targetYear?.id)
    .sort((a, b) => a.grade_level - b.grade_level || a.name.localeCompare(b.name));
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
  const excludedIds = new Set(excludedStudentIds);
  const usedTargets = new Set(Object.values(mappings).filter(Boolean));
  const summaries = sourceClasses.map((sourceClass) => {
    const classStudents = studentsByClass.get(sourceClass.id) ?? [];
    const target = targetClasses.find(
      (c) =>
        c.id === mappings[sourceClass.id] &&
        c.grade_level === sourceClass.grade_level + (kind === "promotion" ? 1 : 0),
    );
    const selected = target ? classStudents.filter((s) => !excludedIds.has(s.id)) : [];
    return {
      sourceClass,
      target,
      classStudents,
      selected,
      skipped: classStudents.length - selected.length,
    };
  });
  const selectedStudentCount = summaries.reduce((n, row) => n + row.selected.length, 0);
  const skippedStudentCount = summaries.reduce((n, row) => n + row.skipped, 0);
  const canSubmit =
    !activeYear && !!sourceYear && !!targetYear && selectedStudentCount > 0 && !isPending;

  function resetMappings() {
    setMappings({});
    setExcludedStudentIds([]);
    setConfirmOpen(false);
  }

  function handleKindChange(value: TransferKind) {
    setKind(value);
    setSourceYearId("");
    setTargetYearId("");
    resetMappings();
  }

  function handleYearChange(field: "source" | "target", value: string) {
    resetMappings();
    if (field === "source") {
      setSourceYearId(value);
      setTargetYearId("");
    } else setTargetYearId(value);
  }

  function handleConfirm() {
    if (!canSubmit || !sourceYear || !targetYear) return;
    const payload = summaries
      .filter((row) => row.target && row.selected.length > 0)
      .map((row) => ({
        sourceClassId: row.sourceClass.id,
        targetClassId: row.target!.id,
        studentIds: row.selected.map((s) => s.id),
      }));
    startTransition(async () => {
      try {
        const result = await promoteClasses({
          kind,
          sourceYearId: sourceYear.id,
          targetYearId: targetYear.id,
          mappings: payload,
        });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        toast.success(result.message);
        resetMappings();
        setOpen(false);
      } catch {
        toast.error(
          "Hasil perpindahan belum dapat dipastikan. Muat ulang halaman dan periksa penempatan siswa sebelum mencoba kembali.",
        );
      }
    });
  }

  function setStudentsChecked(ids: string[], checked: boolean) {
    setExcludedStudentIds((current) =>
      checked ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])],
    );
  }

  return (
    <Card className="rounded-none border-0 p-6 shadow-soft">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-xl font-bold">Perpindahan Siswa</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pergantian semester dan kenaikan kelas. Penugasan guru dikelola melalui Master Kelas.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (isPending) return;
            setOpen(value);
            resetMappings();
            setSourceYearId("");
            setTargetYearId("");
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="sm"
              className="shrink-0 rounded-none"
              disabled={!!activeYear || isPending || !years.length}
            >
              Pindahkan Siswa
            </Button>
          </DialogTrigger>
          <DialogContent dismissOnOverlayOnly className="max-h-[85dvh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Perpindahan Siswa</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {activeYear && (
                <p role="status" className="bg-muted p-3 text-sm">
                  Nonaktifkan tahun ajaran yang sedang berjalan sebelum memproses perpindahan siswa.
                </p>
              )}
              <div className="space-y-1">
                <Label htmlFor="transfer-kind">Jenis Proses</Label>
                <Select
                  value={kind}
                  onValueChange={(value) => handleKindChange(value as TransferKind)}
                  disabled={isPending}
                >
                  <SelectTrigger id="transfer-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="semester">Pergantian Semester</SelectItem>
                    <SelectItem value="promotion">Kenaikan Kelas</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {kind === "semester"
                    ? "Ganjil ke genap dalam tahun ajaran yang sama; tingkat kelas tetap, termasuk kelas 6."
                    : "Genap ke ganjil tahun ajaran berikutnya; tingkat kelas naik satu untuk kelas 1?5."}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="transfer-source">Periode Asal</Label>
                  <Select
                    value={sourceYear?.id ?? ""}
                    onValueChange={(value) => handleYearChange("source", value)}
                    disabled={isPending || !sourceYears.length}
                  >
                    <SelectTrigger id="transfer-source">
                      <SelectValue
                        placeholder={
                          sourceYears.length ? "Pilih periode asal" : "Belum ada periode sesuai"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceYears.map((year) => (
                        <SelectItem key={year.id} value={year.id}>
                          {transferYearLabel(year)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="transfer-target">Periode Tujuan</Label>
                  <Select
                    value={targetYear?.id ?? ""}
                    onValueChange={(value) => handleYearChange("target", value)}
                    disabled={isPending || !targetYears.length}
                  >
                    <SelectTrigger id="transfer-target">
                      <SelectValue
                        placeholder={
                          !sourceYear
                            ? "Pilih periode asal dahulu"
                            : targetYears.length
                              ? "Pilih periode tujuan"
                              : "Belum ada periode sesuai"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {targetYears.map((year) => (
                        <SelectItem key={year.id} value={year.id}>
                          {transferYearLabel(year)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {years.some((year) => academicYearStart(year.year_label) === null) && (
                <p className="text-xs text-muted-foreground">
                  Periode hanya dapat diproses jika nama tahun ajarannya berurutan, misalnya
                  2026/2027.
                </p>
              )}
              {sourceYear && !targetYears.length && (
                <p className="bg-muted/50 p-3 text-sm">
                  Belum ada periode tujuan yang sesuai. Siapkan{" "}
                  {kind === "semester"
                    ? "semester genap pada tahun ajaran yang sama"
                    : "semester ganjil pada tahun ajaran berikutnya"}{" "}
                  terlebih dahulu.
                </p>
              )}
              {sourceYear && !sourceClasses.length && (
                <p className="bg-muted/50 p-3 text-sm">
                  Belum ada kelas yang dapat diproses pada periode asal.
                </p>
              )}
              {targetYear && !targetClasses.length && (
                <p className="bg-muted/50 p-3 text-sm">
                  Periode tujuan belum memiliki kelas. Buat kelas melalui Tambah Kelas terlebih
                  dahulu.
                </p>
              )}
              {targetYear &&
                summaries.map(({ sourceClass: sc, target, classStudents, selected }) => {
                  const options = targetClasses.filter(
                    (c) =>
                      c.grade_level === sc.grade_level + (kind === "promotion" ? 1 : 0) &&
                      (c.id === target?.id || !usedTargets.has(c.id)),
                  );
                  const allSelected =
                    classStudents.length > 0 && selected.length === classStudents.length;
                  return (
                    <div key={sc.id} className="space-y-3 rounded-none bg-muted/40 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="flex-1 text-sm font-medium">
                          {sc.name}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            (Tingkat {sc.grade_level})
                          </span>
                        </div>
                        <Select
                          value={target?.id ?? NONE}
                          onValueChange={(value) =>
                            setMappings((current) => ({
                              ...current,
                              [sc.id]: value === NONE ? "" : value,
                            }))
                          }
                          disabled={isPending || !classStudents.length}
                        >
                          <SelectTrigger
                            className="w-full sm:w-52"
                            aria-label={`Kelas tujuan untuk ${sc.name}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Tidak dipindahkan</SelectItem>
                            {options.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name} (Tingkat {c.grade_level})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {!options.length && (
                        <p className="text-xs text-muted-foreground">
                          Belum ada kelas tujuan tingkat{" "}
                          {sc.grade_level + (kind === "promotion" ? 1 : 0)} yang tersedia.
                        </p>
                      )}
                      <div className="border bg-background/70">
                        <label className="flex items-center gap-3 border-b px-3 py-2 text-sm font-medium">
                          <Checkbox
                            checked={allSelected ? true : selected.length ? "indeterminate" : false}
                            disabled={isPending || !target || !classStudents.length}
                            onCheckedChange={(value) =>
                              setStudentsChecked(
                                classStudents.map((s) => s.id),
                                value === true,
                              )
                            }
                          />
                          <span className="flex-1">Siswa yang dipindahkan</span>
                          <span className="text-xs text-muted-foreground">
                            {selected.length}/{classStudents.length} dipilih
                          </span>
                        </label>
                        <div className="max-h-48 divide-y overflow-y-auto">
                          {classStudents.map((student) => (
                            <label
                              key={student.id}
                              className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={!!target && !excludedIds.has(student.id)}
                                disabled={isPending || !target}
                                onCheckedChange={(value) =>
                                  setStudentsChecked([student.id], value === true)
                                }
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {student.full_name ?? "Tanpa nama"}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {student.nisn ?? "-"}
                              </span>
                            </label>
                          ))}
                        </div>
                        {!classStudents.length && (
                          <p className="p-3 text-sm text-muted-foreground">
                            Belum ada siswa di kelas ini.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              <p className="text-xs text-muted-foreground">
                Siswa yang tidak dipilih tetap di kelas periode lama dan perlu ditempatkan
                tersendiri jika mengikuti periode baru.
                {kind === "promotion" &&
                  " Kelas 6 tidak termasuk proses kenaikan kelas. Akun dan data siswa tetap tersimpan."}
              </p>
              <AlertDialog
                open={confirmOpen}
                onOpenChange={(value) => {
                  if (!isPending) setConfirmOpen(value);
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button className="w-full rounded-none" disabled={!canSubmit}>
                    Tinjau Perpindahan ({selectedStudentCount} siswa)
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Proses {processLabel.toLowerCase()} sekarang?
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-3">
                        <p>
                          {sourceYear && transferYearLabel(sourceYear)} ?{" "}
                          {targetYear && transferYearLabel(targetYear)}
                        </p>
                        <div className="overflow-x-auto border">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr>
                                <th className="p-2">Asal ? Tujuan</th>
                                <th className="p-2">Dipindahkan</th>
                                <th className="p-2">Dilewati</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summaries
                                .filter((row) => row.classStudents.length > 0)
                                .map((row) => (
                                  <tr key={row.sourceClass.id} className="border-t">
                                    <td className="p-2">
                                      {row.sourceClass.name} ? {row.target?.name ?? "Tetap di asal"}
                                    </td>
                                    <td className="p-2">{row.selected.length}</td>
                                    <td className="p-2">{row.skipped}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        <p>
                          <strong>
                            {selectedStudentCount} siswa dipindahkan; {skippedStudentCount} siswa
                            dilewati
                          </strong>{" "}
                          dari kelas asal yang ditampilkan.
                        </p>
                        <p>
                          Penempatan langsung berubah setelah diproses. Periode tujuan tetap belum
                          aktif. Siswa yang dilewati tetap berada di kelas asal.
                        </p>
                        <p>
                          Penugasan guru tetap dikelola melalui Master Kelas. Perpindahan ini tidak
                          mengubah penugasan yang sudah ada.
                        </p>
                        <p>Aksi ini tidak bisa dibatalkan otomatis.</p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={!canSubmit}
                      onClick={(event) => {
                        event.preventDefault();
                        handleConfirm();
                      }}
                    >
                      {isPending ? "Memproses..." : "Proses Perpindahan"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {activeYear && (
        <p role="status" className="mt-3 border border-dashed p-3 text-sm text-muted-foreground">
          Nonaktifkan tahun ajaran yang sedang berjalan sebelum memproses perpindahan siswa. Periode
          dan kelas tujuan tetap dapat disiapkan terlebih dahulu.
        </p>
      )}
      {!years.length && (
        <p className="mt-3 text-sm text-muted-foreground">
          Tambahkan tahun ajaran dan kelas terlebih dahulu.
        </p>
      )}
    </Card>
  );
}
