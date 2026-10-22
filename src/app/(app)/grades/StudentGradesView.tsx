"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import type { StudentGradeContext, StudentSubjectGrade } from "@/lib/data/gradebook";

export function StudentGradesView({
  subjects,
  context,
}: {
  subjects: StudentSubjectGrade[];
  context: StudentGradeContext | null;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        icon="🏆"
        title="Nilai Saya"
        subtitle="Pantau capaian nilai kamu di setiap mata pelajaran, lengkap dengan rincian per Tujuan Pembelajaran (TP)."
      />

      {context && (
        <div className="rounded-2xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{context.className}</span>
          <span> · {context.periodLabel}</span>
          <p className="mt-1 text-xs">
            Nilai sementara dihitung dari aktivitas dan TP yang sudah masuk penilaian. Nilai final
            ditampilkan setelah Buku Nilai dikunci oleh guru.
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 md:items-start">
        {subjects.map((s) => (
          <SubjectGradeCard key={s.subjectId} subject={s} />
        ))}
        {subjects.length === 0 && (
          <Card className="rounded-3xl border-0 p-10 text-center shadow-soft md:col-span-2">
            <p className="text-sm text-muted-foreground">
              {context
                ? "Belum ada mata pelajaran yang tersedia untuk kelasmu."
                : "Kamu belum ditempatkan pada kelas di tahun ajaran aktif."}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function SubjectGradeCard({ subject: s }: { subject: StudentSubjectGrade }) {
  const [expanded, setExpanded] = useState(false);
  const gradedTpCount = s.tpGrades.filter((tp) => tp.average != null).length;
  const totalTpCount = s.tpGrades.length;
  const hasNoTp = totalTpCount === 0;

  return (
    <Card className="rounded-3xl border-0 p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl"
          style={{
            backgroundColor: `color-mix(in oklch, ${
              s.subjectColor ?? "oklch(0.7 0.1 150)"
            } 20%, white)`,
          }}
        >
          {s.subjectEmoji ?? "📘"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-bold">{s.subjectName}</div>
          {s.overallAverage != null ? (
            <div className="text-sm text-muted-foreground">
              Rata-rata: {s.overallAverage}{" "}
              <span className="text-xs italic">{s.isLocked ? "(Final)" : "(Sementara)"}</span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Belum ada penilaian tersedia</div>
          )}
        </div>
      </div>

      {!expanded && !hasNoTp && (
        <p className="mt-3 text-xs font-medium text-muted-foreground">
          {gradedTpCount} dari {totalTpCount} TP sudah dinilai
        </p>
      )}

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-4 space-y-2 border-t pt-4">
            {s.tpGrades.length > 0 ? (
              s.tpGrades.map((tp, index) => (
                <div
                  key={tp.tpId}
                  className="flex items-start justify-between gap-4 rounded-2xl bg-muted/40 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 text-muted-foreground">
                    {formatTpTitle(tp.tpTitle, index)}
                  </span>
                  <span
                    className={`shrink-0 font-semibold ${
                      tp.average == null ? "text-muted-foreground" : "font-display text-primary"
                    }`}
                  >
                    {tp.average ?? "Belum Dinilai"}
                  </span>
                </div>
              ))
            ) : (
              <p className="rounded-2xl bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                Belum ada penilaian tersedia.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Sembunyikan" : "Ringkasan TP"}
        </button>
        <Button asChild size="sm" variant="outline" className="rounded-xl">
          <Link href={`/grades/${s.subjectId}`}>Rincian Nilai</Link>
        </Button>
      </div>
    </Card>
  );
}

function formatTpTitle(title: string, index: number) {
  const trimmed = title.trim();
  return /^tp\s*\d+/i.test(trimmed) ? trimmed : `TP ${index + 1}: ${trimmed}`;
}
