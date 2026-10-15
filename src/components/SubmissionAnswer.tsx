"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ZoomIn, ZoomOut } from "lucide-react";
import { assignmentPhotoPath, assignmentWebUrl } from "@/lib/assignmentConstants";

export function SubmissionAnswer({
  content,
  photoUrl,
}: {
  content: string | null;
  photoUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [failed, setFailed] = useState(false);
  if (photoUrl && !failed)
    return (
      <div className="space-y-2">
        <button
          type="button"
          className="block w-full text-left"
          onClick={() => {
            setScale(1);
            setOpen(true);
          }}
          aria-label="Perbesar foto jawaban"
        >
          <img
            src={photoUrl}
            alt="Foto jawaban siswa"
            onError={() => setFailed(true)}
            className="max-h-80 max-w-full rounded-xl border object-contain"
          />
          <span className="mt-2 block text-xs text-primary">Ketuk foto untuk memperbesar</span>
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-4xl">
            <DialogTitle>Foto Jawaban</DialogTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Perkecil foto"
                onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Perbesar foto"
                onClick={() => setScale((s) => Math.min(3, s + 0.25))}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <a
                href={photoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="self-center text-sm text-primary underline"
              >
                Buka foto
              </a>
            </div>
            <div className="overflow-auto">
              <img
                src={photoUrl}
                alt="Foto jawaban ukuran besar"
                style={{ width: `${scale * 100}%`, maxWidth: "none" }}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  if (assignmentPhotoPath(content) || failed)
    return (
      <p className="text-sm text-muted-foreground">
        Foto sudah tersimpan, tetapi pratinjau belum tersedia atau tautannya kedaluwarsa. Muat ulang
        halaman untuk membukanya kembali.
      </p>
    );
  const url = assignmentWebUrl(content);
  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
        {content || "Belum ada jawaban."}
      </p>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline"
        >
          Buka tautan jawaban
        </a>
      )}
    </div>
  );
}
