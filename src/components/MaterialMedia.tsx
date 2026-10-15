"use client";

import { useState } from "react";
import { Download, ExternalLink, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getMaterialDownloadUrl,
  getMaterialMediaUrl,
  getMaterialOpenUrl,
} from "@/lib/materialEmbeds";

// Shared by teacher previews and the student reader. Embeds only mount on request.
export function MaterialMedia({
  kind,
  url,
  title,
  compact = false,
}: {
  kind: string;
  url: string;
  title: string;
  compact?: boolean;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const mediaUrl = getMaterialMediaUrl(kind, url);
  const openUrl = getMaterialOpenUrl(kind, url);
  const downloadUrl =
    kind === "pdf" || kind === "image" ? getMaterialDownloadUrl(url, title) : null;

  if (!mediaUrl || !openUrl) {
    return (
      <p className="rounded-md bg-muted/40 p-4 text-sm text-muted-foreground">
        Tautan materi tidak valid. Minta guru memperbarui tautannya.
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      {kind === "image" ? (
        imageFailed ? (
          <p role="status" className="text-sm text-muted-foreground">
            Gambar belum dapat ditampilkan. Coba buka melalui tombol di bawah.
          </p>
        ) : (
          <img
            src={mediaUrl}
            alt={title}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className={cn(
              "mx-auto h-auto max-w-full rounded-md object-contain",
              compact ? "max-h-64" : "max-h-[75vh]",
            )}
          />
        )
      ) : showPreview ? (
        <div
          className={cn(
            "overflow-hidden rounded-md border bg-muted/20",
            kind !== "pdf" && "aspect-video",
          )}
        >
          <iframe
            src={mediaUrl}
            title={title}
            loading="lazy"
            allowFullScreen
            className={cn(
              "w-full",
              kind === "pdf" ? (compact ? "h-64" : "h-[65vh] min-h-80 sm:h-[75vh]") : "h-full",
            )}
          />
        </div>
      ) : (
        <div className="grid min-h-36 place-items-center rounded-md border bg-muted/20 p-5 text-center">
          <Button type="button" variant="outline" onClick={() => setShowPreview(true)}>
            <Play className="mr-2 h-4 w-4" />
            {kind === "video"
              ? "Tampilkan video"
              : kind === "pdf"
                ? "Tampilkan PDF"
                : "Tampilkan presentasi"}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={openUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            Buka di tab baru
          </a>
        </Button>
        {downloadUrl && (
          <Button asChild variant="outline" size="sm">
            <a href={downloadUrl} download target="_blank" rel="noopener noreferrer">
              <Download className="mr-2 h-4 w-4" />
              Unduh file
            </a>
          </Button>
        )}
        {showPreview && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowPreview(false)}>
            Tutup pratinjau
          </Button>
        )}
      </div>
      {kind !== "image" && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Jika pratinjau kosong atau tidak didukung perangkatmu, pilih “Buka di tab baru”.
        </p>
      )}
    </div>
  );
}
