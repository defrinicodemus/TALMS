import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/guard";
import { getMonitoringPembelajaranData, type MonitoringClassRow } from "@/lib/data/monitoring";
import { tone, BADGE_CLASS, BAR_CLASS } from "@/lib/monitoringTone";

const SEMESTER_LABEL = { ganjil: "Ganjil", genap: "Genap" } as const;

export default async function StudentsPage() {
  await requireRole(["principal"]);

  const data = await getMonitoringPembelajaranData();

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon="🎓"
          title="Monitoring Pembelajaran"
          subtitle="Belum ada tahun ajaran aktif. Hubungi admin untuk mengaktifkan tahun ajaran pada menu Struktur Akademik."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon="🎓"
        title="Monitoring Pembelajaran"
        subtitle={`Pantau aktivitas belajar pada ${data.academicYearLabel} · Semester ${SEMESTER_LABEL[data.semester]}.`}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Stat
          icon="🎓"
          iconClass="bg-emerald-100 text-emerald-600"
          label="Total Kelas Aktif"
          value={String(data.totalActiveClasses)}
        />
        <Stat
          icon="🧑‍🤝‍🧑"
          iconClass="bg-blue-100 text-blue-600"
          label="Rata-rata Kehadiran"
          value={formatPercent(data.averageAttendancePercent, "Belum ada presensi")}
        />
        <Stat
          icon="📋"
          iconClass="bg-amber-100 text-amber-600"
          label="Penyelesaian Tugas"
          value={formatPercent(data.tugasCompletionPercent, "Belum ada tugas")}
        />
        <Stat
          icon="❓"
          iconClass="bg-purple-100 text-purple-600"
          label="Penyelesaian Kuis"
          value={formatPercent(data.kuisCompletionPercent, "Belum ada kuis")}
        />
      </div>

      <Card className="rounded-3xl border-0 p-6 shadow-soft">
        <h2 className="font-display text-xl font-bold">Monitoring Kelas</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Kelas</th>
                <th className="px-4 py-3">Jumlah Siswa</th>
                <th className="px-4 py-3">Kehadiran</th>
                <th className="px-4 py-3">Penyelesaian Tugas</th>
                <th className="px-4 py-3">Penyelesaian Kuis</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.classRows.map((row) => (
                <ClassMonitoringRow key={row.classId} row={row} />
              ))}
              {data.classRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Belum ada kelas pada tahun ajaran ini.
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

function ClassMonitoringRow({ row }: { row: MonitoringClassRow }) {
  return (
    <tr>
      <td className="px-4 py-3 font-medium">{row.className}</td>
      <td className="px-4 py-3 text-muted-foreground">{row.studentCount}</td>
      <td className="px-4 py-3">
        {row.attendancePercent == null ? (
          <span className="text-xs text-muted-foreground">Belum ada presensi</span>
        ) : (
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${BADGE_CLASS[tone(row.attendancePercent)]}`}
          >
            {row.attendancePercent}%
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <PercentBar percent={row.tugasCompletionPercent} />
      </td>
      <td className="px-4 py-3">
        <PercentBar percent={row.kuisCompletionPercent} />
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/students/${row.classId}`}
          className="text-sm font-semibold text-primary hover:underline"
        >
          Detail
        </Link>
      </td>
    </tr>
  );
}

function PercentBar({ percent }: { percent: number | null }) {
  if (percent == null) {
    return <span className="text-xs text-muted-foreground">Belum ada aktivitas</span>;
  }
  const t = tone(percent);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${BAR_CLASS[t]}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs font-medium text-muted-foreground">{percent}%</span>
    </div>
  );
}

function formatPercent(value: number | null, emptyLabel: string) {
  return value == null ? emptyLabel : `${value}%`;
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
  value: string;
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
