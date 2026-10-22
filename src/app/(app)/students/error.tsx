"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function StudentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Gagal memuat monitoring pembelajaran", error);
  }, [error]);

  return (
    <Card className="mx-auto max-w-xl rounded-3xl border-0 p-8 text-center shadow-soft">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h1 className="mt-4 font-display text-xl font-bold">Monitoring belum dapat dimuat</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Periksa koneksi lalu coba lagi. Data pembelajaran yang sudah tersimpan tidak berubah.
      </p>
      <Button type="button" className="mt-5 rounded-xl" onClick={reset}>
        Coba Lagi
      </Button>
    </Card>
  );
}
