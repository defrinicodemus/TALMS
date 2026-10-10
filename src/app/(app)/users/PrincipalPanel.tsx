"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
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
import { createPrincipal, updateStaff } from "./actions";

type Principal = { id: string; full_name: string; nip: string | null } | null;

export function PrincipalPanel({ principal }: { principal: Principal }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = principal ? await updateStaff(formData) : await createPrincipal(formData);
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (!isPending) setOpen(value);
          }}
        >
          <DialogTrigger asChild>
            <Button className="rounded-xl">
              {principal ? "Edit Kepala Sekolah" : "+ Tambah Kepala Sekolah"}
            </Button>
          </DialogTrigger>
          <DialogContent dismissOnOverlayOnly>
            <DialogHeader>
              <DialogTitle>
                {principal ? "Edit Kepala Sekolah" : "Tambah Kepala Sekolah"}
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!isPending) handleSubmit(new FormData(event.currentTarget));
              }}
              className="space-y-3"
            >
              {principal && <input type="hidden" name="id" value={principal.id} />}
              <div>
                <Label>Nama</Label>
                <Input
                  name="name"
                  defaultValue={principal?.full_name ?? ""}
                  className="mt-1"
                  required
                />
              </div>
              <div>
                <Label>NIP</Label>
                <Input
                  name="nip"
                  defaultValue={principal?.nip ?? ""}
                  className="mt-1"
                  placeholder="Dipakai sebagai username & password awal"
                  required
                />
              </div>
              <Button type="submit" className="w-full rounded-xl" disabled={isPending}>
                {isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Nama</th>
              <th className="px-4 py-3">NIP</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {principal ? (
              <tr>
                <td className="px-4 py-3">{principal.full_name}</td>
                <td className="px-4 py-3">{principal.nip ?? "-"}</td>
              </tr>
            ) : (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
                  Belum ada Kepala Sekolah.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
