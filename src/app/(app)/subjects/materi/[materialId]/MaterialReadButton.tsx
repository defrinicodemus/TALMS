"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markMaterialViewed } from "../../actions";

export function MaterialReadButton({
  materialId,
  viewed,
}: {
  materialId: string;
  viewed: boolean;
}) {
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isRead = viewed || saved;

  function markRead() {
    startTransition(async () => {
      try {
        const result = await markMaterialViewed(materialId);
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        setSaved(true);
        toast.success(result.message);
        router.refresh();
      } catch {
        toast.error("Status membaca belum tersimpan. Periksa koneksi dan coba lagi.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div role="status" aria-live="polite">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {isRead ? (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          ) : (
            <BookOpen className="h-4 w-4" />
          )}
          {isRead ? "Sudah dibaca" : "Belum ditandai dibaca"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isRead
            ? "Progres membaca materi ini sudah tersimpan."
            : "Tekan tombol setelah kamu selesai membaca atau menyimak materi."}
        </p>
      </div>
      {!isRead && (
        <Button className="shrink-0" disabled={isPending} onClick={markRead}>
          {isPending ? "Menyimpan..." : "Tandai sudah dibaca"}
        </Button>
      )}
    </div>
  );
}
