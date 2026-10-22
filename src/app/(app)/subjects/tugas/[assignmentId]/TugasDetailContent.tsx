"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SubmissionAnswer } from "@/components/SubmissionAnswer";
import type { StudentAssignmentDetail } from "@/lib/data/subjects";
import {
  ASSIGNMENT_MAX_PHOTO_MB,
  ASSIGNMENT_MAX_TEXT_LENGTH,
  ASSIGNMENT_PHOTO_TYPES,
  assignmentPhotoPath,
  formatAssignmentTime,
  isLegacyAssignmentPhoto,
} from "@/lib/assignmentConstants";
import { validateFileUpload } from "@/lib/validateUpload";
import { submitAssignment } from "../../actions";

export function TugasDetailContent({ assignment }: { assignment: StudentAssignmentDetail }) {
  const [saved, setSaved] = useState(assignment);
  const graded = saved.status === "graded" || saved.score != null;
  const hasAnswer = saved.status === "submitted" || graded;
  const savedIsPhoto =
    !!assignmentPhotoPath(saved.submissionContent) ||
    isLegacyAssignmentPhoto(saved.submissionContent);
  const [editing, setEditing] = useState(!hasAnswer);
  const [method, setMethod] = useState<"text" | "photo">(
    savedIsPhoto && assignment.allowedMethods.includes("photo")
      ? "photo"
      : assignment.allowedMethods[0],
  );
  const [answer, setAnswer] = useState(savedIsPhoto ? "" : (assignment.submissionContent ?? ""));
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [expired, setExpired] = useState(
    () => !!assignment.dueAt && new Date(assignment.dueAt).getTime() <= Date.now(),
  );
  const inputId = useId();
  const router = useRouter();

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => {
    if (!assignment.dueAt || expired) return;
    const check = () => setExpired(new Date(assignment.dueAt!).getTime() <= Date.now());
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [assignment.dueAt, expired]);

  function cancelEdit() {
    setAnswer(savedIsPhoto ? "" : (saved.submissionContent ?? ""));
    setPhoto(null);
    setEditing(false);
  }
  function send() {
    if (isPending || expired || graded) return;
    const data = new FormData();
    data.set("method", method);
    if (method === "text") data.set("content", answer);
    data.set("expected_updated_at", saved.submissionUpdatedAt ?? "");
    if (method === "photo" && photo) data.set("photo", photo);
    startTransition(async () => {
      try {
        const result = await submitAssignment(saved.id, data);
        if (!result.ok || !result.submission) {
          toast.error(result.message);
          return;
        }
        const submission = result.submission;
        setSaved((current) => ({
          ...current,
          status: "submitted",
          submissionContent: submission.content,
          submissionPhotoUrl: submission.photoUrl,
          submittedAt: submission.submittedAt,
          submissionUpdatedAt: submission.updatedAt,
        }));
        setEditing(false);
        setPhoto(null);
        toast.success(result.message);
        router.refresh();
      } catch {
        toast.error(
          "Pengiriman belum dapat dikonfirmasi. Isian tetap tersedia; periksa koneksi dan status pengumpulan sebelum mencoba lagi.",
        );
      }
    });
  }

  const unchanged = method === "text" && answer.trim() === saved.submissionContent;
  const canSend = method === "text" ? !!answer.trim() && (!hasAnswer || !unchanged) : !!photo;
  return (
    <div className="min-w-0 space-y-5">
      <section
        aria-label="Instruksi tugas"
        className="space-y-4 rounded-2xl bg-card p-4 shadow-soft sm:p-6"
      >
        <h2 className="font-display text-lg font-bold">Instruksi Tugas</h2>
        {saved.description ? (
          <div
            className="rich-text-content break-words text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: saved.description }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Tidak ada instruksi tambahan.</p>
        )}
        {saved.attachmentImageUrl && (
          <div className="space-y-2 rounded-xl border p-3">
            <h3 className="text-sm font-semibold">Lampiran dari Guru</h3>
            <a
              href={saved.attachmentImageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-primary underline"
            >
              Buka {saved.attachmentImageName ?? "lampiran gambar"}
            </a>
          </div>
        )}
        <div className="space-y-1 rounded-xl bg-muted/40 p-3 text-sm">
          <p>
            <span className="font-semibold">Tenggat: </span>
            {formatAssignmentTime(saved.dueAt)}
          </p>
          <p className="text-muted-foreground">
            Jawaban:{" "}
            {saved.allowedMethods
              .map((m) =>
                m === "photo" ? `satu foto (maks. ${ASSIGNMENT_MAX_PHOTO_MB} MB)` : "teks",
              )
              .join(" atau ")}
          </p>
        </div>
      </section>

      <section
        aria-label="Pengumpulan saya"
        className="space-y-4 rounded-2xl bg-card p-4 shadow-soft sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Pengumpulan Saya</h2>
          <span className="rounded-lg bg-muted px-3 py-1 text-xs font-medium">
            {graded ? "Sudah dinilai" : hasAnswer ? "Sudah dikumpulkan" : "Belum dikumpulkan"}
          </span>
        </div>
        {hasAnswer && (
          <div className="space-y-3 rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">
              {saved.submittedAt
                ? `Pengumpulan terakhir: ${formatAssignmentTime(saved.submittedAt)}`
                : "Waktu pengumpulan belum tercatat."}
            </p>
            <SubmissionAnswer
              key={`${saved.submissionUpdatedAt}:${saved.submissionPhotoUrl}`}
              content={saved.submissionContent}
              photoUrl={saved.submissionPhotoUrl}
            />
            {!graded && <p className="text-sm text-muted-foreground">Menunggu penilaian guru.</p>}
          </div>
        )}
        {graded ? (
          <p className="text-sm text-muted-foreground">
            Jawaban yang sudah dinilai tidak dapat diubah.
          </p>
        ) : expired ? (
          <p role="status" className="rounded-xl bg-muted/40 p-3 text-sm">
            Tenggat pengumpulan sudah berakhir. {hasAnswer ? "Jawabanmu tetap tersimpan. " : ""}
            Hubungi guru jika membutuhkan perpanjangan waktu.
          </p>
        ) : editing ? (
          <fieldset disabled={isPending} className="space-y-4">
            {hasAnswer && (
              <p className="text-sm text-muted-foreground">
                Perubahan akan mengganti jawaban dan waktu pengumpulan sebelumnya. Jawaban lama
                tetap tersimpan sampai perubahan berhasil dikirim.
              </p>
            )}
            {saved.allowedMethods.length > 1 && (
              <div className="flex flex-wrap gap-4" role="group" aria-label="Metode jawaban">
                {saved.allowedMethods.map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`${inputId}-method`}
                      checked={method === m}
                      onChange={() => setMethod(m)}
                    />
                    {m === "text" ? "Tulis jawaban" : "Unggah foto"}
                  </label>
                ))}
              </div>
            )}
            {method === "text" ? (
              <div className="space-y-2">
                <Label htmlFor={`${inputId}-answer`}>Jawaban Kamu</Label>
                <Textarea
                  id={`${inputId}-answer`}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={7}
                  maxLength={ASSIGNMENT_MAX_TEXT_LENGTH}
                  placeholder="Tulis jawaban tugasmu di sini..."
                />
                <p className="text-right text-xs text-muted-foreground">
                  {answer.length.toLocaleString("id-ID")} /{" "}
                  {ASSIGNMENT_MAX_TEXT_LENGTH.toLocaleString("id-ID")} karakter
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <Label htmlFor={`${inputId}-photo`}>Foto Jawaban</Label>
                <Input
                  id={`${inputId}-photo`}
                  type="file"
                  accept={ASSIGNMENT_PHOTO_TYPES.join(",")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const result = validateFileUpload(file, {
                      allowedTypes: ASSIGNMENT_PHOTO_TYPES,
                      maxSizeMB: ASSIGNMENT_MAX_PHOTO_MB,
                    });
                    if (!result.ok || !file.size) {
                      toast.error(result.ok ? "Pilih foto yang tidak kosong." : result.message);
                      return;
                    }
                    setPhoto(file);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Pilih satu foto JPG, PNG, atau WebP, maksimal {ASSIGNMENT_MAX_PHOTO_MB} MB.
                  Pastikan tulisan terbaca dengan jelas.
                </p>
                {photo && (
                  <div className="space-y-2 rounded-xl border p-3">
                    {preview && (
                      <img
                        src={preview}
                        alt="Pratinjau foto sebelum dikirim"
                        className="max-h-72 max-w-full rounded-lg object-contain"
                      />
                    )}
                    <p className="break-words text-xs">{photo.name}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPhoto(null)}
                    >
                      Batalkan Foto
                    </Button>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={isPending || !canSend} onClick={send}>
                {isPending
                  ? "Mengirim..."
                  : hasAnswer
                    ? "Simpan Perubahan Jawaban"
                    : "Kumpulkan Tugas"}
              </Button>
              {hasAnswer && (
                <Button type="button" variant="outline" onClick={cancelEdit}>
                  Batal
                </Button>
              )}
            </div>
          </fieldset>
        ) : (
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            Ubah Jawaban
          </Button>
        )}
      </section>
      {graded && (
        <section
          aria-label="Nilai dan umpan balik"
          className="space-y-4 rounded-2xl bg-card p-4 shadow-soft sm:p-6"
        >
          <h2 className="font-display text-lg font-bold">Nilai dan Umpan Balik</h2>
          <p className="text-3xl font-bold text-primary">
            {saved.score ?? "—"}
            <span className="text-base text-muted-foreground"> / 100</span>
          </p>
          <p className="whitespace-pre-wrap break-words text-sm">
            {saved.teacherComment || "Guru belum memberikan catatan tambahan."}
          </p>
        </section>
      )}
    </div>
  );
}
