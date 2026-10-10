"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

const STAGE_SIZE = 340;
const CROP_SIZE = 260;
const OUTPUT_SIZE = 512;

type Pan = { x: number; y: number };

function clampPan(pan: Pan, zoom: number, naturalWidth: number, naturalHeight: number): Pan {
  const maxX = Math.max(0, (naturalWidth * zoom - CROP_SIZE) / 2);
  const maxY = Math.max(0, (naturalHeight * zoom - CROP_SIZE) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)),
    y: Math.min(maxY, Math.max(-maxY, pan.y)),
  };
}

export function LogoCropDialog({
  open,
  onOpenChange,
  file,
  onCropped,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  onCropped: (file: File) => Promise<{ ok: boolean; message: string }>;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragState = useRef<{ startX: number; startY: number; startPan: Pan; scale: number } | null>(
    null,
  );

  useEffect(() => {
    if (!file) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    setNaturalSize(null);
    setPan({ x: 0, y: 0 });
    setError(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleImageLoad() {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) {
      setError("Gambar tidak dapat dibaca. Pilih file logo lain.");
      return;
    }
    const min = CROP_SIZE / Math.min(w, h);
    setNaturalSize({ w, h });
    setMinZoom(min);
    setZoom(min);
    setPan({ x: 0, y: 0 });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!naturalSize || saving.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Keep crop math in the original 340 px coordinate space at any screen width.
    const width = e.currentTarget.getBoundingClientRect().width;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPan: pan,
      scale: width ? STAGE_SIZE / width : 1,
    };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current || !naturalSize) return;
    const dx = (e.clientX - dragState.current.startX) * dragState.current.scale;
    const dy = (e.clientY - dragState.current.startY) * dragState.current.scale;
    const next = {
      x: dragState.current.startPan.x + dx,
      y: dragState.current.startPan.y + dy,
    };
    setPan(clampPan(next, zoom, naturalSize.w, naturalSize.h));
  }

  function handlePointerUp() {
    dragState.current = null;
  }

  function handleZoomChange([value]: number[]) {
    if (!naturalSize) return;
    setZoom(value);
    setPan((prev) => clampPan(prev, value, naturalSize.w, naturalSize.h));
  }

  async function handleConfirm() {
    const img = imgRef.current;
    if (!img || !naturalSize || saving.current) return;
    saving.current = true;
    setIsSaving(true);
    setError(null);
    const sSize = CROP_SIZE / zoom;
    const sx = naturalSize.w / 2 - CROP_SIZE / (2 * zoom) - pan.x / zoom;
    const sy = naturalSize.h / 2 - CROP_SIZE / (2 * zoom) - pan.y / zoom;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("Canvas unavailable");
      // Jangan fillRect warna latar di sini — biarkan transparan supaya alpha PNG/WEBP asli terbawa.
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Image conversion failed");
      const result = await onCropped(new File([blob], "logo.png", { type: "image/png" }));
      if (!result.ok) setError(result.message);
    } catch {
      setError("Logo belum dapat diproses atau disimpan. Periksa logo sebelum mencoba kembali.");
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving.current) onOpenChange(value);
      }}
    >
      <DialogContent
        dismissOnOverlayOnly
        className="max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-md"
        aria-busy={isSaving}
      >
        <DialogHeader>
          <DialogTitle>Sesuaikan Logo</DialogTitle>
        </DialogHeader>

        {objectUrl && (
          <>
            <div
              className="relative mx-auto aspect-square w-full max-w-[340px] touch-none select-none overflow-hidden rounded-md bg-transparency-grid"
              style={{ cursor: isSaving ? "wait" : "grab" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onLostPointerCapture={handlePointerUp}
            >
              <img
                ref={imgRef}
                src={objectUrl}
                alt="Pratinjau logo"
                draggable={false}
                onLoad={handleImageLoad}
                onError={() => {
                  setNaturalSize(null);
                  setError("Gambar tidak dapat dibaca. Pilih file logo lain.");
                }}
                className={cn("absolute max-w-none max-h-none", !naturalSize && "invisible")}
                style={
                  naturalSize
                    ? {
                        left: `${50 - (naturalSize.w / STAGE_SIZE) * 50}%`,
                        top: `${50 - (naturalSize.h / STAGE_SIZE) * 50}%`,
                        width: `${(naturalSize.w / STAGE_SIZE) * 100}%`,
                        height: `${(naturalSize.h / STAGE_SIZE) * 100}%`,
                        transform: `translate(${(pan.x / naturalSize.w) * 100}%, ${(pan.y / naturalSize.h) * 100}%) scale(${zoom})`,
                        transformOrigin: "center center",
                      }
                    : undefined
                }
              />
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm ring-2 ring-white/80"
                style={{
                  width: `${(CROP_SIZE / STAGE_SIZE) * 100}%`,
                  height: `${(CROP_SIZE / STAGE_SIZE) * 100}%`,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
                }}
              />
            </div>

            <div className="px-1">
              <Slider
                value={[zoom]}
                min={minZoom}
                max={minZoom * 4}
                step={(minZoom * 3) / 100}
                onValueChange={handleZoomChange}
                disabled={!naturalSize || isSaving}
                aria-label="Perbesar atau perkecil logo"
              />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Geser untuk memindahkan, gunakan slider untuk memperbesar/memperkecil.
            </p>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Batal
          </Button>
          <Button
            type="button"
            className="rounded-xl"
            disabled={!naturalSize || isSaving}
            onClick={handleConfirm}
          >
            {isSaving ? "Menyimpan..." : "Simpan Logo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
