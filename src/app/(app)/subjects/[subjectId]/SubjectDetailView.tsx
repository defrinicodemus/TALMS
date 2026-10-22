"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  Video,
  BookOpen,
  Image as ImageIcon,
  HelpCircle,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import type { AssignmentContentRow, MaterialContentRow } from "@/lib/data/subjects";
import { formatAssignmentTime } from "@/lib/assignmentConstants";
import { ExpandableCardList } from "../ExpandableCardList";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<string, LucideIcon> = {
  pdf: FileText,
  video: Video,
  text: BookOpen,
  image: ImageIcon,
  slideshow: Presentation,
};
const KIND_LABEL: Record<string, string> = {
  pdf: "PDF",
  video: "YouTube",
  text: "Teks",
  image: "Gambar",
  slideshow: "Slideshow",
};

const TUGAS_STATUS_LABEL: Record<string, string> = {
  belum: "Belum Dikerjakan",
  dikerjakan: "Sedang Dikerjakan",
  submitted: "Sudah Dikirim",
  graded: "Selesai",
};
const TUGAS_STATUS_STYLE: Record<string, string> = {
  belum: "bg-red-100 text-red-700",
  dikerjakan: "bg-blue-100 text-blue-700",
  submitted: "bg-amber-100 text-amber-700",
  graded: "bg-emerald-100 text-emerald-700",
};
const TUGAS_STATUS_EMOJI: Record<string, string> = {
  belum: "🔴",
  dikerjakan: "🔵",
  submitted: "🟡",
  graded: "🟢",
};

const LIST_ROW =
  "flex flex-col gap-3 rounded-3xl border-0 bg-card p-4 shadow-soft transition hover:shadow-glow sm:flex-row sm:items-center";

export function SubjectDetailView({
  initialTab,
  materials,
  tugas,
  kuis,
}: {
  initialTab: "materi" | "tugas" | "kuis";
  materials: MaterialContentRow[];
  tugas: AssignmentContentRow[];
  kuis: AssignmentContentRow[];
}) {
  return (
    <Tabs defaultValue={initialTab}>
      <TabsList className="rounded-2xl bg-muted p-1">
        <TabsTrigger value="materi" className="rounded-xl">
          📚 Materi
        </TabsTrigger>
        <TabsTrigger value="tugas" className="rounded-xl">
          📝 Tugas
        </TabsTrigger>
        <TabsTrigger value="kuis" className="rounded-xl">
          ❓ Kuis
        </TabsTrigger>
      </TabsList>
      <TabsContent value="materi" className="mt-4">
        <ExpandableCardList
          items={materials}
          keyOf={(m) => m.id}
          renderItem={(m) => <MaterialCard material={m} />}
          labelMore="🔽 Lihat Materi Lainnya"
          labelLess="🔼 Sembunyikan"
          emptyMessage="Belum ada materi."
        />
      </TabsContent>
      <TabsContent value="tugas" className="mt-4">
        <ExpandableCardList
          items={tugas}
          keyOf={(a) => a.id}
          renderItem={(a) => <TugasCard assignment={a} />}
          labelMore="🔽 Lihat Tugas Sebelumnya"
          labelLess="🔼 Sembunyikan"
          emptyMessage="Belum ada tugas."
        />
      </TabsContent>
      <TabsContent value="kuis" className="mt-4">
        <ExpandableCardList
          items={kuis}
          keyOf={(a) => a.id}
          renderItem={(a) => <KuisCard assignment={a} />}
          labelMore="🔽 Lihat Kuis Sebelumnya"
          labelLess="🔼 Sembunyikan"
          emptyMessage="Belum ada kuis."
        />
      </TabsContent>
    </Tabs>
  );
}

function MaterialCard({ material: m }: { material: MaterialContentRow }) {
  const Icon = KIND_ICON[m.kind] ?? FileText;

  return (
    <div className={LIST_ROW}>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary-soft/60 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate font-semibold">{m.title}</div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
              m.viewed ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground",
            )}
          >
            {m.viewed ? "🟢 Sudah Dibaca" : "⚪ Belum Dibaca"}
          </span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {m.learningObjectiveTitle
            ? `Capaian: ${m.learningObjectiveTitle}`
            : (KIND_LABEL[m.kind] ?? m.kind)}
        </div>
      </div>
      <Button asChild variant="outline" className="w-full shrink-0 rounded-xl sm:w-auto">
        <Link href={`/subjects/materi/${m.id}`}>Lihat Detail</Link>
      </Button>
    </div>
  );
}

function TugasCard({ assignment: a }: { assignment: AssignmentContentRow }) {
  return (
    <div className={LIST_ROW}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate font-semibold">{a.title}</div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
              TUGAS_STATUS_STYLE[a.status],
            )}
          >
            {TUGAS_STATUS_EMOJI[a.status]} {TUGAS_STATUS_LABEL[a.status]}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Tenggat: {formatAssignmentTime(a.dueAt)}
        </div>
        {a.status === "graded" && a.score != null ? (
          <div className="mt-0.5 font-display text-sm font-bold text-primary">
            ✨ Nilai: {a.score}/100
          </div>
        ) : (
          a.learningObjectiveTitle && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              TP: {a.learningObjectiveTitle}
            </div>
          )
        )}
      </div>
      <Button asChild variant="outline" className="w-full shrink-0 rounded-xl sm:w-auto">
        <Link href={`/subjects/tugas/${a.id}`}>Lihat Detail</Link>
      </Button>
    </div>
  );
}

function KuisCard({ assignment: a }: { assignment: AssignmentContentRow }) {
  const done = a.status === "graded";

  let badgeLabel = "🔴 Belum Dikerjakan";
  let badgeClass = "bg-red-100 text-red-700";
  if (done) {
    badgeLabel = "🟢 Selesai";
    badgeClass = "bg-emerald-100 text-emerald-700";
  } else if (a.quizStatus === "nonaktif") {
    badgeLabel = "⚪ Nonaktif";
    badgeClass = "bg-zinc-200 text-zinc-700";
  } else if (a.quizStatus === "selesai") {
    badgeLabel = "🔵 Waktu Habis";
    badgeClass = "bg-blue-100 text-blue-700";
  }

  return (
    <div className={LIST_ROW}>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary-soft/60 text-primary">
        <HelpCircle className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate font-semibold">{a.title}</div>
          <span
            className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", badgeClass)}
          >
            {badgeLabel}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">📝 {a.questionCount} Soal</div>
        {done && a.score != null ? (
          <div className="mt-0.5 font-display text-sm font-bold text-primary">
            ✨ Nilai: {a.score}/100
          </div>
        ) : (
          a.learningObjectiveTitle && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              Capaian: {a.learningObjectiveTitle}
            </div>
          )
        )}
      </div>
      <Button asChild variant="outline" className="w-full shrink-0 rounded-xl sm:w-auto">
        <Link href={`/subjects/kuis/${a.id}`}>Lihat Detail</Link>
      </Button>
    </div>
  );
}
