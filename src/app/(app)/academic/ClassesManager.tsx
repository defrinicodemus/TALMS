"use client";

import { useState, useTransition } from "react";
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

type ClassRow = { id: string; name: string; grade_level: number };
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
    <Card className="rounded-none border-0 p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">
            Kelas {activeYear ? `TA ${activeYear.year_label}` : ""}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Daftar kelas pada tahun ajaran aktif.
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
            <Button size="sm" className="rounded-none" onClick={() => setEditing(null)}>
              + Tambah Kelas
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Kelas" : "Tambah Kelas"}</DialogTitle>
            </DialogHeader>
            <form action={handleSubmit} className="space-y-3">
              {editing && <input type="hidden" name="id" value={editing.id} />}
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
                          {y.year_label} — {y.semester}
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
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {classes.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setEditing(c);
              setOpen(true);
            }}
            className="rounded-none bg-primary-soft/30 px-4 py-3 text-left text-sm font-semibold hover:bg-primary-soft/50"
          >
            {c.name}
          </button>
        ))}
        {classes.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada kelas pada tahun ajaran aktif.</p>
        )}
      </div>
    </Card>
  );
}
