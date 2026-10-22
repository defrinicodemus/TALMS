import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileDown } from "lucide-react";
import type { SchoolReportData } from "@/lib/data/schoolReport";
import { tone, BADGE_CLASS } from "@/lib/monitoringTone";

const SEMESTER_LABEL = { ganjil: "Ganjil", genap: "Genap" } as const;

export function SchoolGradesReport({ data }: { data: SchoolReportData | null }) {
  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon="📊"
          title="Laporan Sekolah"
          subtitle="Laporan sementara tidak tersedia selama tidak ada tahun ajaran aktif."
        />
        <Card className="rounded-3xl border-0 p-8 text-center shadow-soft">
          <p className="font-medium">Sekolah sedang berada dalam masa administrasi.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Laporan akan tersedia kembali setelah Admin mengaktifkan tahun ajaran berikutnya.
          </p>
        </Card>
      </div>
    );
  }

  const periodLabel = `${data.academicYearLabel} · Semester ${SEMESTER_LABEL[data.semester]}`;
  const allFinal =
    data.totalGradebookCount > 0 && data.finalGradebookCount === data.totalGradebookCount;

  return (
    <div className="space-y-6">
      <PageHeader
        icon="📊"
        title="Laporan Sekolah"
        subtitle={`Rekap tahun ajaran aktif ${periodLabel}.`}
      />

      <Card className="rounded-3xl border-0 p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tahun Ajaran Aktif
            </div>
            <div className="mt-1 font-display text-xl font-bold">{periodLabel}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Unduh laporan sebelum Admin menonaktifkan periode ini untuk proses administrasi.
            </p>
          </div>
          <Button asChild variant="outline" className="rounded-xl">
            <a href="/api/reports/school-pdf">
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
          label="Materi Aktif"
          value={data.materiPublishedCount}
        />
        <Stat
          icon="⚡"
          iconClass="bg-purple-100 text-purple-600"
          label="Tugas/Kuis Dipublikasikan"
          value={data.aktivitasPembelajaranCount}
        />
      </div>

      <Card
        className={`rounded-3xl border p-5 shadow-soft ${
          allFinal ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"
        }`}
      >
        <div className="font-medium">
          {data.finalGradebookCount} dari {data.totalGradebookCount} Buku Nilai sudah final.
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {allFinal
            ? "Nilai rata-rata seluruh kelas sudah menggunakan snapshot final."
            : "Nilai rata-rata hanya memakai Buku Nilai yang sudah dikunci dan laporan nilai belum lengkap."}
        </p>
      </Card>

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
              {data.teacherRows.map((teacher) => (
                <tr key={teacher.teacherId}>
                  <td className="px-4 py-3 font-medium">{teacher.name}</td>
                  <td className="px-4 py-3 text-right">{teacher.materiCount}</td>
                  <td className="px-4 py-3 text-right">{teacher.tugasCount}</td>
                  <td className="px-4 py-3 text-right">{teacher.kuisCount}</td>
                  <td className="px-4 py-3 text-right">{teacher.presensiCount}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex rounded-full bg-primary-soft/60 px-2.5 py-1 text-xs font-bold text-primary">
                      {teacher.totalActivity}
                    </span>
                  </td>
                </tr>
              ))}
              {data.teacherRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Belum ada guru yang ditugaskan pada periode aktif.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="rounded-3xl border-0 p-6 shadow-soft">
        <h2 className="font-display text-xl font-bold">Rekap Pembelajaran Kelas</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Nilai rata-rata hanya berasal dari Buku Nilai yang sudah dikunci.
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Kelas</th>
                <th className="px-4 py-3">Jumlah Siswa</th>
                <th className="px-4 py-3">Kehadiran</th>
                <th className="px-4 py-3">Penyelesaian Tugas</th>
                <th className="px-4 py-3">Penyelesaian Kuis</th>
                <th className="px-4 py-3 text-right">Nilai Rata-rata Final</th>
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
                      emptyLabel="Belum ada presensi"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <FractionBadge
                      actual={row.tugasActual}
                      expected={row.tugasExpected}
                      percent={row.tugasCompletionPercent}
                      emptyLabel="Belum ada tugas"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <FractionBadge
                      actual={row.kuisActual}
                      expected={row.kuisExpected}
                      percent={row.kuisCompletionPercent}
                      emptyLabel="Belum ada kuis"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-display text-base font-bold">
                      {row.averageGradePercent ?? "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {row.finalGradebookCount}/{row.totalGradebookCount} Buku Nilai final
                    </div>
                  </td>
                </tr>
              ))}
              {data.classRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Belum ada kelas pada tahun ajaran aktif.
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
  emptyLabel,
}: {
  actual: number;
  expected: number;
  percent: number | null;
  emptyLabel: string;
}) {
  if (percent == null) return <span className="text-xs text-muted-foreground">{emptyLabel}</span>;
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
