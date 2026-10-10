"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const submitting = useRef(false);
  const [values, setValues] = useState({ name, address, phone });
  const [savedValues, setSavedValues] = useState({ name, address, phone });
  const [error, setError] = useState<string | null>(null);
  const dirty =
    values.name.trim() !== savedValues.name.trim() ||
    values.address.trim() !== savedValues.address.trim() ||
    values.phone.trim() !== savedValues.phone.trim();

  function handleSubmit(formData: FormData) {
    if (submitting.current || !dirty) return;
    submitting.current = true;
    setError(null);
    const submitted = {
      name: values.name.trim(),
      address: values.address.trim(),
      phone: values.phone.trim(),
    };
    startTransition(async () => {
      try {
        const result = await saveSchoolSettings(formData);
        if (result.ok) {
          setValues(submitted);
          setSavedValues(submitted);
          toast.success(result.message);
        } else {
          setError(result.message);
          toast.error(result.message);
        }
      } catch {
        setError(
          "Hasil penyimpanan belum dapat dipastikan. Periksa profil sekolah sebelum mencoba kembali.",
        );
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit(new FormData(event.currentTarget));
      }}
      className="mt-4 space-y-3"
      aria-busy={isPending}
    >
      <fieldset disabled={isPending} className="space-y-3">
        <div>
          <Label htmlFor="school-name">
            Nama Sekolah <span className="text-destructive">*</span>
          </Label>
          <Input
            id="school-name"
            name="name"
            className="mt-1"
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            required
          />
        </div>
        <div>
          <Label htmlFor="school-address">Alamat</Label>
          <Textarea
            id="school-address"
            name="address"
            className="mt-1"
            rows={3}
            value={values.address}
            onChange={(event) => setValues({ ...values, address: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="school-phone">No. Telepon</Label>
          <Input
            id="school-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            className="mt-1"
            value={values.phone}
            onChange={(event) => setValues({ ...values, phone: event.target.value })}
          />
        </div>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Nama sekolah wajib diisi. Alamat dan nomor telepon ditampilkan di halaman login jika diisi.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="rounded-none"
        disabled={isPending || !dirty || !values.name.trim()}
      >
        {isPending ? "Menyimpan..." : "Simpan Perubahan"}
      </Button>
    </form>
  );
}
