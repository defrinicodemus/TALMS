"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { createClass, updateClass, deleteClass } from "../actions";

type ClassRow = { id: string; name: string; grade_level: number; academic_year_id: string };
type YearRow = { id: string; year_label: string; semester: string; is_active: boolean };

export function ClassesManager({
  classes,
  years,
  activeYear,
}: {
  classes: ClassRow[];
  years: YearRow[];
  activeYear: YearRow | null;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [isPending, startTransition] = useTransition();
  const editingYear = years.find((year) => year.id === editing?.academic_year_id);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = editing ? await updateClass(formData) : await createClass(formData);
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleDelete() {
    if (!editing) return;
    const id = editing.id;
    startTransition(async () => {
      const result = await deleteClass(id);
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Card className="rounded-none border-0 p-4 shadow-soft sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">Kelas & Rombel</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Kelas dikelompokkan berdasarkan tahun ajaran dan semester.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="sm"
              className="shrink-0 rounded-none"
              disabled={years.length === 0}
              onClick={() => setEditing(null)}
            >
              + Tambah Kelas
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Kelas" : "Tambah Kelas"}</DialogTitle>
            </DialogHeader>
            <form action={handleSubmit} className="space-y-3">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              {editingYear && (
                <p className="rounded-none bg-muted/50 p-3 text-sm">
                  Tahun ajaran {editingYear.year_label} · Semester{" "}
                  {editingYear.semester === "ganjil" ? "Ganjil" : "Genap"}
                </p>
              )}
              <div>
                <Label>Nama Kelas</Label>
                <Input name="name" defaultValue={editing?.name ?? ""} className="mt-1" required />
              </div>
              <div>
                <Label>Tingkat</Label>
                <Input
                  name="grade_level"
                  type="number"
                  min={1}
                  max={6}
                  defaultValue={editing?.grade_level ?? 1}
                  className="mt-1"
                  required
                />
              </div>
              {!editing && (
                <div>
                  <Label>Tahun Ajaran</Label>
                  <Select name="academic_year_id" defaultValue={activeYear?.id} required>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Pilih tahun ajaran" />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y.id} value={y.id}>
                          {y.year_label} — {y.semester === "ganjil" ? "Ganjil" : "Genap"} ·{" "}
                          {y.is_active ? "Aktif" : "Belum Aktif"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" className="flex-1 rounded-none" disabled={isPending}>
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
                        <AlertDialogTitle>Hapus kelas {editing.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Aksi ini tidak bisa dibatalkan. Kelas hanya bisa dihapus jika tidak ada
                          siswa, materi, tugas, nilai, penugasan guru, atau pengumuman yang masih
                          memakainya.
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
      </div>
      <div className="mt-5 space-y-5">
        {years.map((year) => {
          const yearClasses = classes.filter((c) => c.academic_year_id === year.id);
          return (
            <section
              key={year.id}
              aria-label={`Kelas tahun ajaran ${year.year_label} semester ${year.semester}`}
              className="space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                <h3 className="text-sm font-semibold">
                  {year.year_label} · Semester {year.semester === "ganjil" ? "Ganjil" : "Genap"}
                </h3>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{yearClasses.length} kelas</span>
                  <span
                    className={`px-2 py-0.5 ${year.is_active ? "bg-primary/10 font-medium text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    {year.is_active ? "Aktif" : "Belum Aktif"}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {yearClasses.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setEditing(c);
                      setOpen(true);
                    }}
                    aria-label={`Edit kelas ${c.name}, ${year.year_label}, semester ${year.semester}`}
                    className="rounded-none bg-primary-soft/30 px-4 py-3 text-left hover:bg-primary-soft/50"
                  >
                    <span className="block text-sm font-semibold">{c.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Tingkat {c.grade_level}
                    </span>
                  </button>
                ))}
              </div>
              {yearClasses.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Belum ada kelas pada tahun ajaran ini.
                </p>
              )}
            </section>
          );
        })}
        {years.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Tambahkan tahun ajaran terlebih dahulu untuk membuat kelas.
          </p>
        )}
      </div>
      <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
        Kelola penempatan siswa dan guru-mapel di{" "}
        <Link
          href="/master-kelas"
          className="font-medium text-primary underline underline-offset-2"
        >
          Master Kelas
        </Link>
        .
      </p>
    </Card>
  );
}
