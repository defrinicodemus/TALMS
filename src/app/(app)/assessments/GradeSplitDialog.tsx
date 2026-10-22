"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { ResponsiveDialogContent } from "@/components/ResponsiveDialogContent";
import { SubmissionAnswer } from "@/components/SubmissionAnswer";
import { formatAssignmentTime } from "@/lib/assignmentConstants";
import type { StudentSubmissionRow } from "@/lib/data/review";
import { fetchTaskSubmission, gradeSubmission } from "./actions";

type ReviewAnswer = NonNullable<Awaited<ReturnType<typeof fetchTaskSubmission>>>;

export function GradeSplitDialog({
  assignmentTitle,
  student,
  disabled,
}: {
  assignmentTitle: string;
  student: StudentSubmissionRow;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<ReviewAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const requestId = useRef(0);

  async function openReview(value: boolean) {
    if (isPending) return;
    const request = ++requestId.current;
    setOpen(value);
    if (!value) return;
    setLoading(true);
    setAnswer(null);
    try {
      const latest = await fetchTaskSubmission(student.submissionId ?? "");
      if (request !== requestId.current) return;
      setAnswer(latest);
      if (!latest) toast.error("Jawaban belum dapat dibuka. Muat ulang dan periksa penugasanmu.");
    } catch {
      if (request !== requestId.current) return;
      toast.error("Jawaban belum dapat dimuat. Periksa koneksi lalu buka kembali.");
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }
  function handleSubmit(formData: FormData) {
    if (!answer || isPending) return;
    formData.set("submission_id", student.submissionId ?? "");
    formData.set("expected_updated_at", answer.updatedAt);
    startTransition(async () => {
      try {
        const result = await gradeSubmission(formData);
        if (result.ok) {
          toast.success(result.message);
          setOpen(false);
          router.refresh();
        } else {
          toast.error(result.message);
          if (result.conflict) {
            setOpen(false);
            router.refresh();
          }
        }
      } catch {
        toast.error(
          "Nilai belum dapat dikonfirmasi tersimpan. Muat ulang untuk memeriksa sebelum mencoba lagi.",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={openReview}>
      <DialogTrigger asChild>
        <Button size="sm" className="rounded-md" disabled={disabled}>
          Periksa
        </Button>
      </DialogTrigger>
      <ResponsiveDialogContent title={`${assignmentTitle} - ${student.studentName}`}>
        {loading ? (
          <p role="status" className="p-6 text-sm text-muted-foreground">
            Memuat jawaban terbaru...
          </p>
        ) : !answer ? (
          <p className="p-6 text-sm text-muted-foreground">
            Jawaban belum tersedia. Tutup dan buka kembali untuk mencoba lagi.
          </p>
        ) : (
          <div className="grid flex-1 grid-cols-1 sm:grid-cols-10 sm:overflow-hidden">
            <div className="space-y-4 border-b p-4 sm:col-span-7 sm:overflow-y-auto sm:border-b-0 sm:border-r">
              <div>
                <h3 className="text-sm font-semibold">{student.studentName}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {answer.submittedAt
                    ? `Pengumpulan terakhir: ${formatAssignmentTime(answer.submittedAt)}`
                    : "Waktu pengumpulan belum tercatat."}
                </p>
              </div>
              <div className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-semibold">Hasil Kerja</h3>
                <SubmissionAnswer
                  key={`${answer.updatedAt}:${answer.photoUrl}`}
                  content={answer.contentUrl}
                  photoUrl={answer.photoUrl}
                />
              </div>
            </div>
            <div className="p-4 sm:col-span-3 sm:overflow-y-auto">
              <form key={answer.updatedAt} action={handleSubmit} className="space-y-3">
                <fieldset disabled={isPending} className="space-y-3">
                  <div>
                    <Label htmlFor={`score-${student.studentId}`}>Nilai (0–100)</Label>
                    <Input
                      id={`score-${student.studentId}`}
                      name="score"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      defaultValue={answer.score ?? undefined}
                      className="mt-1"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor={`comment-${student.studentId}`}>Catatan / Umpan Balik</Label>
                    <Textarea
                      id={`comment-${student.studentId}`}
                      name="teacher_comment"
                      defaultValue={answer.teacherComment ?? ""}
                      maxLength={5000}
                      rows={8}
                      className="mt-1"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full rounded-md"
                    disabled={isPending || !["submitted", "graded"].includes(answer.status)}
                  >
                    {isPending ? "Menyimpan..." : "Simpan Nilai"}
                  </Button>
                </fieldset>
              </form>
            </div>
          </div>
        )}
      </ResponsiveDialogContent>
    </Dialog>
  );
}
