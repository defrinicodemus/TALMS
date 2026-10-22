"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Megaphone, BookOpen, ArrowRight, ChevronRight } from "lucide-react";
import type { getStudentDashboardData } from "@/lib/data/dashboard";
import { formatAssignmentTime } from "@/lib/assignmentConstants";

type Data = Awaited<ReturnType<typeof getStudentDashboardData>>;
type ActivityFilter = "all" | "task" | "quiz";

const LEARNING_TYPE_STYLES = {
  mapel: { badge: "bg-teal-100 text-teal-700" },
  materi: {
    soft: "bg-blue-50 text-blue-700",
    badge: "bg-blue-100 text-blue-700",
    bar: "bg-blue-500",
  },
  tugas: {
    soft: "bg-amber-50 text-amber-700",
    badge: "bg-amber-100 text-amber-700",
    bar: "bg-amber-500",
  },
  kuis: {
    soft: "bg-purple-50 text-purple-700",
    badge: "bg-purple-100 text-purple-700",
    bar: "bg-purple-500",
  },
};

export function StudentDashboard({ data }: { data: Data }) {
  const { user } = useAuth();
  const firstName = user?.name.split(" ")[0] ?? "";
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const activeActivitiesRef = useRef<HTMLDivElement>(null);

  const now = useMemo(() => new Date(), []);
  const dayLabel = now.toLocaleDateString("id-ID", { weekday: "long" });
  const dateLabel = now.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const hasActivity =
    data.pendingTugasCount > 0 || data.pendingKuisCount > 0 || data.newMaterialsCount > 0;
  const filteredActiveTasks = data.activeTasks.filter((activity) => {
    if (activityFilter === "quiz") return activity.kind === "quiz";
    if (activityFilter === "task") return activity.kind !== "quiz";
    return true;
  });
  const visibleActiveTasks = filteredActiveTasks.slice(0, 3);

  const showActivities = (filter: ActivityFilter) => {
    setActivityFilter(filter);
    window.requestAnimationFrame(() => {
      activeActivitiesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <Card className="relative overflow-hidden border-0 gradient-primary p-8 text-primary-foreground shadow-glow">
        <div className="absolute -right-6 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="font-display text-3xl font-bold md:text-4xl">
              Halo, {firstName}! {hasActivity ? "👋" : "🌟"}
            </h1>
            {hasActivity ? (
              <>
                <p className="mt-2 text-sm opacity-90">Selamat belajar hari ini.</p>
                <p className="mt-1 max-w-md text-sm opacity-90">
                  Ayo lanjutkan belajar dan capai targetmu hari ini!
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm opacity-90">
                  Hebat! Semua tugas dan kuis sudah selesai.
                </p>
                <p className="mt-1 max-w-md text-sm opacity-90">
                  Sekarang kamu bisa mempelajari materi baru atau menunggu aktivitas berikutnya.
                </p>
              </>
            )}
            <div className="mt-5 flex gap-3">
              <Button asChild size="lg" variant="secondary" className="rounded-xl">
                <Link href="/subjects">
                  Mulai Belajar <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-sm opacity-90">{dayLabel}</div>
            <div className="font-display text-lg font-bold">{dateLabel}</div>
          </div>
        </div>
      </Card>

      {/* Quick Info */}
      <div className="flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
        <QuickInfoCard
          emoji="📖"
          value={data.subjects.length}
          label="Mata Pelajaran"
          badgeClass={LEARNING_TYPE_STYLES.mapel.badge}
          href="/subjects"
        />
        <QuickInfoCard
          emoji="📝"
          value={data.pendingTugasCount}
          label="Tugas Aktif"
          badgeClass={LEARNING_TYPE_STYLES.tugas.badge}
          onClick={() => showActivities("task")}
          isActive={activityFilter === "task"}
        />
        <QuickInfoCard
          emoji="❓"
          value={data.pendingKuisCount}
          label="Kuis Aktif"
          badgeClass={LEARNING_TYPE_STYLES.kuis.badge}
          onClick={() => showActivities("quiz")}
          isActive={activityFilter === "quiz"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Subjects */}
        <Card className="rounded-3xl border-0 p-6 shadow-soft lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-bold">Mata Pelajaranmu</h2>
            <Link href="/subjects" className="text-xs font-medium text-primary hover:underline">
              Lihat semua →
            </Link>
          </div>
          {/* Mobile: horizontal-style list, 3 subjects */}
          <div className="space-y-2 sm:hidden">
            {data.subjects.slice(0, 3).map((s) => {
              const countLabel = subjectCountLabel(s);
              return (
                <Link
                  href={`/subjects/${s.id}`}
                  key={s.id}
                  className="flex items-center gap-3 rounded-2xl border bg-card p-3 transition hover:border-primary hover:shadow-soft"
                >
                  <div
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl"
                    style={{ backgroundColor: `color-mix(in oklch, ${s.color} 20%, white)` }}
                  >
                    {s.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{s.name}</div>
                    {countLabel && (
                      <div className="text-xs text-muted-foreground">{countLabel}</div>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>

          {/* Desktop/tablet: original icon-grid, each card gets a colored badge above it */}
          <div className="hidden gap-3 sm:grid sm:grid-cols-2 md:grid-cols-3">
            {data.subjects.slice(0, 6).map((s) => (
              <div key={s.id} className="flex flex-col gap-1.5">
                <span
                  className="w-fit rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                  style={{ backgroundColor: s.color }}
                >
                  {s.code}
                </span>
                <Link
                  href={`/subjects/${s.id}`}
                  className="group rounded-2xl border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary hover:shadow-soft"
                >
                  <div
                    className="grid h-12 w-12 place-items-center rounded-2xl text-2xl"
                    style={{ backgroundColor: `color-mix(in oklch, ${s.color} 20%, white)` }}
                  >
                    {s.emoji}
                  </div>
                  <div className="mt-3 font-semibold">{s.name}</div>
                </Link>
              </div>
            ))}
          </div>
        </Card>

        {/* Announcements: compact tap-through widget on mobile */}
        <Link
          href="/announcements"
          className="flex items-center gap-3 rounded-2xl bg-primary-soft/30 p-4 transition hover:bg-primary-soft/50 sm:hidden"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card text-primary shadow-soft">
            <Megaphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Pengumuman Sekolah</div>
            <p className="truncate text-xs text-muted-foreground">
              {data.announcements[0]?.title ?? "Belum ada pengumuman"}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>

        {/* Announcements: full card on desktop/tablet */}
        <Card className="hidden rounded-3xl border-0 p-6 shadow-soft sm:block">
          <div className="mb-4 flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            <h2 className="font-display text-xl font-bold">Pengumuman</h2>
          </div>
          <div className="space-y-3">
            {data.announcements.map((a) => (
              <div key={a.id} className="rounded-2xl bg-primary-soft/30 p-4">
                <div className="text-xs font-medium text-primary">
                  {new Date(a.created_at).toLocaleDateString("id-ID", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </div>
                <div className="mt-1 font-semibold">{a.title}</div>
              </div>
            ))}
          </div>
          <Button asChild variant="outline" className="mt-4 w-full rounded-xl">
            <Link href="/announcements">
              Lihat Semua Pengumuman <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </Card>
      </div>

      {/* Active tasks + Learning activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          ref={activeActivitiesRef}
          id="aktivitas-aktif"
          className="scroll-mt-20 rounded-3xl border-0 p-6 shadow-soft lg:col-span-2"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              <h2 className="font-display text-xl font-bold">Tugas dan Kuis Aktif</h2>
            </div>
            <div className="flex gap-1 rounded-xl bg-muted p-1" aria-label="Filter aktivitas aktif">
              <ActivityFilterButton
                active={activityFilter === "all"}
                onClick={() => setActivityFilter("all")}
              >
                Semua
              </ActivityFilterButton>
              <ActivityFilterButton
                active={activityFilter === "task"}
                onClick={() => setActivityFilter("task")}
              >
                Tugas
              </ActivityFilterButton>
              <ActivityFilterButton
                active={activityFilter === "quiz"}
                onClick={() => setActivityFilter("quiz")}
              >
                Kuis
              </ActivityFilterButton>
            </div>
          </div>
          <div className="space-y-3">
            {visibleActiveTasks.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-4 rounded-2xl border p-4">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-secondary text-xl">
                  {a.kind === "quiz" ? "❓" : "📌"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-primary">
                    {a.kind === "quiz" ? "Kuis" : "Tugas"} {a.subject}
                  </div>
                  <div className="font-semibold">{a.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Tenggat: {formatAssignmentTime(a.dueAt)}
                  </div>
                </div>
                <Button asChild className="w-full rounded-xl sm:w-auto">
                  <Link
                    href={a.kind === "quiz" ? `/subjects/kuis/${a.id}` : `/subjects/tugas/${a.id}`}
                  >
                    Mulai Kerjakan
                  </Link>
                </Button>
              </div>
            ))}
            {filteredActiveTasks.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {activityFilter === "task"
                  ? "Tidak ada tugas aktif yang perlu dikerjakan."
                  : activityFilter === "quiz"
                    ? "Tidak ada kuis aktif yang perlu dikerjakan."
                    : data.hasAnyAssignments
                      ? "Semua tugas dan kuis aktif telah dikerjakan."
                      : "Belum ada tugas dan kuis."}
              </p>
            )}
            {filteredActiveTasks.length > visibleActiveTasks.length && (
              <p className="text-xs text-muted-foreground">
                Menampilkan 3 aktivitas dengan tenggat terdekat.
              </p>
            )}
          </div>
        </Card>

        <Card className="rounded-3xl border-0 p-6 shadow-soft">
          <h2 className="font-display text-xl font-bold">Aktivitas Belajarku</h2>
          <div className="mt-4 space-y-3">
            <ActivityCard
              emoji="📚"
              label="Materi"
              value={data.materialsStudiedCount}
              total={data.totalMaterialsCount}
              colorClass={LEARNING_TYPE_STYLES.materi.soft}
              barClass={LEARNING_TYPE_STYLES.materi.bar}
            />
            <ActivityCard
              emoji="📝"
              label="Tugas"
              value={data.tugasCompletedCount}
              total={data.totalTugasCount}
              colorClass={LEARNING_TYPE_STYLES.tugas.soft}
              barClass={LEARNING_TYPE_STYLES.tugas.bar}
            />
            <ActivityCard
              emoji="❓"
              label="Kuis"
              value={data.kuisCompletedCount}
              total={data.totalKuisCount}
              colorClass={LEARNING_TYPE_STYLES.kuis.soft}
              barClass={LEARNING_TYPE_STYLES.kuis.bar}
            />
          </div>
          <div className="mt-4 border-t pt-4 text-sm">
            <ActivityMessage
              materiRemaining={data.totalMaterialsCount - data.materialsStudiedCount}
              tugasRemaining={data.totalTugasCount - data.tugasCompletedCount}
              kuisRemaining={data.totalKuisCount - data.kuisCompletedCount}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function ActivityCard({
  emoji,
  label,
  value,
  total,
  colorClass,
  barClass,
}: {
  emoji: string;
  label: string;
  value: number;
  total: number;
  colorClass: string;
  barClass: string;
}) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`rounded-2xl p-3.5 ${colorClass}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="text-lg">{emoji}</span> {label}
        </span>
        <span className="font-display text-lg font-bold">
          {value} / {total}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/60">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ActivityMessage({
  materiRemaining,
  tugasRemaining,
  kuisRemaining,
}: {
  materiRemaining: number;
  tugasRemaining: number;
  kuisRemaining: number;
}) {
  const lines: string[] = [];
  if (tugasRemaining > 0) {
    lines.push(`📝 Tinggal ${tugasRemaining} tugas lagi untuk diselesaikan.`);
  }
  if (kuisRemaining > 0) {
    lines.push(`❓ Tinggal ${kuisRemaining} kuis lagi untuk dikerjakan.`);
  }
  if (materiRemaining > 0) {
    lines.push(`📚 Tinggal ${materiRemaining} materi lagi untuk dibuka.`);
  }
  if (lines.length === 0) {
    return <p>🎉 Semua aktivitas belajar telah selesai.</p>;
  }
  return (
    <div className="space-y-1.5">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

function subjectCountLabel(s: { materialCount: number; tugasCount: number; kuisCount: number }) {
  const parts: string[] = [];
  if (s.materialCount > 0) parts.push(`${s.materialCount} Materi`);
  if (s.tugasCount > 0) parts.push(`${s.tugasCount} Tugas`);
  if (s.kuisCount > 0) parts.push(`${s.kuisCount} Kuis`);
  return parts.length > 0 ? parts.join(" • ") : null;
}

function ActivityFilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function QuickInfoCard({
  emoji,
  value,
  label,
  badgeClass,
  href,
  onClick,
  isActive = false,
}: {
  emoji: string;
  value: number;
  label: string;
  badgeClass: string;
  href?: string;
  onClick?: () => void;
  isActive?: boolean;
}) {
  const card = (
    <Card
      className={`h-full w-full rounded-2xl border p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-primary hover:shadow-glow md:p-5 ${
        isActive ? "border-primary ring-2 ring-primary/15" : "border-transparent"
      }`}
    >
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="flex items-center gap-2">
          <div
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-base ${badgeClass}`}
          >
            {emoji}
          </div>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="font-display text-2xl font-bold">{value}</div>
      </div>
    </Card>
  );

  const wrapperClass =
    "aspect-square w-32 shrink-0 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:aspect-auto md:w-auto";

  if (href) {
    return (
      <Link href={href} className={wrapperClass} aria-label={`Buka ${label}`}>
        {card}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={wrapperClass}
      aria-label={`Tampilkan ${label}`}
      aria-pressed={isActive}
      aria-controls="aktivitas-aktif"
    >
      {card}
    </button>
  );
}
