"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Search } from "lucide-react";
import type { TeacherActivityEvent, TeacherMonitoringData } from "@/lib/data/teacher-monitoring";

type Period = "week" | "month" | "semester";

const PERIOD_LABEL: Record<Period, string> = {
  week: "Minggu Ini",
  month: "Bulan Ini",
  semester: "Semester Ini",
};

function getPeriodStart(period: Period): Date {
  const now = new Date();
  if (period === "week") {
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
  }
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const isFirstSemester = now.getMonth() >= 6;
  return isFirstSemester ? new Date(now.getFullYear(), 6, 1) : new Date(now.getFullYear(), 0, 1);
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

function formatEventText(event: TeacherActivityEvent, teacherName: string): string {
  switch (event.kind) {
    case "materi":
      return `Guru ${teacherName} mengunggah materi "${event.title}"`;
    case "tugas":
      return `Guru ${teacherName} membuat tugas "${event.title}"`;
    case "kuis":
      return `Guru ${teacherName} membuat kuis "${event.title}"`;
    case "presensi":
      return `Guru ${teacherName} mengisi presensi ${event.title}`;
  }
}

interface TeacherRow {
  id: string;
  name: string;
  materi: number;
  tugas: number;
  kuis: number;
  presensi: number;
  total: number;
}

export function TeacherMonitoringView({ data }: { data: TeacherMonitoringData }) {
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<Period>("week");

  const teacherNameById = useMemo(
    () => new Map(data.teachers.map((t) => [t.id, t.name])),
    [data.teachers],
  );

  const periodStart = useMemo(() => getPeriodStart(period), [period]);
  const periodEvents = useMemo(
    () => data.events.filter((e) => new Date(e.timestamp) >= periodStart),
    [data.events, periodStart],
  );

  const rows: TeacherRow[] = useMemo(() => {
    const byTeacher = new Map<
      string,
      { materi: number; tugas: number; kuis: number; presensi: number }
    >();
    for (const e of periodEvents) {
      const acc = byTeacher.get(e.teacherId) ?? { materi: 0, tugas: 0, kuis: 0, presensi: 0 };
      acc[e.kind]++;
      byTeacher.set(e.teacherId, acc);
    }
    return data.teachers
      .map((t) => {
        const c = byTeacher.get(t.id) ?? { materi: 0, tugas: 0, kuis: 0, presensi: 0 };
        return { id: t.id, name: t.name, ...c, total: c.materi + c.tugas + c.kuis + c.presensi };
      })
      .filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => b.total - a.total);
  }, [data.teachers, periodEvents, search]);

  const activeTeacherCount = rows.filter((r) => r.total > 0).length;
  const totalMateri = rows.reduce((sum, r) => sum + r.materi, 0);
  const totalTugas = rows.reduce((sum, r) => sum + r.tugas, 0);
  const totalPresensi = rows.reduce((sum, r) => sum + r.presensi, 0);

  const weeklyChartData = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const buckets: { key: string; day: string; total: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfToday.getTime() - i * 86400000);
      buckets.push({
        key: d.toISOString().slice(0, 10),
        day: d.toLocaleDateString("id-ID", { weekday: "short" }),
        total: 0,
      });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    const sevenDaysAgo = new Date(startOfToday.getTime() - 6 * 86400000);
    for (const e of data.events) {
      const ts = new Date(e.timestamp);
      if (ts < sevenDaysAgo) continue;
      const bucket = byKey.get(ts.toISOString().slice(0, 10));
      if (bucket) bucket.total++;
    }
    return buckets;
  }, [data.events]);

  const timeline = useMemo(
    () =>
      [...data.events]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 8)
        .map((e) => ({
          id: e.id,
          text: formatEventText(e, teacherNameById.get(e.teacherId) ?? "?"),
          timestamp: e.timestamp,
        })),
    [data.events, teacherNameById],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon="👩‍🏫"
        title="Kinerja Guru"
        subtitle="Pantau aktivitas guru, materi, tugas, kuis, dan presensi pembelajaran."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Stat
          icon="👩‍🏫"
          label="Total Guru Aktif"
          value={activeTeacherCount}
          hint={PERIOD_LABEL[period]}
        />
        <Stat
          icon="📘"
          label="Total Materi Dibuat"
          value={totalMateri}
          hint={PERIOD_LABEL[period]}
        />
        <Stat icon="📝" label="Total Tugas Dibuat" value={totalTugas} hint={PERIOD_LABEL[period]} />
        <Stat
          icon="🗓️"
          label="Total Presensi Diisi"
          value={totalPresensi}
          hint={PERIOD_LABEL[period]}
        />
      </div>

      <Card className="rounded-3xl border-0 p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold">Tabel Monitoring Guru</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama guru..."
                className="w-56 rounded-xl pl-9"
              />
            </div>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-40 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Minggu Ini</SelectItem>
                <SelectItem value="month">Bulan Ini</SelectItem>
                <SelectItem value="semester">Semester Ini</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Nama Guru</th>
                <th className="px-4 py-3 text-right">Total Aktivitas</th>
                <th className="px-4 py-3 text-right">Materi</th>
                <th className="px-4 py-3 text-right">Tugas</th>
                <th className="px-4 py-3 text-right">Kuis</th>
                <th className="px-4 py-3 text-right">Presensi</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-right font-display font-bold text-primary">
                    {t.total}
                  </td>
                  <td className="px-4 py-3 text-right">{t.materi}</td>
                  <td className="px-4 py-3 text-right">{t.tugas}</td>
                  <td className="px-4 py-3 text-right">{t.kuis}</td>
                  <td className="px-4 py-3 text-right">{t.presensi}</td>
                  <td className="px-4 py-3 text-right">
                    <Button asChild size="sm" variant="outline" className="rounded-xl">
                      <Link href={`/teacher-monitoring/${t.id}`}>Lihat Detail</Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Tidak ada guru yang cocok dengan pencarian.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-3xl border-0 p-6 shadow-soft">
          <h2 className="font-display text-xl font-bold">Aktivitas Guru Mingguan</h2>
          <div className="mt-1 text-xs text-muted-foreground">
            Jumlah aktivitas seluruh guru dalam 7 hari terakhir
          </div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyChartData}>
                <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ borderRadius: 12 }}
                  cursor={{ fill: "var(--color-primary-soft)", opacity: 0.4 }}
                />
                <Bar dataKey="total" radius={[12, 12, 0, 0]} fill="var(--color-primary)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="rounded-3xl border-0 p-6 shadow-soft">
          <h2 className="font-display text-xl font-bold">Aktivitas Guru Terbaru</h2>
          <div className="mt-4">
            {timeline.map((item, i) => (
              <div key={item.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                  {i < timeline.length - 1 && <div className="w-px flex-1 bg-border" />}
                </div>
                <div className="min-w-0 flex-1 pb-4 text-sm">
                  {item.text}{" "}
                  <span className="text-muted-foreground">
                    – {formatRelativeTime(item.timestamp)}
                  </span>
                </div>
              </div>
            ))}
            {timeline.length === 0 && (
              <p className="text-sm text-muted-foreground">Belum ada aktivitas guru.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: string;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <Card className="rounded-3xl border-0 p-5 shadow-soft">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <span>{icon}</span> {label}
      </div>
      <div className="mt-2 font-display text-3xl font-bold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </Card>
  );
}
