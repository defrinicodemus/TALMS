"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSchoolSettings } from "../actions";

export function SchoolSettingsForm({
  name,
  address,
  phone,
}: {
  name: string;
  address: string;
  phone: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await saveSchoolSettings(formData);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <form action={handleSubmit} className="mt-4 space-y-3">
      <div>
        <Label>Nama Sekolah</Label>
        <Input name="name" className="mt-1" defaultValue={name} />
      </div>
      <div>
        <Label>Alamat</Label>
        <Input name="address" className="mt-1" defaultValue={address} />
      </div>
      <div>
        <Label>No. Telepon</Label>
        <Input name="phone" className="mt-1" defaultValue={phone} />
      </div>
      <Button type="submit" className="rounded-none" disabled={isPending}>
        {isPending ? "Menyimpan..." : "Simpan Perubahan"}
      </Button>
    </form>
  );
}
