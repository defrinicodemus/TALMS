"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SCHOOL_LOGO_UPLOAD, validateFileUpload } from "@/lib/validateUpload";
import { uploadSchoolLogo } from "../actions";
import { LogoCropDialog } from "./LogoCropDialog";

export function LogoUploader({ logoUrl }: { logoUrl: string | null }) {
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const uploading = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPreview(logoUrl);
    setPreviewFailed(false);
  }, [logoUrl]);

  async function doUpload(file: File): Promise<{ ok: boolean; message: string }> {
    if (uploading.current) return { ok: false, message: "Tunggu sampai unggahan selesai." };
    const validation = validateFileUpload(file, SCHOOL_LOGO_UPLOAD);
    if (!validation.ok) {
      setError(validation.message);
      return validation;
    }
    uploading.current = true;
    setIsPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("logo", file);
    try {
      const result = await uploadSchoolLogo(formData);
      if (result.ok && result.logoUrl) {
        toast.success(result.message);
        setPreview(result.logoUrl);
        setPreviewFailed(false);
        return result;
      } else {
        const message = result.ok
          ? "URL logo belum tersedia. Muat ulang dan periksa logo."
          : result.message;
        setError(message);
        toast.error(message);
        return { ok: false, message };
      }
    } catch {
      const message =
        "Status unggahan belum dapat dipastikan. Muat ulang dan periksa logo sebelum mencoba kembali.";
      setError(message);
      return { ok: false, message };
    } finally {
      uploading.current = false;
      setIsPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const validation = file.size
      ? validateFileUpload(file, SCHOOL_LOGO_UPLOAD)
      : { ok: false as const, message: "File logo kosong. Pilih gambar lain." };
    if (!validation.ok) {
      setError(validation.message);
      e.target.value = "";
      return;
    }

    if (file.type === "image/svg+xml") {
      void doUpload(file);
      return;
    }
    setCropFile(file);
    setCropOpen(true);
  }

  function handleCropOpenChange(next: boolean) {
    if (uploading.current) return;
    setCropOpen(next);
    if (!next) {
      setCropFile(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleCropped(file: File) {
    const result = await doUpload(file);
    if (result.ok) {
      setCropOpen(false);
      setCropFile(null);
    }
    return result;
  }

  return (
    <div className="space-y-2" aria-busy={isPending}>
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[10px] border",
            preview ? "bg-transparent" : "bg-muted",
          )}
        >
          {preview && !previewFailed ? (
            <img
              src={preview}
              alt="Logo sekolah"
              className="h-full w-full object-contain"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <span className="p-1 text-center text-xs text-muted-foreground">
              {previewFailed ? "Gagal dimuat" : "Belum ada"}
            </span>
          )}
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            accept={SCHOOL_LOGO_UPLOAD.allowedTypes.join(",")}
            aria-label="Pilih file logo sekolah"
            className="hidden"
            onChange={handleFileChange}
            disabled={isPending}
          />
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            disabled={isPending}
            onClick={() => inputRef.current?.click()}
          >
            {isPending ? "Mengunggah..." : "Unggah Logo"}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            PNG/JPG/WEBP/SVG, maks {SCHOOL_LOGO_UPLOAD.maxSizeMB} MB.
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Logo disimpan terpisah dari profil sekolah. PNG/JPG/WEBP disimpan setelah memilih “Simpan
        Logo”; SVG langsung diunggah setelah dipilih.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <LogoCropDialog
        open={cropOpen}
        onOpenChange={handleCropOpenChange}
        file={cropFile}
        onCropped={handleCropped}
      />
    </div>
  );
}
