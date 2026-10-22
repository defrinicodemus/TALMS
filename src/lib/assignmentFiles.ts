import { createAdminClient } from "@/lib/supabase/admin";
import { validateFileUpload } from "@/lib/validateUpload";
import {
  ASSIGNMENT_MAX_PHOTO_MB,
  ASSIGNMENT_PHOTO_TYPES,
  ASSIGNMENT_PHOTO_BUCKET,
  assignmentPhotoPath,
  isLegacyAssignmentPhoto,
} from "@/lib/assignmentConstants";

export async function validateAssignmentPhoto(file: File) {
  const validation = validateFileUpload(file, {
    allowedTypes: ASSIGNMENT_PHOTO_TYPES,
    maxSizeMB: ASSIGNMENT_MAX_PHOTO_MB,
  });
  if (!validation.ok) return validation;
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  const valid =
    file.type === "image/png"
      ? starts(137, 80, 78, 71, 13, 10, 26, 10)
      : file.type === "image/jpeg"
        ? starts(255, 216, 255)
        : starts(82, 73, 70, 70) && [87, 69, 66, 80].every((byte, i) => bytes[i + 8] === byte);
  return valid
    ? { ok: true as const }
    : { ok: false as const, message: "Isi file tidak sesuai format foto JPG, PNG, atau WebP." };
}

export async function uploadAssignmentPhoto(file: File, bucketName: string, folder: string) {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const path = `${folder}/${crypto.randomUUID()}.${extensions[file.type]}`;
  const bucket = createAdminClient().storage.from(bucketName);
  const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
  if (error)
    return { ok: false as const, message: "Foto belum berhasil diunggah. Silakan coba lagi." };
  return { ok: true as const, path, url: bucket.getPublicUrl(path).data.publicUrl };
}

export async function discardAssignmentPhoto(bucket: string, path: string) {
  try {
    const { error } = await createAdminClient().storage.from(bucket).remove([path]);
    if (error) console.error("Gagal membersihkan foto tugas yang tidak tersimpan.");
  } catch {
    console.error("Gagal membersihkan foto tugas yang tidak tersimpan.");
  }
}

// Call only for submission rows already authorized by the session client's RLS.
export async function assignmentPhotoUrl(content: string | null) {
  const path = assignmentPhotoPath(content);
  if (!path) return isLegacyAssignmentPhoto(content) ? content : null;
  const { data, error } = await createAdminClient()
    .storage.from(ASSIGNMENT_PHOTO_BUCKET)
    .createSignedUrl(path, 3600);
  return error ? null : (data?.signedUrl ?? null);
}
