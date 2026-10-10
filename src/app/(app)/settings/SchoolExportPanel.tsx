"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ExportPeriod } from "@/lib/data/school-export";

export function SchoolExportPanel({
  period,
  loadError,
}: {
  period: ExportPeriod | null;
  loadError: string | null;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const downloading = useRef(false);

  async function download() {
    if (!period || loadError || downloading.current) return;
    downloading.current = true;
    setIsPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/exports/school?periodId=${encodeURIComponent(period.id)}`,
        { cache: "no-store" },
      ).catch(() => {
        throw new Error("Unduhan gagal. Periksa koneksi lalu coba lagi.");
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "File ekspor belum berhasil dibuat. Silakan coba lagi.");
      }
      if (!response.headers.get("content-type")?.includes("application/zip"))
        throw new Error(
          "Sesi tidak dapat diverifikasi. Muat ulang halaman dan masuk kembali bila diminta.",
        );
      const blob = await response.blob().catch(() => {
        throw new Error("Unduhan terputus. Periksa koneksi lalu coba lagi.");
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "Data-Sekolah.zip";
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toast.success("File ekspor siap diunduh.");
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Unduhan gagal. Periksa koneksi lalu coba lagi.";
      setError(message);
      toast.error(message);
    } finally {
      downloading.current = false;
      setIsPending(false);
    }
  }

  return (
    <Card className="rounded-none border-0 p-6 shadow-soft">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="h-5 w-5 shrink-0 text-primary" />
        <h2 className="font-display text-xl font-bold">Ekspor Data Sekolah</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Unduh data administrasi semester aktif dalam satu ZIP berisi 5 file Excel: profil sekolah,
        struktur akademik, siswa, guru dan kepala sekolah, serta penugasan guru.
      </p>
      <div className="mt-4 border bg-muted/30 p-3 text-sm">
        <p className="font-medium">Semester yang diekspor</p>
        {period ? (
          <p className="mt-1">
            {period.year_label} · {period.semester === "ganjil" ? "Ganjil" : "Genap"}{" "}
            <span className="text-primary">(Aktif)</span>
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            {loadError
              ? "Belum dapat diperiksa."
              : "Belum ada tahun ajaran aktif. Unduhan belum tersedia."}
          </p>
        )}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Hanya siswa yang saat ini ditempatkan di kelas semester aktif yang disertakan. Nilai dan
        aktivitas pembelajaran tidak disertakan.
      </p>
      <p className="mt-3 text-sm">
        Simpan arsip pada akhir semester, sebelum menonaktifkan tahun ajaran dan memindahkan siswa.
      </p>
      {(error || loadError) && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error || loadError}
        </p>
      )}
      <Button
        onClick={download}
        disabled={!period || !!loadError || isPending}
        className="mt-4 h-auto w-full gap-2 whitespace-normal rounded-none py-2"
        aria-busy={isPending}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Download className="h-4 w-4 shrink-0" />
        )}
        {isPending ? "Menyiapkan file…" : "Unduh Data Semester Aktif (.zip)"}
      </Button>
      {(error || loadError || !period) && (
        <Button
          variant="ghost"
          disabled={isPending}
          onClick={() => router.refresh()}
          className="mt-2 w-full rounded-none"
        >
          Muat ulang status semester
        </Button>
      )}
    </Card>
  );
}
