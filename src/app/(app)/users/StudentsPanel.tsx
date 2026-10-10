"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AcademicClassSelector,
  type AcademicClassOption,
  type AcademicYearOption,
} from "@/components/AcademicClassSelector";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { createStudent, updateStudent, deleteStudent } from "./actions";
import { useAdminFilters } from "@/hooks/use-admin-filters";

type Student = {
  id: string;
  name: string;
  nisn: string | null;
  classId: string | null;
  className: string | null;
};
type ClassOption = AcademicClassOption & { label: string };

export function StudentsPanel({
  students,
  classes,
  years,
}: {
  students: Student[];
  classes: ClassOption[];
  years: AcademicYearOption[];
}) {
  const { params, setFilters } = useAdminFilters();
  const selectedYearId = params.get("year") ?? "";
  const yearId = years.some((year) => year.id === selectedYearId)
    ? selectedYearId
    : (years[0]?.id ?? "");
  const availableClasses = classes.filter((c) => c.academicYearId === yearId);
  const selectedClassId = params.get("class");
  const classId =
    availableClasses.find((c) => c.id === selectedClassId)?.id ?? availableClasses[0]?.id ?? "";
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const unplacedOnly = params.get("placement") === "unplaced";
  const unplacedCount = students.filter((student) => !student.classId).length;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [formYearId, setFormYearId] = useState(yearId);
  // A null selection means the period changed and a destination class must be chosen.
  const [formClassId, setFormClassId] = useState<string | null>(classId);
  const [isPending, startTransition] = useTransition();
  const classLabels = useMemo(() => new Map(classes.map((c) => [c.id, c.label])), [classes]);

  const rows = useMemo(() => {
    const candidates = unplacedOnly ? students.filter((s) => !s.classId) : students;
    if (searching) {
      const q = query.trim().toLowerCase();
      return candidates.filter(
        (s) => s.name.toLowerCase().includes(q) || (s.nisn ?? "").toLowerCase().includes(q),
      );
    }
    return unplacedOnly ? candidates : candidates.filter((s) => s.classId === classId);
  }, [students, classId, query, searching, unplacedOnly]);

  function openAdd() {
    setEditing(null);
    setFormYearId(yearId);
    setFormClassId(unplacedOnly ? "" : classId);
    setOpen(true);
  }

  function openEdit(s: Student) {
    setEditing(s);
    setFormYearId(classes.find((c) => c.id === s.classId)?.academicYearId ?? yearId);
    setFormClassId(s.classId ?? "");
    setOpen(true);
  }

  function handleSubmit(formData: FormData) {
    if (
      formClassId === null ||
      (formClassId && !classes.some((c) => c.id === formClassId && c.academicYearId === formYearId))
    ) {
      toast.error("Pilih kelas pada tahun ajaran/semester yang dipilih terlebih dahulu.");
      return;
    }
    startTransition(async () => {
      try {
        const result = editing ? await updateStudent(formData) : await createStudent(formData);
        if (result.ok) {
          toast.success(result.message);
          setOpen(false);
        } else {
          toast.error(result.message);
        }
      } catch {
        toast.error(
          "Hasil penyimpanan belum dapat dipastikan. Periksa data sebelum mencoba kembali.",
        );
      }
    });
  }

  function handleDelete() {
    if (!editing) return;
    const id = editing.id;
    startTransition(async () => {
      const result = await deleteStudent(id);
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Dialog
          open={open}
          onOpenChange={(v) => {
            if (isPending) return;
            setOpen(v);
            if (!v) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button className="rounded-none" onClick={openAdd}>
              + Tambah Siswa
            </Button>
          </DialogTrigger>
          <DialogContent dismissOnOverlayOnly>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Siswa" : "Tambah Siswa"}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!isPending) handleSubmit(new FormData(event.currentTarget));
              }}
              className="space-y-3"
            >
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <input type="hidden" name="class_id" value={formClassId ?? ""} />
              <div>
                <Label>Nama</Label>
                <Input name="name" defaultValue={editing?.name ?? ""} className="mt-1" required />
              </div>
              <div>
                <Label>NISN</Label>
                <Input
                  name="nisn"
                  defaultValue={editing?.nisn ?? ""}
                  className="mt-1"
                  placeholder="Dipakai sebagai username & password awal"
                  required
                />
              </div>
              <AcademicClassSelector
                years={years}
                classes={classes}
                yearId={formYearId}
                classId={formClassId ?? ""}
                onYearChange={(nextYearId) => {
                  setFormYearId(nextYearId);
                  setFormClassId(null);
                }}
                onClassChange={setFormClassId}
                disabled={isPending}
              />
              {formClassId === null && (
                <p className="text-xs text-muted-foreground">
                  {classes.some((c) => c.academicYearId === formYearId)
                    ? "Pilih kelas tujuan sebelum menyimpan perubahan."
                    : "Belum ada kelas pada periode ini. Tambahkan kelas melalui Struktur Akademik terlebih dahulu."}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  className="flex-1 rounded-none"
                  disabled={isPending || formClassId === null}
                >
                  {isPending ? "Menyimpan..." : "Simpan"}
                </Button>
                {editing && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        className="rounded-none"
                        disabled={isPending}
                      >
                        Hapus
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Hapus akun {editing.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Aksi ini tidak bisa dibatalkan. Siswa hanya bisa dihapus jika belum punya
                          tugas dikumpulkan atau nilai.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Hapus</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </form>
          </DialogContent>
        </Dialog>
        {/* <Button variant="outline" className="rounded-none">
          <Upload className="mr-2 h-4 w-4" /> Import Excel
        </Button> */}
        <div className="flex w-full flex-wrap items-end gap-3 sm:ml-auto sm:w-auto">
          {!unplacedOnly && (
            <AcademicClassSelector
              years={years}
              classes={classes}
              yearId={yearId}
              classId={classId}
              onYearChange={(nextYearId) => {
                setFilters({
                  year: nextYearId,
                  class: classes.find((c) => c.academicYearId === nextYearId)?.id ?? null,
                });
              }}
              onClassChange={(nextClassId) => setFilters({ year: yearId, class: nextClassId })}
              disabled={isPending}
              className="w-full sm:w-[440px]"
            />
          )}
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama/NISN..."
              aria-label="Cari siswa berdasarkan nama atau NISN"
              className="w-full rounded-none pl-9"
            />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Tampilan daftar siswa">
        <Button
          type="button"
          size="sm"
          variant={unplacedOnly ? "outline" : "secondary"}
          aria-pressed={!unplacedOnly}
          disabled={isPending}
          onClick={() => setFilters({ placement: null })}
        >
          Per Kelas
        </Button>
        <Button
          type="button"
          size="sm"
          variant={unplacedOnly ? "secondary" : "outline"}
          aria-pressed={unplacedOnly}
          disabled={isPending}
          onClick={() => setFilters({ placement: "unplaced" })}
        >
          Belum memiliki kelas ({unplacedCount})
        </Button>
      </div>
      {unplacedOnly && (
        <p className="text-xs text-muted-foreground">
          Siswa tanpa kelas dari semua periode. Klik Edit untuk menentukan penempatan kelas.
        </p>
      )}
      {searching && !unplacedOnly && (
        <p className="text-xs text-muted-foreground">
          Menampilkan hasil pencarian dari semua tahun ajaran dan kelas.
        </p>
      )}
      <div className="overflow-x-auto rounded-2none border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Nama</th>
              <th className="px-4 py-3">NISN</th>
              {searching && <th className="px-4 py-3">Kelas</th>}
              <th className="px-4 py-3">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-muted/30">
                <td className="px-4 py-3">{s.name}</td>
                <td className="px-4 py-3">{s.nisn ?? "-"}</td>
                {searching && (
                  <td className="px-4 py-3">
                    {classLabels.get(s.classId ?? "") ?? s.className ?? "-"}
                  </td>
                )}
                <td className="px-4 py-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-lg"
                    onClick={() => openEdit(s)}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={searching ? 4 : 3}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  {unplacedOnly && !searching
                    ? "Semua siswa sudah memiliki kelas."
                    : searching
                      ? "Tidak ditemukan."
                      : !yearId
                        ? "Belum ada tahun ajaran. Tambahkan melalui Struktur Akademik terlebih dahulu."
                        : !classId
                          ? "Belum ada kelas pada periode ini. Tambahkan melalui Struktur Akademik terlebih dahulu."
                          : "Belum ada siswa di kelas ini."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
