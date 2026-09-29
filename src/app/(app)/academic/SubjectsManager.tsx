"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { createSubject, updateSubject, deleteSubject } from "../actions";

type SubjectRow = {
  id: string;
  code: string;
  name: string;
  emoji: string | null;
  min_grade: number | null;
  max_grade: number | null;
};

const EMOJI_OPTIONS = [
  "🔢",
  "🔬",
  "📖",
  "🇮🇩",
  "🕊️",
  "🎨",
  "🌍",
  "⚽",
  "💻",
  "🎵",
  "🗣️",
  "📐",
  "🧮",
  "✏️",
  "📚",
  "🔤",
  "🌱",
  "🎭",
  "🧪",
  "🏃",
  "🖌️",
  "🧭",
  "➗",
  "🔭",
];

function gradeRangeLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `Kelas ${min}-${max}`;
  if (min != null) return `Kelas ${min}+`;
  return `s.d. Kelas ${max}`;
}

export function SubjectsManager({ subjects }: { subjects: SubjectRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SubjectRow | null>(null);
  const [emoji, setEmoji] = useState(EMOJI_OPTIONS[0]);
  const [isPending, startTransition] = useTransition();

  function openAdd() {
    setEditing(null);
    setEmoji(EMOJI_OPTIONS[0]);
    setOpen(true);
  }

  function openEdit(s: SubjectRow) {
    setEditing(s);
    setEmoji(s.emoji && EMOJI_OPTIONS.includes(s.emoji) ? s.emoji : EMOJI_OPTIONS[0]);
    setOpen(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = editing ? await updateSubject(formData) : await createSubject(formData);
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
      const result = await deleteSubject(id);
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
        <h2 className="font-display text-xl font-bold">Mata Pelajaran</h2>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-none" onClick={openAdd}>
              + Tambah Mapel
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Mata Pelajaran" : "Tambah Mata Pelajaran"}</DialogTitle>
            </DialogHeader>
            <form action={handleSubmit} className="space-y-3">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <input type="hidden" name="emoji" value={emoji} />
              {!editing && (
                <div>
                  <Label>Kode</Label>
                  <Input name="code" placeholder="mtk" className="mt-1" required />
                </div>
              )}
              <div>
                <Label>Nama Mapel</Label>
                <Input name="name" defaultValue={editing?.name ?? ""} className="mt-1" required />
              </div>
              <div>
                <Label>Berlaku untuk Kelas</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    name="min_grade"
                    type="number"
                    min={1}
                    max={6}
                    placeholder="Min"
                    defaultValue={editing?.min_grade ?? ""}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">s.d.</span>
                  <Input
                    name="max_grade"
                    type="number"
                    min={1}
                    max={6}
                    placeholder="Maks"
                    defaultValue={editing?.max_grade ?? ""}
                    className="w-20"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Kosongkan kalau berlaku untuk semua kelas (1-6).
                </p>
              </div>
              <div>
                <Label>Emoji</Label>
                <div className="mt-1 grid grid-cols-6 gap-1 rounded-none border p-2">
                  {EMOJI_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setEmoji(option)}
                      className={cn(
                        "rounded-none py-1.5 text-xl hover:bg-muted",
                        emoji === option && "bg-primary-soft/50 ring-2 ring-primary",
                      )}
                      aria-label={`Pilih emoji ${option}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
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
                        <AlertDialogTitle>Hapus mapel {editing.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Aksi ini tidak bisa dibatalkan. Mata pelajaran hanya bisa dihapus jika
                          tidak ada materi, tugas, nilai, atau penugasan guru yang masih memakainya.
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
      <div className="mt-4 grid grid-cols-2 gap-2">
        {subjects.map((s) => {
          const rangeLabel = gradeRangeLabel(s.min_grade, s.max_grade);
          return (
            <button
              key={s.id}
              onClick={() => openEdit(s)}
              className="flex items-center gap-2 rounded-none border px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
            >
              <span className="text-lg">{s.emoji}</span>
              <span className="flex-1">{s.name}</span>
              {rangeLabel && (
                <span className="rounded-none bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                  {rangeLabel}
                </span>
              )}
            </button>
          );
        })}
        {subjects.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada mata pelajaran.</p>
        )}
      </div>
    </Card>
  );
}
