"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { ResponsiveDialogContent } from "@/components/ResponsiveDialogContent";
import { formatAssignmentTime } from "@/lib/assignmentConstants";
import { cn } from "@/lib/utils";
import type { QuizAnswerReviewItem } from "@/lib/data/review";
import { fetchQuizAnswerReview } from "./actions";

export function QuizReviewDialog({
  quizTitle,
  assignmentId,
  studentId,
  studentName,
  submittedAt,
  score,
  passingGrade,
  disabled,
}: {
  quizTitle: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  submittedAt: string | null;
  score: number | null;
  passingGrade: number | null;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QuizAnswerReviewItem[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const [error, setError] = useState<string | null>(null);
  function loadReview() {
    setError(null);
    startTransition(async () => {
      try {
        setItems(await fetchQuizAnswerReview(assignmentId, studentId));
      } catch {
        setError("Hasil kuis belum dapat dimuat. Periksa koneksi lalu coba lagi.");
      }
    });
  }
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && items === null) loadReview();
  }

  const benar = items?.filter((i) => i.points > 0 && i.pointsEarned >= i.points).length ?? 0;
  const salah = items?.filter((i) => i.pointsEarned <= 0).length ?? 0;
  const sebagian =
    items?.filter((i) => i.pointsEarned > 0 && i.pointsEarned < i.points).length ?? 0;
  const tuntas = passingGrade != null && score != null ? score >= passingGrade : null;

  const submittedLabel = submittedAt
    ? "Dikerjakan " + formatAssignmentTime(submittedAt)
    : "Belum dikerjakan";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="rounded-md" disabled={disabled}>
          Lihat
        </Button>
      </DialogTrigger>
      <ResponsiveDialogContent className="@container" title={`${quizTitle} - ${studentName}`}>
        {/* Mobile layout: fully vertical */}
        <div className="space-y-4 p-4 sm:hidden">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Hasil Pengerjaan
            </div>
            <div className="mt-1 text-sm font-semibold">{studentName}</div>
            <div className="text-xs text-muted-foreground">{submittedLabel}</div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="text-sm font-semibold">Ringkasan Nilai</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Nilai Akhir</div>
                <div className="font-display text-2xl font-bold">{score ?? "-"}</div>
              </div>
              {tuntas != null && (
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs font-medium",
                    tuntas
                      ? "bg-primary-soft/60 text-primary"
                      : "bg-destructive/15 text-destructive",
                  )}
                >
                  {tuntas ? "Tuntas" : "Tidak Tuntas"}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">KKM</span>
              <span className="font-medium">{passingGrade ?? "-"}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/40 p-3 text-center">
              <div>
                <div className="text-xs text-muted-foreground">Benar</div>
                <div className="text-lg font-bold">{benar}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Benar Sebagian</div>
                <div className="text-lg font-bold">{sebagian}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Salah</div>
                <div className="text-lg font-bold">{salah}</div>
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="text-sm font-semibold">Review Hasil</div>
            {isPending && <p className="text-sm text-muted-foreground">Memuat...</p>}
            {error && (
              <div role="alert" className="space-y-2 text-sm">
                <p>{error}</p>
                <Button variant="outline" disabled={isPending} onClick={loadReview}>
                  Coba Lagi
                </Button>
              </div>
            )}
            {!isPending && items && items.length === 0 && (
              <p className="text-sm text-muted-foreground">Belum ada jawaban.</p>
            )}
            {!isPending &&
              items &&
              items.map((it) => (
                <div key={it.questionId} className="space-y-1.5 rounded-md border p-3 text-sm">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted-foreground">Pertanyaan :</div>
                      <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs">
                        {it.questionTypeLabel}
                      </span>
                    </div>
                    <p>{it.questionText}</p>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Jawaban Siswa :</div>
                    <p>{it.studentAnswerLabel}</p>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Jawaban Benar :</div>
                    <p>{it.correctAnswerLabel}</p>
                  </div>
                  {it.explanation && (
                    <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-2">
                      Pembahasan: {it.explanation}
                    </p>
                  )}
                  <div className="font-medium text-primary">
                    Skor : {it.pointsEarned}/{it.points} poin
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Desktop layout: 75:25 split */}
        <div className="hidden flex-1 grid-cols-4 overflow-hidden sm:grid">
          <div className="space-y-4 overflow-y-auto p-4 sm:col-span-3 sm:border-r">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Hasil Pengerjaan
              </div>
              <div className="mt-1 text-sm font-semibold">{studentName}</div>
              <div className="text-xs text-muted-foreground">{submittedLabel}</div>
            </div>

            <div className="space-y-2 border-t pt-4">
              <div className="text-sm font-semibold">Review Hasil</div>
              {isPending && <p className="text-sm text-muted-foreground">Memuat...</p>}
              {error && (
                <div role="alert" className="space-y-2 text-sm">
                  <p>{error}</p>
                  <Button variant="outline" disabled={isPending} onClick={loadReview}>
                    Coba Lagi
                  </Button>
                </div>
              )}
              {!isPending && items && items.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada jawaban.</p>
              )}
              {!isPending && items && items.length > 0 && (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full table-fixed text-sm">
                    <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="w-1/2 border-r p-2 text-left">Pertanyaan</th>
                        <th className="w-1/2 p-2 text-left">Jawaban</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.questionId} className="border-b align-top last:border-0">
                          <td className="space-y-1.5 border-r p-2">
                            <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs">
                              {it.questionTypeLabel}
                            </span>
                            <p className="text-sm">{it.questionText}</p>
                          </td>
                          <td className="space-y-1 p-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Jawaban Siswa: </span>
                              {it.studentAnswerLabel}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Jawaban Benar: </span>
                              {it.correctAnswerLabel}
                            </div>
                            {it.explanation && (
                              <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-2">
                                Pembahasan: {it.explanation}
                              </p>
                            )}
                            <div className="font-medium text-primary">
                              Skor: {it.pointsEarned}/{it.points} poin
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="overflow-y-auto p-4 sm:col-span-1">
            <div className="text-sm font-semibold">Ringkasan Nilai</div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-xs text-muted-foreground">Nilai Akhir</div>
                <div className="font-display text-2xl font-bold @sm:text-3xl">{score ?? "-"}</div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">KKM</span>
                <span className="font-medium">{passingGrade ?? "-"}</span>
              </div>
              {tuntas != null && (
                <span
                  className={cn(
                    "inline-block rounded-md px-2 py-0.5 text-xs font-medium",
                    tuntas
                      ? "bg-primary-soft/60 text-primary"
                      : "bg-destructive/15 text-destructive",
                  )}
                >
                  {tuntas ? "Tuntas" : "Tidak Tuntas"}
                </span>
              )}
              <div className="space-y-1.5 border-t pt-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Benar</span>
                  <span className="font-medium">{benar}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Benar Sebagian</span>
                  <span className="font-medium">{sebagian}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Salah</span>
                  <span className="font-medium">{salah}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ResponsiveDialogContent>
    </Dialog>
  );
}
