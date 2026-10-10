"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
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
import { createTeacher, updateStaff, deleteTeacher } from "./actions";

type Teaching = { className: string; subjectName: string; periodLabel: string; isActive: boolean };
type Teacher = {
  id: string;
  name: string;
  nip: string | null;
  teaching: Teaching[];
  materials: number;
  quizzes: number;
};

const MAX_BADGES = 3;

function TeachingBadges({ teaching }: { teaching: Teaching[] }) {
  const [expanded, setExpanded] = useState(false);
  if (teaching.length === 0) {
    return <span className="text-xs text-muted-foreground">Belum ada penugasan</span>;
  }
  const shown = expanded ? teaching : teaching.slice(0, MAX_BADGES);
  const rest = teaching.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t, i) => (
        <span
          key={i}
          className="rounded-full bg-primary-soft/40 px-2 py-0.5 text-xs font-medium text-primary"
        >
          {t.className} · {t.subjectName} · {t.periodLabel}
          {t.isActive ? " · Aktif" : ""}
        </span>
      ))}
      {teaching.length > MAX_BADGES && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Ringkas" : `+${rest} lainnya`}
        </button>
      )}
    </div>
  );
}

export function TeachersPanel({ teachers }: { teachers: Teacher[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [isPending, startTransition] = useTransition();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.nip ?? "").toLowerCase().includes(q),
    );
  }, [teachers, query]);

  function openAdd() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(t: Teacher) {
    setEditing(t);
    setOpen(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = editing ? await updateStaff(formData) : await createTeacher(formData);
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
      const result = await deleteTeacher(id);
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
            if (isPending) return;
            setOpen(v);
            if (!v) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button className="rounded-xl" onClick={openAdd}>
              + Tambah Guru
            </Button>
          </DialogTrigger>
          <DialogContent dismissOnOverlayOnly>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Guru" : "Tambah Guru"}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!isPending) handleSubmit(new FormData(event.currentTarget));
              }}
              className="space-y-3"
            >
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div>
                <Label>Nama</Label>
                <Input name="name" defaultValue={editing?.name ?? ""} className="mt-1" required />
              </div>
              <div>
                <Label>NIP</Label>
                <Input
                  name="nip"
                  defaultValue={editing?.nip ?? ""}
                  className="mt-1"
                  placeholder="Dipakai sebagai username & password awal"
                  required
                />
              </div>
              {editing && (
                <div>
                  <Label>Penugasan Mengajar</Label>
                  <div className="mt-1">
                    <TeachingBadges teaching={editing.teaching} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Atur penugasan kelas & mata pelajaran di menu Master Kelas.
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" className="flex-1 rounded-xl" disabled={isPending}>
                  {isPending ? "Menyimpan..." : "Simpan"}
                </Button>
                {editing && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        className="rounded-xl"
                        disabled={isPending}
                      >
                        Hapus
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Hapus akun {editing.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Aksi ini tidak bisa dibatalkan. Guru hanya bisa dihapus jika tidak sedang
                          ditugaskan mengajar kelas/mapel manapun.
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
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama/NIP..."
            className="w-56 rounded-xl pl-9"
          />
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Nama</th>
              <th className="px-4 py-3">NIP</th>
              <th className="px-4 py-3">Penugasan Mengajar</th>
              <th className="px-4 py-3">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-muted/30">
                <td className="px-4 py-3">{t.name}</td>
                <td className="px-4 py-3">{t.nip ?? "-"}</td>
                <td className="px-4 py-3">
                  <TeachingBadges teaching={t.teaching} />
                </td>
                <td className="px-4 py-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-lg"
                    onClick={() => openEdit(t)}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Tidak ditemukan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
