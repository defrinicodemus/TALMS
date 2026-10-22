"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ClipboardList,
  ListChecks,
  Users,
  School,
  Megaphone,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getCategoryBadgeClass } from "@/lib/announcement-categories";
import type { TeacherClassSubject } from "@/lib/data/teaching";
import type { TeacherDashboardData, TeacherAttendanceSummaryItem } from "@/lib/data/dashboard";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function TwoLineTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  if (x == null || y == null || !payload) return null;
  const dotIndex = payload.value.indexOf(".");
  const line1 = dotIndex === -1 ? payload.value : payload.value.slice(0, dotIndex);
  const line2 = dotIndex === -1 ? "" : payload.value.slice(dotIndex + 1);
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={10} fill="var(--color-muted-foreground)">
      <tspan x={x} dy={12}>
        {line1}
      </tspan>
      {line2 && (
        <tspan x={x} dy={12}>
          {line2}
        </tspan>
      )}
    </text>
  );
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} hari lalu`;
}

function formatDeadlineDateLabel(dueAt: string): string {
  const due = new Date(dueAt);
  const now = new Date();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Hari ini";
  if (diffDays === 1) return "Besok";
  return due.toLocaleDateString("id-ID", { day: "numeric", month: "long" });
}

function formatDeadlineTime(dueAt: string): string {
  const d = new Date(dueAt);
  return `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;
}

export function TeacherDashboard({
  userName,
  schoolName,
  combos,
  data,
}: {
  userName: string;
  schoolName: string | null;
  combos: TeacherClassSubject[];
  data: TeacherDashboardData;
}) {
  const now = useMemo(() => new Date(), []);
  const dayLabel = now.toLocaleDateString("id-ID", { weekday: "long" });
  const dateLabel = now.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const chartData = useMemo(
    () =>
      data.attendanceSummary.map((item) => ({
        ...item,
        label: `${item.subjectCode}.${item.className.toLowerCase()}`,
      })),
    [data.attendanceSummary],
  );

  const latestAnnouncement = data.recentAnnouncements[0] ?? null;

  return (
    <div className="space-y-6">
      <Card className="@container relative overflow-hidden rounded-md border-0 gradient-primary p-4 text-primary-foreground shadow-glow @sm:p-6 @md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm opacity-90">Selamat Datang,</p>
            <h1 className="mt-1 truncate font-display text-xl font-bold @sm:text-2xl @md:text-3xl @lg:text-4xl">
              {userName}
            </h1>
            <p className="mt-1 truncate text-sm opacity-90">Guru {schoolName ?? ""}</p>
          </div>
          <div className="hidden text-right md:block">
            <div className="text-sm opacity-90">{dayLabel}</div>
            <div className="font-display text-lg font-bold">{dateLabel}</div>
          </div>
        </div>
      </Card>

      <StatRow>
        <Stat
          icon={School}
          label="Total Kelas"
          value={String(data.totalClasses)}
          hint="Yang Anda ajar"
          href="/classroom"
        />
        <Stat
          icon={Users}
          label="Total Siswa"
          value={String(data.totalStudents)}
          hint="Seluruh kelas Anda"
          href="/roster"
        />
        <Stat
          icon={ListChecks}
          label="Kuis Aktif"
          value={String(data.kuisAktif)}
          hint={data.kuisAktif > 0 ? "Sedang berjalan" : "Tidak ada kuis aktif"}
          href="/classroom"
        />
        <Stat
          icon={ClipboardList}
          label="Tugas Belum Dinilai"
          value={String(data.tugasBelumDinilai)}
          hint={data.tugasBelumDinilai > 0 ? "Menunggu koreksi" : "Semua tugas telah dinilai"}
          href="/assessments"
        />
      </StatRow>

      <div className="grid gap-6 lg:grid-cols-10">
        <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6 lg:col-span-7">
          <h2 className="font-display text-base font-bold @sm:text-lg @md:text-xl">
            Ringkasan Kehadiran Mata Pelajaran
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Persentase hadir pada pertemuan terakhir setiap mata pelajaran
          </p>
          {chartData.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Belum ada data kehadiran.</p>
          ) : (
            <div
              className="mt-4 overflow-x-auto overscroll-x-contain pb-2"
              role="region"
              aria-label="Grafik ringkasan kehadiran mata pelajaran"
              tabIndex={0}
            >
              <div className="h-64" style={{ width: `max(100%, ${chartData.length * 110}px)` }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 4, right: 8, left: 8, bottom: 8 }}
                    barCategoryGap="20%"
                  >
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      height={36}
                      tick={<TwoLineTick />}
                    />
                    <YAxis hide domain={[0, 100]} width={0} />
                    <Tooltip
                      content={<AttendanceSummaryTooltip />}
                      cursor={{ fill: "var(--color-primary-soft)", opacity: 0.4 }}
                    />
                    <Bar
                      dataKey="hadirPercent"
                      barSize={36}
                      radius={[4, 4, 0, 0]}
                      fill="var(--color-primary)"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </Card>

        <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6 lg:col-span-3">
          <h2 className="font-display text-base font-bold @sm:text-lg @md:text-xl">
            Tenggat Mendatang
          </h2>
          <div className="mt-4 space-y-3">
            {data.upcomingDeadlines.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada deadline mendatang.</p>
            ) : (
              data.upcomingDeadlines.map((d) => (
                <div key={d.id} className="min-w-0 rounded-md bg-muted/40 p-2.5 @sm:p-3">
                  <div className="truncate text-xs font-semibold text-primary">
                    {formatDeadlineDateLabel(d.dueAt)} . {formatDeadlineTime(d.dueAt)}
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm font-medium">
                    {d.kindLabel} {d.title} - {d.subjectName.toLowerCase()} .{" "}
                    {d.className.toLowerCase()}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Link href="/announcements" className="@container md:hidden">
          <Card className="flex items-center gap-3 rounded-md border-0 p-4 shadow-soft transition hover:shadow-glow">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary-soft/50 text-primary @sm:h-11 @sm:w-11">
              <Megaphone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-sm font-bold @sm:text-base">Pengumuman Sekolah</div>
              <div className="truncate text-xs text-muted-foreground">
                {latestAnnouncement?.title ?? "Belum ada pengumuman."}
              </div>
            </div>
          </Card>
        </Link>

        <Card className="@container hidden rounded-md border-0 p-4 shadow-soft @sm:p-6 md:block">
          <h2 className="font-display text-base font-bold @sm:text-lg @md:text-xl">
            Pengumuman Terbaru
          </h2>
          <div className="mt-4 space-y-3">
            {data.recentAnnouncements.map((a) => (
              <div key={a.id} className="rounded-md bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold ${getCategoryBadgeClass(a.category)}`}
                  >
                    {a.category}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(a.created_at)}
                  </span>
                </div>
                <div className="mt-1.5 truncate text-sm font-medium">{a.title}</div>
              </div>
            ))}
            {data.recentAnnouncements.length === 0 && (
              <p className="text-sm text-muted-foreground">Belum ada pengumuman.</p>
            )}
          </div>
          <Button asChild variant="outline" className="mt-4 w-full rounded-md">
            <Link href="/announcements">Pengumuman Selengkapnya</Link>
          </Button>
        </Card>

        <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6">
          <h2 className="font-display text-base font-bold @sm:text-lg @md:text-xl">
            Aktivitas Terbaru
          </h2>
          <div className="mt-4">
            {data.recentActivity.map((item, i) => (
              <div key={item.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                  {i < data.recentActivity.length - 1 && <div className="w-px flex-1 bg-border" />}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <div className="truncate text-sm">{item.text}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {formatRelativeTime(item.timestamp)}
                  </div>
                </div>
              </div>
            ))}
            {data.recentActivity.length === 0 && (
              <p className="text-sm text-muted-foreground">Belum ada aktivitas terbaru.</p>
            )}
          </div>
        </Card>

        <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6">
          <h2 className="font-display text-base font-bold @sm:text-lg @md:text-xl">Aksi Cepat</h2>
          <div className="mt-4 grid gap-2">
            <Button asChild className="h-10 justify-start rounded-md text-sm @sm:h-11">
              <Link href="/classroom">+ Tambah Materi</Link>
            </Button>
            <Button
              asChild
              variant="secondary"
              className="h-10 justify-start rounded-md text-sm @sm:h-11"
            >
              <Link href="/classroom">+ Buat Tugas</Link>
            </Button>
            <Button
              asChild
              variant="secondary"
              className="h-10 justify-start rounded-md text-sm @sm:h-11"
            >
              <Link href="/classroom">+ Buat Kuis</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-10 justify-start rounded-md text-sm @sm:h-11"
            >
              <Link href="/assessments">+ Periksa Tugas</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-10 justify-start rounded-md text-sm @sm:h-11"
            >
              <Link href="/attendance">+ Presensi Hari Ini</Link>
            </Button>
          </div>
        </Card>
      </div>

      {combos.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          Anda belum ditugaskan mengajar kelas/mata pelajaran manapun.
        </p>
      )}
    </div>
  );
}

function StatRow({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showRightHint, setShowRightHint] = useState(false);
  const [showLeftHint, setShowLeftHint] = useState(false);

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollable = el.scrollWidth > el.clientWidth + 4;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setShowRightHint(scrollable && el.scrollLeft <= 4);
    setShowLeftHint(scrollable && el.scrollLeft >= maxScroll - 4);
  }, []);

  useEffect(() => {
    updateEdges();
    const el = scrollRef.current;
    window.addEventListener("resize", updateEdges);
    el?.addEventListener("scroll", updateEdges);
    return () => {
      window.removeEventListener("resize", updateEdges);
      el?.removeEventListener("scroll", updateEdges);
    };
  }, [updateEdges]);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="scrollbar-hide flex gap-3 overflow-x-auto md:grid md:grid-cols-4 md:gap-4 md:overflow-visible"
      >
        {children}
      </div>
      {showRightHint && (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-0.5 md:hidden">
          <div className="grid h-6 w-6 place-items-center rounded-full bg-card shadow-soft">
            <ChevronRight className="h-3.5 w-3.5 text-primary" />
          </div>
        </div>
      )}
      {showLeftHint && (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-0.5 md:hidden">
          <div className="grid h-6 w-6 place-items-center rounded-full bg-card shadow-soft">
            <ChevronLeft className="h-3.5 w-3.5 text-primary" />
          </div>
        </div>
      )}
    </div>
  );
}

function AttendanceSummaryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: TeacherAttendanceSummaryItem }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md">
      <div className="mb-1.5 font-semibold">
        {d.subjectName} · {d.className}
      </div>
      <div className="space-y-0.5">
        <div>Hadir: {d.hadir}</div>
        <div>Izin: {d.izin}</div>
        <div>Sakit: {d.sakit}</div>
        <div>Alfa: {d.alfa}</div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  href,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint: string;
  href: string;
}) {
  return (
    <Link href={href} className="w-40 shrink-0 md:w-auto md:shrink">
      <Card className="@container rounded-md border-0 p-3 shadow-soft transition hover:shadow-glow @xs:p-4 @sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground @xs:text-[11px] @sm:text-xs">
              {label}
            </div>
            <div className="mt-1 truncate font-display text-xl font-bold @xs:text-2xl @sm:text-3xl">
              {value}
            </div>
            <div className="mt-1 truncate text-[10px] text-muted-foreground @xs:text-[11px] @sm:text-xs">
              {hint}
            </div>
          </div>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary-soft/50 text-primary @sm:h-11 @sm:w-11">
            <Icon className="h-4 w-4 @sm:h-5 @sm:w-5" />
          </div>
        </div>
      </Card>
    </Link>
  );
}
