"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter, FileDown } from "lucide-react";
import type { SchoolReportData } from "@/lib/data/schoolReport";
import { tone, BADGE_CLASS } from "@/lib/monitoringTone";

const SEMESTER_LABEL: Record<"ganjil" | "genap", string> = {
  ganjil: "Ganjil",
  genap: "Genap",
};

export function SchoolGradesReport({ data }: { data: SchoolReportData | null }) {
  const router = useRouter();
  const [selectedYearId, setSelectedYearId] = useState(data?.selectedYearId ?? "");

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon="📊"
          title="Laporan Sekolah"
          subtitle="Belum ada tahun ajaran yang terdaftar. Hubungi admin untuk menambahkan tahun ajaran pada menu Struktur Akademik."
        />
      </div>
    );
  }

  function applyFilter() {
    router.push(`/grades?yearId=${selectedYearId}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon="📊"
        title="Laporan Sekolah"
        subtitle="Rekap aktivitas LMS, kinerja pembelajaran, dan statistik untuk evaluasi sekolah."
      />

      <Card className="rounded-3xl border-0 p-6 shadow-soft">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-56">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tahun Ajaran
            </label>
            <Select value={selectedYearId} onValueChange={setSelectedYearId}>
              <SelectTrigger className="mt-1.5 w-full rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.yearOptions.map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {y.yearLabel} - {SEMESTER_LABEL[y.semester]}
                    {y.isActive ? " (Aktif)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={applyFilter} className="rounded-xl">
            <Filter className="mr-2 h-4 w-4" /> Terapkan Filter
          </Button>
          <Button asChild variant="outline" className="rounded-xl">
            <a href={`/api/reports/school-pdf?yearId=${selectedYearId}`}>
              <FileDown className="mr-2 h-4 w-4" /> Ekspor PDF
            </a>
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat
          icon="👩‍🏫"
          iconClass="bg-emerald-100 text-emerald-600"
          label="Total Guru Aktif"
          value={data.totalGuruAktif}
        />
        <Stat
          icon="🧑‍🤝‍🧑"
          iconClass="bg-blue-100 text-blue-600"
          label="Total Siswa Aktif"
          value={data.totalSiswaAktif}
        />
        <Stat
          icon="📘"
          iconClass="bg-amber-100 text-amber-600"
          label="Materi Dipublikasikan"
          value={data.materiPublishedCount}
        />
        <Stat
          icon="⚡"
          iconClass="bg-purple-100 text-purple-600"
          label="Aktivitas Pembelajaran (Tugas/Kuis)"
          value={data.aktivitasPembelajaranCount}
        />
      </div>

      <Card className="rounded-3xl border-0 p-6 shadow-soft">
        <h2 className="font-display text-xl font-bold">Rekap Kinerja Guru</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Nama Guru</th>
                <th className="px-4 py-3 text-right">Materi</th>
                <th className="px-4 py-3 text-right">Tugas</th>
                <th className="px-4 py-3 text-right">Kuis</th>
                <th className="px-4 py-3 text-right">Presensi/Jurnal</th>
                <th className="px-4 py-3 text-right">Total Aktivitas</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.teacherRows.map((t) => (
                <tr key={t.teacherId}>
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-right">{t.materiCount}</td>
                  <td className="px-4 py-3 text-right">{t.tugasCount}</td>
                  <td className="px-4 py-3 text-right">{t.kuisCount}</td>
                  <td className="px-4 py-3 text-right">{t.presensiCount}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex rounded-full bg-primary-soft/60 px-2.5 py-1 text-xs font-bold text-primary">
                      {t.totalActivity}
                    </span>
                  </td>
                </tr>
              ))}
              {data.teacherRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Belum ada guru yang ditugaskan pada periode ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="rounded-3xl border-0 p-6 shadow-soft">
        <h2 className="font-display text-xl font-bold">Rekap Pembelajaran Kelas</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Kelas</th>
                <th className="px-4 py-3">Jumlah Siswa</th>
                <th className="px-4 py-3">Kehadiran</th>
                <th className="px-4 py-3">Penyelesaian Tugas</th>
                <th className="px-4 py-3">Penyelesaian Kuis</th>
                <th className="px-4 py-3 text-right">Nilai Rata-rata</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.classRows.map((row) => (
                <tr key={row.classId}>
                  <td className="px-4 py-3 font-medium">{row.className}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.studentCount}</td>
                  <td className="px-4 py-3">
                    <FractionBadge
                      actual={row.attendanceHadir}
                      expected={row.attendanceTotal}
                      percent={row.attendancePercent}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <FractionBadge
                      actual={row.tugasActual}
                      expected={row.tugasExpected}
                      percent={row.tugasCompletionPercent}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <FractionBadge
                      actual={row.kuisActual}
                      expected={row.kuisExpected}
                      percent={row.kuisCompletionPercent}
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-display text-base font-bold">
                    {row.averageGradePercent}
                  </td>
                </tr>
              ))}
              {data.classRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Belum ada kelas pada periode ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function FractionBadge({
  actual,
  expected,
  percent,
}: {
  actual: number;
  expected: number;
  percent: number;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${BADGE_CLASS[tone(percent)]}`}
    >
      {actual}/{expected} ({percent}%)
    </span>
  );
}

function Stat({
  icon,
  iconClass,
  label,
  value,
}: {
  icon: string;
  iconClass: string;
  label: string;
  value: number;
}) {
  return (
    <Card className="rounded-3xl border-0 p-5 shadow-soft">
      <div className={`grid h-10 w-10 place-items-center rounded-xl text-lg ${iconClass}`}>
        {icon}
      </div>
      <div className="mt-3 text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
    </Card>
  );
}
