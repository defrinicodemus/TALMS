"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
import { createAcademicYear, setActiveAcademicYear, deleteAcademicYear } from "../actions";

type YearRow = { id: string; year_label: string; semester: string; is_active: boolean };

export function YearsManager({ years }: { years: YearRow[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [activatingId, setActivatingId] = useState<string | null>(null);

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

  function handleActivate(id: string) {
    setActivatingId(id);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      const result = await setActiveAcademicYear(formData);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      setActivatingId(null);
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
    <Card className="rounded-none border-0 p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold">Tahun Ajaran</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-none">
              + Tambah Tahun Ajaran
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Tambah Tahun Ajaran</DialogTitle>
            </DialogHeader>
            <form action={handleSubmit} className="space-y-3">
              <div>
                <Label>Tahun Ajaran</Label>
                <Input name="year_label" placeholder="2026/2027" className="mt-1" required />
              </div>
              <div>
                <Label>Semester</Label>
                <Select name="semester" defaultValue="ganjil" required>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Pilih semester" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ganjil">Ganjil</SelectItem>
                    <SelectItem value="genap">Genap</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full rounded-none" disabled={isPending}>
                {isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {years.map((y) => (
          <Card
            key={y.id}
            className={`relative rounded-none border-0 p-4 shadow-soft ${y.is_active ? "bg-primary text-primary-foreground" : "bg-card"}`}
          >
            {!y.is_active && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    className="absolute right-3 top-3 text-muted-foreground hover:text-destructive"
                    disabled={isPending}
                    aria-label="Hapus tahun ajaran"
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
            <div className="font-display text-xl font-bold">{y.year_label}</div>
            <div className="mt-1 text-sm capitalize opacity-90">Semester {y.semester}</div>
            {y.is_active ? (
              <div className="mt-2 inline-flex rounded-none bg-white/20 px-2 py-0.5 text-xs">
                Aktif
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 rounded-none"
                disabled={isPending}
                onClick={() => handleActivate(y.id)}
              >
                {activatingId === y.id ? "Mengaktifkan..." : "Jadikan Aktif"}
              </Button>
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
