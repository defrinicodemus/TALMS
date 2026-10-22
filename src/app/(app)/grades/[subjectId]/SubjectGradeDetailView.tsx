"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  StudentGradeActivityRow,
  StudentGradeContext,
  StudentSubjectGradeDetail,
  TpGradeDetail,
} from "@/lib/data/gradebook";

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function SubjectGradeDetailView({
  detail,
  context,
}: {
  detail: StudentSubjectGradeDetail;
  context: StudentGradeContext | null;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={detail.subjectEmoji ?? "📘"}
        title={detail.subjectName}
        subtitle={
          context
            ? `${context.className} · ${context.periodLabel}`
            : "Lihat perkembangan hasil belajarmu berdasarkan Tujuan Pembelajaran (TP)."
        }
        action={
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/grades">← Kembali</Link>
          </Button>
        }
      />

      <div className="flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
        <SummaryCard
          emoji="📊"
          value={detail.overallAverage ?? undefined}
          label="Rata-rata Mata Pelajaran"
          caption={
            detail.overallAverage != null ? (detail.isLocked ? "Final" : "Sementara") : undefined
          }
        />
        <SummaryCard
          emoji="📋"
          value={
            detail.totalActivityCount > 0
              ? `${detail.includedActivityCount}/${detail.totalActivityCount}`
              : undefined
          }
          label="Aktivitas Masuk Nilai"
          caption={
            detail.includedActivityCount > 0
              ? `${detail.gradedActivityCount} dinilai · ${detail.missedActivityCount} tidak dikumpulkan`
              : undefined
          }
        />
        <HighestScoreCard
          highestScore={detail.highestScore}
          highestScoreCount={detail.highestScoreCount}
        />
      </div>

      <div className="rounded-2xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          {detail.assessedTpCount} dari {detail.totalTpCount} TP memiliki nilai.
        </span>{" "}
        {detail.isLocked
          ? "Nilai akhir sudah dikunci oleh guru."
          : "Nilai masih sementara dan dapat berubah sampai Buku Nilai dikunci."}
        {(detail.waitingActivityCount > 0 || detail.openActivityCount > 0) && (
          <span>
            {` ${detail.waitingActivityCount} aktivitas menunggu penilaian dan ${detail.openActivityCount} masih terbuka.`}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {detail.tpDetails.map((tp) => (
          <TpCard key={tp.tpId} tp={tp} />
        ))}
        {detail.tpDetails.length === 0 && (
          <Card className="rounded-3xl border-0 p-10 text-center shadow-soft">
            <p className="text-sm text-muted-foreground">
              Belum ada Tujuan Pembelajaran (TP) yang terdaftar untuk mata pelajaran ini.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  emoji,
  value,
  label,
  caption,
}: {
  emoji: string;
  value?: string | number;
  label: string;
  caption?: string;
}) {
  return (
    <Card className="aspect-square w-32 shrink-0 rounded-2xl border-0 p-4 shadow-soft md:aspect-auto md:w-auto md:p-5">
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft/60 text-base text-primary">
          {emoji}
        </div>
        {value == null ? (
          <div className="text-sm font-medium text-muted-foreground">Belum ada {label}</div>
        ) : (
          <>
            <div className="font-display text-2xl font-bold">{value}</div>
            <div className="text-xs font-medium text-muted-foreground">
              {label}
              {caption && <span className="italic"> ({caption})</span>}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function HighestScoreCard({
  highestScore,
  highestScoreCount,
}: {
  highestScore: number | null;
  highestScoreCount: number;
}) {
  return (
    <Card className="aspect-square w-32 shrink-0 rounded-2xl border-0 p-4 shadow-soft md:aspect-auto md:w-auto md:p-5">
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft/60 text-base text-primary">
          🏅
        </div>
        {highestScore == null ? (
          <div className="text-sm font-medium text-muted-foreground">
            Belum ada nilai yang dapat dibandingkan
          </div>
        ) : highestScoreCount > 1 ? (
          <>
            <div className="font-display text-2xl font-bold">{highestScore}</div>
            <div className="text-xs font-medium text-muted-foreground">
              {highestScore === 100
                ? `Nilai sempurna diraih ${highestScoreCount} kali ⭐`
                : `Nilai tertinggi diraih ${highestScoreCount} kali`}
            </div>
          </>
        ) : (
          <>
            <div className="font-display text-2xl font-bold">{highestScore}</div>
            <div className="text-xs font-medium text-muted-foreground">
              {highestScore === 100 ? "Nilai sempurna ⭐" : "Nilai tertinggi"}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function TpCard({ tp }: { tp: TpGradeDetail }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="rounded-3xl border-0 p-6 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 font-display text-sm font-bold md:text-lg">{tp.tpTitle}</div>
        {tp.average != null ? (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-display text-base font-bold text-emerald-700">
              {tp.average}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">Rata-rata</span>
          </div>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            Belum Dinilai
          </span>
        )}
      </div>

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-4 space-y-2 border-t pt-4">
            {tp.activities.length > 0 ? (
              tp.activities.map((activity) => {
                const presentation = activityPresentation(activity);
                return (
                  <div
                    key={activity.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/40 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{activity.title}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            activity.kind === "kuis"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {activity.kind === "kuis" ? "Kuis" : "Tugas"}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${presentation.badgeClass}`}
                        >
                          {presentation.label}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {presentation.description}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="min-w-8 text-right font-display text-lg font-bold text-primary">
                        {activity.score ?? "—"}
                      </div>
                      <Button asChild size="sm" variant="outline" className="rounded-xl">
                        <Link
                          href={
                            activity.kind === "kuis"
                              ? `/subjects/kuis/${activity.id}`
                              : `/subjects/tugas/${activity.id}`
                          }
                        >
                          Lihat
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="rounded-2xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                Belum ada aktivitas yang dinilai untuk TP ini.
              </p>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
        {expanded ? "Sembunyikan" : "Lihat Aktivitas"}
      </button>
    </Card>
  );
}

function activityPresentation(activity: StudentGradeActivityRow) {
  if (activity.status === "graded") {
    return {
      label: "Sudah Dinilai",
      badgeClass: "bg-emerald-100 text-emerald-700",
      description: `Dinilai ${formatDate(activity.gradedAt)}`,
    };
  }
  if (activity.status === "missed") {
    return {
      label: "Tidak Dikumpulkan",
      badgeClass: "bg-red-100 text-red-700",
      description: "Tidak dikumpulkan sampai tenggat · Nilai 0",
    };
  }
  if (activity.status === "waiting") {
    return {
      label: "Menunggu Penilaian",
      badgeClass: "bg-amber-100 text-amber-700",
      description: "Jawaban sudah dikumpulkan dan menunggu penilaian guru",
    };
  }
  return {
    label: "Belum Dikerjakan",
    badgeClass: "bg-muted text-muted-foreground",
    description: `Tenggat ${formatDate(activity.dueAt)}`,
  };
}
