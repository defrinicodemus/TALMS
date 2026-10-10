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
import { changePassword } from "../actions";

export function ChangePasswordDialog({ isAdmin = false }: { isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await changePassword(formData);
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-12 justify-start rounded-md">
          Ganti Kata Sandi
        </Button>
      </DialogTrigger>
      <DialogContent dismissOnOverlayOnly={isAdmin} className="rounded-md">
        <DialogHeader>
          <DialogTitle>Ganti Kata Sandi</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-3">
          <div>
            <Label>Kata Sandi Lama</Label>
            <Input name="current_password" type="password" className="mt-1" required />
          </div>
          <div>
            <Label>Kata Sandi Baru</Label>
            <Input name="new_password" type="password" className="mt-1" required minLength={6} />
          </div>
          <div>
            <Label>Konfirmasi Kata Sandi Baru</Label>
            <Input
              name="confirm_password"
              type="password"
              className="mt-1"
              required
              minLength={6}
            />
          </div>
          <Button type="submit" className="w-full rounded-md" disabled={isPending}>
            {isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
