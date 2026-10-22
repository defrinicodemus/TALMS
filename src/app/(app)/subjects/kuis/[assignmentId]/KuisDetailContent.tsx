"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatAssignmentTime } from "@/lib/assignmentConstants";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  AssignmentContentRow,
  StudentQuizData,
  StudentQuizQuestion,
} from "@/lib/data/subjects";
import { fetchQuizForStudent, submitQuizAnswers } from "../../actions";

function DragDropAnswer({
  question,
  answer,
  onSelect,
  onClear,
}: {
  question: StudentQuizQuestion;
  answer: Record<string, string>;
  onSelect: (dragId: string, targetId: string) => void;
  onClear: (dragId: string) => void;
}) {
  const [selectedDragId, setSelectedDragId] = useState<string | null>(null);
  const matchedTargetIds = new Set(Object.values(answer));

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        {question.dragBlocks.map((b) => {
          const isMatched = !!answer[b.id];
          const isSelected = selectedDragId === b.id;
          return (
            <div key={b.id} className="space-y-1">
              <button
                type="button"
                onClick={() => setSelectedDragId(b.id)}
                className={cn(
                  "w-full rounded-xl border p-2.5 text-left text-sm transition",
                  isSelected && "border-primary bg-primary-soft/30",
                  isMatched && !isSelected && "border-emerald-400 bg-emerald-50",
                )}
              >
                {b.text}
                {isMatched && (
                  <span className="ml-1.5 text-xs text-emerald-600">
                    → {question.targetBlocks.find((t) => t.id === answer[b.id])?.text}
                  </span>
                )}
              </button>
              {isMatched && (
                <button
                  type="button"
                  className="px-1 text-xs text-muted-foreground underline"
                  onClick={() => onClear(b.id)}
                >
                  Lepas pasangan {b.text}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        {question.targetBlocks.map((t) => {
          const isUsed = matchedTargetIds.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              disabled={!selectedDragId || isUsed}
              title={isUsed ? "Sudah dipasangkan. Lepas pasangan terlebih dahulu." : undefined}
              onClick={() => {
                if (selectedDragId) {
                  onSelect(selectedDragId, t.id);
                  setSelectedDragId(null);
                }
              }}
              className={cn(
                "w-full rounded-xl border p-2.5 text-left text-sm transition disabled:opacity-50",
                isUsed && "border-emerald-400 bg-emerald-50",
              )}
            >
              {t.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function KuisDetailContent({ assignment: a }: { assignment: AssignmentContentRow }) {
  const [data, setData] = useState<StudentQuizData | null>(null);
  const [mcAnswers, setMcAnswers] = useState<Record<string, string>>({});
  const [tfAnswers, setTfAnswers] = useState<Record<string, "benar" | "salah">>({});
  const [ddAnswers, setDdAnswers] = useState<Record<string, Record<string, string>>>({});
  const [seqOrder, setSeqOrder] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();

  const router = useRouter();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [seqConfirmed, setSeqConfirmed] = useState<Record<string, boolean>>({});
  const [sequenceTouched, setSequenceTouched] = useState(false);
  const [expired, setExpired] = useState(
    () => !!a.dueAt && new Date(a.dueAt).getTime() <= Date.now(),
  );
  const dueAt = data?.dueAt ?? a.dueAt;
  const locked = !(data?.isActive ?? a.isActive) || expired;
  const dirty =
    !data?.alreadySubmitted &&
    (Object.keys(mcAnswers).length > 0 ||
      Object.keys(tfAnswers).length > 0 ||
      Object.keys(ddAnswers).length > 0 ||
      sequenceTouched ||
      Object.values(seqConfirmed).some(Boolean));

  useEffect(() => {
    if (data?.alreadySubmitted) return;
    const check = () => setExpired(!!dueAt && new Date(dueAt).getTime() <= Date.now());
    check();
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [data?.alreadySubmitted, dueAt]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const url = new URL(anchor.href);
      if (
        url.origin !== window.location.origin ||
        (url.pathname === window.location.pathname && url.search === window.location.search)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveHref(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchQuizForStudent(a.id)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setLoadError("Kuis tidak tersedia untuk kelasmu pada tahun ajaran aktif.");
          return;
        }
        setData(result);
        const initialSeq: Record<string, string[]> = {};
        for (const q of result.questions) {
          if (q.questionType === "sequence") initialSeq[q.id] = q.steps.map((s) => s.id);
        }
        setSeqOrder((previous) => (Object.keys(previous).length ? previous : initialSeq));
      })
      .catch(() => {
        if (!cancelled) setLoadError("Soal belum dapat dimuat. Periksa koneksi lalu coba lagi.");
      });
    return () => {
      cancelled = true;
    };
  }, [a.id, reload]);

  function moveSeqStep(questionId: string, index: number, direction: "up" | "down") {
    setSequenceTouched(true);
    setSeqConfirmed((previous) => ({ ...previous, [questionId]: false }));
    setSeqOrder((prev) => {
      const order = prev[questionId] ? [...prev[questionId]] : [];
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= order.length) return prev;
      [order[index], order[swapWith]] = [order[swapWith], order[index]];
      return { ...prev, [questionId]: order };
    });
  }

  function selectDragTarget(questionId: string, dragId: string, targetId: string) {
    setDdAnswers((prev) => ({
      ...prev,
      [questionId]: { ...(prev[questionId] ?? {}), [dragId]: targetId },
    }));
  }

  function handleSubmit() {
    if (!data || isPending || locked || !allAnswered) return;
    setConfirmOpen(false);
    const payload = data.questions.map((q) => ({
      questionId: q.id,
      selectedOptionId: q.questionType === "multiple_choice" ? mcAnswers[q.id] : undefined,
      trueFalseAnswer: q.questionType === "true_false" ? tfAnswers[q.id] : undefined,
      dragDropAnswer: q.questionType === "drag_and_drop" ? ddAnswers[q.id] : undefined,
      sequenceAnswer: q.questionType === "sequence" ? seqOrder[q.id] : undefined,
    }));
    startTransition(async () => {
      try {
        const result = await submitQuizAnswers(a.id, payload);
        if (result.ok) {
          toast.success(result.message);
          router.refresh();
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  alreadySubmitted: true,
                  score: result.score ?? null,
                  submittedAt: result.submittedAt ?? null,
                }
              : prev,
          );
          const refreshed = await fetchQuizForStudent(a.id).catch(() => null);
          if (refreshed?.alreadySubmitted) setData(refreshed);
        } else {
          toast.error(result.message);
        }
      } catch {
        toast.error(
          "Pengiriman belum dapat dikonfirmasi. Jawaban tetap tersedia; periksa status pengumpulan sebelum mencoba lagi.",
        );
      }
    });
  }

  if (data && !data.alreadySubmitted && locked && !data.questions.length) {
    return (
      <div className="rounded-3xl border-0 bg-card p-6 shadow-soft">
        <div className="rounded-2xl bg-muted/40 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {!data.isActive
              ? "Kuis ini sedang dinonaktifkan oleh guru dan tidak bisa dikerjakan."
              : "Waktu pengerjaan kuis ini sudah berakhir."}
          </p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => setReload((value) => value + 1)}
          >
            Periksa Kuis Lagi
          </Button>
        </div>
      </div>
    );
  }

  if (data?.alreadySubmitted) {
    return (
      <div className="rounded-3xl border-0 bg-card p-6 shadow-soft">
        <div className="rounded-2xl bg-primary-soft/40 p-6 text-center">
          <div className="text-3xl">🎉</div>
          <div className="mt-2 font-display text-2xl font-bold text-primary">
            ✨ Nilai: {data.score}/100
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Jawaban kuis sudah tersimpan dan tidak dapat diubah.
          </p>
          {data.submittedAt && (
            <p className="mt-2 text-sm">Dikumpulkan: {formatAssignmentTime(data.submittedAt)}</p>
          )}
          {data.passingGrade != null && data.score != null && (
            <p className="mt-2 text-sm font-medium">
              {data.score >= data.passingGrade ? "Tuntas" : "Belum tuntas"} - KKM{" "}
              {data.passingGrade}
            </p>
          )}
        </div>
        <section aria-label="Pembahasan kuis" className="mt-5 space-y-3">
          <h2 className="font-display text-lg font-bold">Jawaban dan Pembahasan</h2>
          {data.review?.map((item, index) => (
            <article key={item.questionId} className="space-y-2 rounded-xl border p-4 text-sm">
              <h3 className="font-semibold">
                {index + 1}. {item.questionText}
              </h3>
              <p className="text-xs text-muted-foreground">
                {item.questionTypeLabel} · {item.pointsEarned}/{item.points} poin
              </p>
              <p>
                <strong>Jawabanmu: </strong>
                {item.studentAnswerLabel}
              </p>
              <p>
                <strong>Jawaban benar: </strong>
                {item.correctAnswerLabel}
              </p>
              {item.explanation && (
                <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3">
                  <strong>Pembahasan: </strong>
                  {item.explanation}
                </p>
              )}
            </article>
          ))}
          {data.review === null && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Nilai sudah tersimpan. Pembahasan belum berhasil dimuat.
              </p>
              <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
                Muat Pembahasan
              </Button>
            </div>
          )}
          {data.review?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Rincian jawaban belum tersedia untuk pengumpulan ini.
            </p>
          )}
          {loadError && (
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
          )}
        </section>
      </div>
    );
  }

  if (loadError)
    return (
      <div role="alert" className="space-y-3 rounded-2xl bg-card p-6 shadow-soft">
        <p>{loadError}</p>
        <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
          Coba Lagi
        </Button>
      </div>
    );
  if (!data) {
    return (
      <div className="rounded-3xl border-0 bg-card p-6 shadow-soft">
        <p className="text-sm text-muted-foreground">Memuat soal...</p>
      </div>
    );
  }

  const answered = data.questions.map((q) => {
    if (q.questionType === "multiple_choice") return !!mcAnswers[q.id];
    if (q.questionType === "true_false") return !!tfAnswers[q.id];
    if (q.questionType === "drag_and_drop") {
      const answered = ddAnswers[q.id] ?? {};
      return (
        q.dragBlocks.every((b) => answered[b.id]) &&
        new Set(Object.values(answered)).size === q.dragBlocks.length
      );
    }
    if (q.questionType === "sequence")
      return !!seqConfirmed[q.id] && (seqOrder[q.id]?.length ?? 0) === q.steps.length;
    return false;
  });
  const answeredCount = answered.filter(Boolean).length;
  const allAnswered = data.questions.length > 0 && answeredCount === data.questions.length;

  return (
    <div className="space-y-4 rounded-3xl border-0 bg-card p-6 shadow-soft">
      <section aria-label="Instruksi kuis" className="space-y-3">
        {a.learningObjectiveTitle && (
          <div className="rounded-xl border bg-primary-soft/20 p-4">
            <h2 className="font-semibold">Tujuan Pembelajaran</h2>
            <p className="mt-1 text-sm">{a.learningObjectiveTitle}</p>
          </div>
        )}
        <h2 className="font-display text-lg font-bold">Instruksi Kuis</h2>
        {a.description ? (
          <div
            className="rich-text-content break-words text-sm"
            dangerouslySetInnerHTML={{ __html: a.description }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Jawab seluruh soal, lalu periksa kembali sebelum mengumpulkan.
          </p>
        )}
        <p className="text-sm">
          <strong>Tenggat: </strong>
          {formatAssignmentTime(dueAt)}
        </p>
        <p className="text-sm text-muted-foreground">
          Kuis hanya dapat dikumpulkan satu kali. Jawaban belum tersimpan sebelum dikirim; jangan
          muat ulang halaman saat mengerjakan.
        </p>
      </section>
      {locked && (
        <p role="alert" className="rounded-xl bg-muted p-3 text-sm">
          Kuis tidak aktif atau tenggat sudah berakhir. Jawaban belum terkirim dan pengumpulan
          ditutup.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {data.questions.length} Soal
        {data.timerMinutes ? ` · ⏱ Estimasi: ${data.timerMinutes} Menit` : ""}
      </p>
      <nav aria-label="Progres jawaban" className="space-y-2 rounded-xl bg-muted/40 p-3">
        <p role="status" className="text-sm font-medium">
          {answeredCount} dari {data.questions.length} soal terjawab
        </p>
        <div className="flex flex-wrap gap-2">
          {data.questions.map((q, i) => (
            <button
              key={q.id}
              type="button"
              className={cn(
                "h-9 min-w-9 rounded-lg border px-2 text-sm",
                answered[i] && "bg-primary text-primary-foreground",
              )}
              aria-label={"Soal " + (i + 1) + (answered[i] ? ", sudah dijawab" : ", belum dijawab")}
              onClick={() =>
                document
                  .getElementById("question-" + q.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" })
              }
            >
              {i + 1}
            </button>
          ))}
        </div>
      </nav>
      {!data.questions.length && (
        <p role="alert" className="text-sm">
          Soal belum tersedia. Hubungi guru untuk memeriksa kuis ini.
        </p>
      )}
      <fieldset disabled={isPending || locked} className="space-y-4 disabled:opacity-70">
        {data.questions.map((q, i) => (
          <div key={q.id} id={"question-" + q.id} className="scroll-mt-20 rounded-2xl border p-4">
            <div className="font-medium">
              {i + 1}. {q.questionText}
            </div>

            {q.questionType === "multiple_choice" && (
              <div className="mt-3 space-y-2">
                {q.options.map((o) => (
                  <label
                    key={o.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-sm transition",
                      mcAnswers[q.id] === o.id && "border-primary bg-primary-soft/30",
                    )}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      checked={mcAnswers[q.id] === o.id}
                      onChange={() => setMcAnswers((prev) => ({ ...prev, [q.id]: o.id }))}
                    />
                    {o.text}
                  </label>
                ))}
              </div>
            )}

            {q.questionType === "true_false" && (
              <div className="mt-3 flex gap-2">
                {(["benar", "salah"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setTfAnswers((prev) => ({ ...prev, [q.id]: v }))}
                    className={cn(
                      "flex-1 rounded-xl border p-2.5 text-sm font-medium transition",
                      tfAnswers[q.id] === v
                        ? "border-primary bg-primary-soft/30 text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {v === "benar" ? "Benar" : "Salah"}
                  </button>
                ))}
              </div>
            )}

            {q.questionType === "drag_and_drop" && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Ketuk satu blok kiri, lalu ketuk pasangannya di kanan.
                </p>
                <DragDropAnswer
                  question={q}
                  answer={ddAnswers[q.id] ?? {}}
                  onSelect={(dragId, targetId) => selectDragTarget(q.id, dragId, targetId)}
                  onClear={(dragId) =>
                    setDdAnswers((previous) => {
                      const next = { ...(previous[q.id] ?? {}) };
                      delete next[dragId];
                      return { ...previous, [q.id]: next };
                    })
                  }
                />
              </div>
            )}

            {q.questionType === "sequence" && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Urutkan langkah dengan tombol panah di bawah ini.
                </p>
                {(seqOrder[q.id] ?? []).map((stepId, idx) => {
                  const step = q.steps.find((s) => s.id === stepId);
                  if (!step) return null;
                  return (
                    <div
                      key={stepId}
                      className="flex items-center gap-2 rounded-xl border p-2.5 text-sm"
                    >
                      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft/50 text-xs font-bold">
                        {idx + 1}
                      </div>
                      <span className="flex-1">{step.text}</span>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveSeqStep(q.id, idx, "up")}
                          className="grid h-7 w-7 place-items-center rounded-lg border disabled:opacity-30"
                          aria-label="Pindah ke atas"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={idx === (seqOrder[q.id]?.length ?? 0) - 1}
                          onClick={() => moveSeqStep(q.id, idx, "down")}
                          className="grid h-7 w-7 place-items-center rounded-lg border disabled:opacity-30"
                          aria-label="Pindah ke bawah"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  );
                })}
                <label className="flex items-center gap-2 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!seqConfirmed[q.id]}
                    onChange={(event) =>
                      setSeqConfirmed((previous) => ({ ...previous, [q.id]: event.target.checked }))
                    }
                  />
                  Urutan sudah sesuai
                </label>
              </div>
            )}
          </div>
        ))}
      </fieldset>
      <Button
        className="w-full rounded-xl"
        disabled={!allAnswered || isPending || locked}
        onClick={() => setConfirmOpen(true)}
      >
        {isPending ? "Mengirim..." : "Kirim Jawaban"}
      </Button>
      {isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Sedang menyimpan jawaban. Tunggu konfirmasi sebelum meninggalkan halaman.
        </p>
      )}
      <Button
        variant="ghost"
        disabled={isPending}
        onClick={async () => {
          try {
            const result = await fetchQuizForStudent(a.id);
            if (result?.alreadySubmitted) {
              setData(result);
              router.refresh();
            } else
              toast.info(
                "Belum ada pengumpulan yang tersimpan. Jawabanmu tetap tersedia di halaman ini.",
              );
          } catch {
            toast.error("Status pengumpulan belum dapat diperiksa. Coba lagi.");
          }
        }}
      >
        Periksa Status Pengumpulan
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kirim jawaban kuis?</AlertDialogTitle>
            <AlertDialogDescription>
              {answeredCount} dari {data.questions.length} soal telah dijawab. Setelah dikirim,
              jawaban tidak dapat diubah.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Periksa Lagi</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || locked || !allAnswered}
              onClick={handleSubmit}
            >
              Ya, Kirim Jawaban
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!leaveHref}
        onOpenChange={(open) => {
          if (!open) setLeaveHref(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tinggalkan kuis?</AlertDialogTitle>
            <AlertDialogDescription>
              Jawaban belum dikumpulkan dan akan hilang jika kamu meninggalkan halaman ini.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tetap Mengerjakan</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => {
                if (leaveHref) router.push(leaveHref);
              }}
            >
              Tinggalkan Halaman
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
