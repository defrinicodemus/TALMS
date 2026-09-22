"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type Student = {
  id: string;
  name: string;
  nisn: string | null;
  classId: string | null;
  className: string | null;
};
type ClassOption = { id: string; name: string };

export function StudentsPanel({
  students,
  classes,
}: {
  students: Student[];
  classes: ClassOption[];
}) {
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [formClassId, setFormClassId] = useState(classId);
  const [isPending, startTransition] = useTransition();

  const rows = useMemo(() => {
    if (searching) {
      const q = query.trim().toLowerCase();
      return students.filter(
        (s) => s.name.toLowerCase().includes(q) || (s.nisn ?? "").toLowerCase().includes(q),
      );
    }
    return students.filter((s) => s.classId === classId);
  }, [students, classId, query, searching]);

  function openAdd() {
    setEditing(null);
    setFormClassId(classId);
    setOpen(true);
  }

  function openEdit(s: Student) {
    setEditing(s);
    setFormClassId(s.classId ?? "");
    setOpen(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = editing ? await updateStudent(formData) : await createStudent(formData);
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
      <div className="flex flex-wrap items-center gap-2">
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button className="rounded-none" onClick={openAdd}>
              + Tambah Siswa
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Siswa" : "Tambah Siswa"}</DialogTitle>
            </DialogHeader>
            <form action={handleSubmit} className="space-y-3">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <input type="hidden" name="class_id" value={formClassId} />
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
              <div>
                <Label>Kelas</Label>
                <Select value={formClassId} onValueChange={setFormClassId}>
                  <SelectTrigger className="mt-1">
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
        <Button variant="outline" className="rounded-none">
          <Upload className="mr-2 h-4 w-4" /> Import Excel
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger className="w-[160px] rounded-none">
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
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama/NISN..."
              className="w-56 rounded-none pl-9"
            />
          </div>
        </div>
      </div>
      {searching && (
        <p className="text-xs text-muted-foreground">
          Menampilkan hasil pencarian dari semua kelas.
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
                {searching && <td className="px-4 py-3">{s.className ?? "-"}</td>}
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
                  {searching ? "Tidak ditemukan." : "Belum ada siswa di kelas ini."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
