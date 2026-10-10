"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AcademicReadiness } from "@/lib/academic-readiness";
import { getAcademicYearReadiness } from "./readiness-actions";
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
  createAcademicYear,
  setActiveAcademicYear,
  deactivateAcademicYear,
  deleteAcademicYear,
} from "../actions";

type YearRow = { id: string; year_label: string; semester: string; is_active: boolean };

export function YearsManager({
  years,
  classes,
}: {
  years: YearRow[];
  classes: { id: string; name: string; academic_year_id: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const activeYear = years.find((year) => year.is_active);
  const readinessRequest = useRef(0);
  const [readiness, setReadiness] = useState<{
    yearId: string;
    summary: AcademicReadiness | null;
    error: string | null;
  } | null>(null);

  function classLinks(names: string[], yearId: string) {
    return names.map((name, index) => {
      const classroom = classes.find((c) => c.name === name && c.academic_year_id === yearId);
      const params = new URLSearchParams({ year: yearId });
      if (classroom) params.set("class", classroom.id);
      return (
        <span key={name}>
          {index > 0 ? ", " : ""}
          <Link
            className="font-medium underline underline-offset-2"
            href={`/master-kelas?${params}`}
          >
            {name}
          </Link>
        </span>
      );
    });
  }

  async function loadReadiness(yearId: string) {
    const request = ++readinessRequest.current;
    setReadiness({ yearId, summary: null, error: null });
    try {
      const result = await getAcademicYearReadiness(yearId);
      if (request !== readinessRequest.current) return;
      setReadiness({
        yearId,
        summary: result.ok ? result.summary : null,
        error: result.ok ? null : result.message,
      });
    } catch {
      if (request === readinessRequest.current) {
        setReadiness({ yearId, summary: null, error: "Ringkasan belum dapat dimuat. Coba lagi." });
      }
    }
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createAcademicYear(formData);
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleActivation(id: string, activate: boolean) {
    setActivatingId(id);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("id", id);
        const result = await (activate ? setActiveAcademicYear : deactivateAcademicYear)(formData);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      } catch {
        toast.error("Status tahun ajaran gagal diubah. Coba lagi.");
      } finally {
        setActivatingId(null);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteAcademicYear(id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <Card className="rounded-none border-0 p-4 shadow-soft sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">Tahun Ajaran</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nonaktifkan periode yang selesai, siapkan semester berikutnya, lalu aktifkan untuk
            membuka akses kembali.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="shrink-0 rounded-none">
              + Tambah Tahun Ajaran
            </Button>
          </DialogTrigger>
          <DialogContent dismissOnOverlayOnly>
            <DialogHeader>
              <DialogTitle>Tambah Tahun Ajaran</DialogTitle>
            </DialogHeader>
            <form action={handleSubmit} className="space-y-3">
              <div>
                <Label htmlFor="academic-year-label">Tahun Ajaran</Label>
                <Input
                  id="academic-year-label"
                  name="year_label"
                  placeholder="2026/2027"
                  className="mt-1"
                  required
                />
              </div>
              <div>
                <Label htmlFor="academic-year-semester">Semester</Label>
                <Select name="semester" defaultValue="ganjil" required>
                  <SelectTrigger id="academic-year-semester" className="mt-1">
                    <SelectValue placeholder="Pilih semester" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ganjil">Ganjil</SelectItem>
                    <SelectItem value="genap">Genap</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="rounded-none bg-muted/50 p-3 text-sm text-muted-foreground">
                Tahun ajaran ini belum aktif setelah disimpan. Gunakan tombol Jadikan Aktif saat
                siap digunakan.
              </p>
              <Button type="submit" className="w-full rounded-none" disabled={isPending}>
                {isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="mt-4 rounded-none border border-dashed p-3 text-sm">
        <p className="font-medium">
          {activeYear
            ? "Pembelajaran sedang dibuka"
            : "Masa administrasi — akses pembelajaran ditutup"}
        </p>
        <p className="mt-1 text-muted-foreground">
          {activeYear
            ? "Untuk pergantian semester, nonaktifkan tahun ajaran aktif sebelum memindahkan siswa dan menyiapkan penugasan guru."
            : "Admin tetap dapat mengelola kelas, penempatan siswa, dan penugasan guru. Murid, Guru, dan Kepsek melihat pemberitahuan administrasi sampai periode diaktifkan."}
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {years.map((y) => (
          <Card
            key={y.id}
            className={`relative flex flex-col items-start rounded-none p-4 ${y.is_active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background shadow-none"}`}
          >
            {!y.is_active && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    className="absolute right-3 top-3 text-muted-foreground hover:text-destructive"
                    aria-label={`Hapus tahun ajaran ${y.year_label} semester ${y.semester}`}
                    disabled={isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Hapus tahun ajaran {y.year_label} — {y.semester}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Aksi ini tidak bisa dibatalkan. Tahun ajaran hanya bisa dihapus jika tidak ada
                      kelas yang masih memakainya.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleDelete(y.id)}>Hapus</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <div className="pr-6 font-display text-xl font-bold">{y.year_label}</div>
            <div className="mt-1 text-sm capitalize opacity-90">Semester {y.semester}</div>
            <div
              className={`mt-2 inline-flex rounded-none px-2 py-0.5 text-xs font-medium ${y.is_active ? "bg-white/20" : "bg-muted text-muted-foreground"}`}
            >
              {y.is_active ? "Aktif" : "Belum Aktif"}
            </div>
            {y.is_active && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-4 h-auto w-full whitespace-normal rounded-none py-2"
                    disabled={isPending}
                  >
                    {activatingId === y.id ? "Menonaktifkan..." : "Nonaktifkan Tahun Ajaran"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Nonaktifkan Tahun Ajaran {y.year_label} — Semester{" "}
                      {y.semester === "ganjil" ? "Ganjil" : "Genap"}?
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-3">
                        <p>
                          Akses pembelajaran Murid dan Guru serta monitoring Kepsek akan ditutup
                          sementara untuk administrasi pergantian semester.
                        </p>
                        <p>
                          Admin tetap dapat mengelola kelas, penempatan siswa, dan penugasan guru.
                          Seluruh data lama tetap tersimpan.
                        </p>
                        <p>
                          Perubahan penempatan langsung tersimpan. Mengaktifkan kembali periode lama
                          tidak membatalkan pemindahan yang sudah dilakukan.
                        </p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isPending}
                      onClick={() => handleActivation(y.id, false)}
                    >
                      Nonaktifkan Tahun Ajaran
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {!y.is_active && (
              <AlertDialog
                onOpenChange={(value) => {
                  if (value) void loadReadiness(y.id);
                  else readinessRequest.current += 1;
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-4 rounded-none"
                    disabled={isPending || Boolean(activeYear)}
                    title={
                      activeYear ? "Nonaktifkan tahun ajaran aktif terlebih dahulu." : undefined
                    }
                    aria-label={`Jadikan aktif tahun ajaran ${y.year_label} semester ${y.semester}`}
                  >
                    {activatingId === y.id ? "Mengaktifkan..." : "Jadikan Aktif"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Aktifkan Tahun Ajaran {y.year_label} — Semester{" "}
                      {y.semester === "ganjil" ? "Ganjil" : "Genap"}?
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-3">
                        <p>
                          Tahun ajaran ini akan menjadi tahun ajaran utama sekolah. Akses Murid,
                          Guru, dan Kepsek akan dibuka kembali.
                        </p>
                        {activeYear && (
                          <p>
                            Tahun ajaran aktif saat ini:{" "}
                            <strong>
                              {activeYear.year_label} — Semester{" "}
                              {activeYear.semester === "ganjil" ? "Ganjil" : "Genap"}
                            </strong>
                            .
                          </p>
                        )}
                        <p>
                          Pastikan kelas, penempatan siswa, serta penugasan guru telah disiapkan
                          dengan benar.
                        </p>
                        {readiness?.yearId === y.id && readiness.summary ? (
                          <div className="space-y-2 border bg-muted/30 p-3">
                            <p className="font-semibold text-foreground">
                              Pemeriksaan sebelum aktivasi
                            </p>
                            <p>
                              {readiness.summary.classCount} kelas ·{" "}
                              {readiness.summary.studentCount} siswa ditempatkan pada periode ini.
                            </p>
                            {readiness.summary.classCount === 0 && (
                              <p>Belum ada kelas pada periode ini.</p>
                            )}
                            {readiness.summary.emptyClasses.length > 0 && (
                              <p>
                                Kelas belum memiliki siswa:{" "}
                                {classLinks(readiness.summary.emptyClasses, y.id)}.
                              </p>
                            )}
                            <p>
                              <Link
                                href="/users?tab=siswa&placement=unplaced"
                                className="underline underline-offset-2"
                              >
                                {readiness.summary.unplacedStudents} siswa belum memiliki kelas
                              </Link>
                              ; {readiness.summary.otherPeriodStudents} siswa berada di periode
                              lain.
                            </p>
                            {readiness.summary.missingAssignments > 0 ? (
                              <p>
                                {readiness.summary.missingAssignments} penugasan guru-mapel belum
                                terisi di kelas{" "}
                                {classLinks(readiness.summary.classesMissingTeachers, y.id)}.
                                Periksa melalui Master Kelas.
                              </p>
                            ) : readiness.summary.classCount > 0 ? (
                              <p>
                                Tidak ditemukan kekurangan penugasan guru untuk mapel yang terdaftar
                                dan berlaku pada tingkat kelas periode ini.
                              </p>
                            ) : null}
                            <p className="text-xs">
                              Siswa di periode lain tidak selalu perlu dipindahkan, misalnya lulusan
                              atau siswa periode berikutnya. Ringkasan ini untuk pemeriksaan admin
                              dan tidak menghalangi aktivasi.
                            </p>
                          </div>
                        ) : readiness?.yearId === y.id && readiness.error ? (
                          <div role="status" className="space-y-2 border p-3">
                            <p>{readiness.error}</p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void loadReadiness(y.id)}
                            >
                              Muat Ulang Ringkasan
                            </Button>
                          </div>
                        ) : (
                          <p role="status">Memuat ringkasan kesiapan...</p>
                        )}
                        <p>Tahun ajaran sebelumnya tetap tersimpan sebagai data lama.</p>
                        <p>Aktivasi tidak memindahkan siswa atau menyalin penugasan guru.</p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isPending || readiness?.yearId !== y.id || !readiness.summary}
                      onClick={() => handleActivation(y.id, true)}
                    >
                      Aktifkan Tahun Ajaran
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </Card>
        ))}
        {years.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada tahun ajaran.</p>
        )}
      </div>
    </Card>
  );
}
