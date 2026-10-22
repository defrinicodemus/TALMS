export const SCHOOL_LOGO_UPLOAD = {
  allowedTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
  maxSizeMB: 2,
};

// Keep material uploads below the existing 3 MB Server Action request limit.
export const MATERIAL_UPLOAD = {
  pdf: { allowedTypes: ["application/pdf"], maxSizeMB: 2 },
  image: { allowedTypes: ["image/png", "image/jpeg", "image/webp"], maxSizeMB: 2 },
};

export function validateMaterialFile(file: File, kind: "pdf" | "image") {
  if (!file.size) return { ok: false as const, message: "Pilih file yang tidak kosong." };
  return validateFileUpload(file, MATERIAL_UPLOAD[kind]);
}

export function validateFileUpload(
  file: File,
  opts: { allowedTypes: string[]; maxSizeMB: number },
): { ok: true } | { ok: false; message: string } {
  if (!opts.allowedTypes.includes(file.type)) {
    return { ok: false, message: "Tipe file tidak didukung." };
  }
  if (file.size > opts.maxSizeMB * 1024 * 1024) {
    return { ok: false, message: `Ukuran file maksimal ${opts.maxSizeMB}MB.` };
  }
  return { ok: true };
}
