"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadSchoolLogo } from "../actions";
import { LogoCropDialog } from "./LogoCropDialog";

export function LogoUploader({ logoUrl }: { logoUrl: string | null }) {
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function doUpload(file: File) {
    const formData = new FormData();
    formData.set("logo", file);
    startTransition(async () => {
      const result = await uploadSchoolLogo(formData);
      if (result.ok) {
        toast.success(result.message);
        setPreview(URL.createObjectURL(file));
      } else {
        toast.error(result.message);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === "image/svg+xml") {
      doUpload(file);
      return;
    }
    setCropFile(file);
    setCropOpen(true);
  }

  function handleCropOpenChange(next: boolean) {
    setCropOpen(next);
    if (!next && inputRef.current) inputRef.current.value = "";
  }

  function handleCropped(file: File) {
    setCropOpen(false);
    doUpload(file);
  }

  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          "grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[10px] border",
          preview ? "bg-transparent" : "bg-muted",
        )}
      >
        {preview ? (
          <img src={preview} alt="Logo sekolah" className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">Belum ada</span>
        )}
      </div>
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
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
        <p className="mt-1 text-xs text-muted-foreground">PNG/JPG/WEBP/SVG, maks 2MB.</p>
      </div>
      <LogoCropDialog
        open={cropOpen}
        onOpenChange={handleCropOpenChange}
        file={cropFile}
        onCropped={handleCropped}
      />
    </div>
  );
}
