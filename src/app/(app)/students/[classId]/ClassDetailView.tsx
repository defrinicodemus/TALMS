"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ClassMonitoringDetail } from "@/lib/data/monitoring";
import { tone, BAR_CLASS } from "@/lib/monitoringTone";
import { formatAssignmentTime } from "@/lib/assignmentConstants";

const SEMESTER_LABEL: Record<"ganjil" | "genap", string> = {
  ganjil: "Ganjil",
  genap: "Genap",
};

type ActivityKind = "materi" | "tugas" | "kuis";

interface ModalTarget {
  subjectId: string;
  subjectName: string;
  kind: ActivityKind;
}

const MODAL_CONFIG: Record<ActivityKind, { title: string; col1: string; col2: string }> = {
  materi: { title: "Rincian Materi", col1: "Nama Materi", col2: "Tanggal Upload" },
  tugas: { title: "Rincian Tugas", col1: "Nama Tugas", col2: "Tenggat" },
  kuis: { title: "Rincian Kuis", col1: "Nama Kuis", col2: "Tenggat" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    timeZone: "Asia/Makassar",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function ClassDetailView({ data }: { data: ClassMonitoringDetail }) {
  const [modal, setModal] = useState<ModalTarget | null>(null);

  const modalRows = useMemo(() => {
    if (!modal) return [];
    const { subjectId, kind } = modal;
    const source =
      kind === "materi" ? data.materialItems : kind === "tugas" ? data.tugasItems : data.kuisItems;
    return source
      .filter((item) => item.subjectId === subjectId)
      .map((item) => ({
        id: item.id,
        col1: item.title,
        col2:
          kind === "materi"
            ? formatDate(item.createdAt)
            : item.dueAt
              ? formatAssignmentTime(item.dueAt)
              : "Tidak ada tenggat",
        status: item.status,
      }));
  }, [modal, data]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/students" className="hover:text-primary hover:underline">
            Monitoring Pembelajaran
          </Link>
          <span>›</span>
          <span className="font-medium text-foreground">Detail Kelas</span>
        </div>
        <h1 className="mt-1 font-display text-2xl font-bold md:text-3xl">
          Detail Monitoring Kelas
        </h1>
      </div>

      <Card className="relative overflow-hidden rounded-3xl border-0 p-6 shadow-soft">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-emerald-500" />
        <div className="flex items-center justify-between gap-4 pl-3">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-2xl">
              🏫
            </div>
            <div>
              <h2 className="font-display text-xl font-bold">{data.className}</h2>
              <p className="text-sm text-muted-foreground">
                Tahun Ajaran {SEMESTER_LABEL[data.semester]} {data.academicYearLabel}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                👥 Total: {data.studentCount} Siswa
              </p>
            </div>
          </div>
          <span className="select-none text-7xl leading-none opacity-10">🎓</span>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard icon="✅" label="Kehadiran Siswa" percent={data.attendancePercent} />
        <MetricCard icon="📋" label="Penyelesaian Tugas" percent={data.tugasCompletionPercent} />
        <MetricCard icon="❓" label="Penyelesaian Kuis" percent={data.kuisCompletionPercent} />
        <MetricCard icon="⭐" label="Rata-rata Nilai" percent={data.averageGradePercent} isScore />
      </div>

      <div className="rounded-2xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          {data.finalGradebookCount} dari {data.totalGradebookCount} Buku Nilai sudah final.
        </span>{" "}
        {data.gradeIsFinal
          ? "Rata-rata kelas memakai seluruh snapshot nilai final."
          : "Rata-rata saat ini memakai rumus per TP dan masih dapat berubah."}
      </div>

      <Card className="rounded-3xl border-0 p-6 shadow-soft">
        <h2 className="font-display text-xl font-bold">Monitoring Mata Pelajaran</h2>
        <div className="mt-1 text-xs text-muted-foreground">
          Klik angka pada kolom Materi, Tugas, atau Kuis untuk melihat rincian aktivitas
        </div>
        <div className="mt-4 overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Mata Pelajaran</th>
                <th className="px-4 py-3 text-right">Materi</th>
                <th className="px-4 py-3 text-right">Tugas</th>
                <th className="px-4 py-3 text-right">Kuis</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.subjectRows.map((row) => (
                <tr key={row.subjectId}>
                  <td className="px-4 py-3 font-medium">{row.subjectName}</td>
                  <td className="px-1 py-1 text-right">
                    <ActivityCell
                      value={row.materiCount}
                      onClick={() =>
                        setModal({
                          subjectId: row.subjectId,
                          subjectName: row.subjectName,
                          kind: "materi",
                        })
                      }
                    />
                  </td>
                  <td className="px-1 py-1 text-right">
                    <ActivityCell
                      value={row.tugasCount}
                      onClick={() =>
                        setModal({
                          subjectId: row.subjectId,
                          subjectName: row.subjectName,
                          kind: "tugas",
                        })
                      }
                    />
                  </td>
                  <td className="px-1 py-1 text-right">
                    <ActivityCell
                      value={row.kuisCount}
                      onClick={() =>
                        setModal({
                          subjectId: row.subjectId,
                          subjectName: row.subjectName,
                          kind: "kuis",
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
              {data.subjectRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    Belum ada mata pelajaran untuk kelas ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={modal != null} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent className="max-h-[85vh] w-[90vw] max-w-lg overflow-y-auto">
          {modal && (
            <>
              <DialogHeader>
                <DialogTitle>{MODAL_CONFIG[modal.kind].title}</DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {data.className} · {modal.subjectName}
                </p>
              </DialogHeader>
              <div className="mt-2 overflow-hidden rounded-2xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">{MODAL_CONFIG[modal.kind].col1}</th>
                      <th className="px-4 py-2.5">{MODAL_CONFIG[modal.kind].col2}</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {modalRows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2.5 font-medium">{r.col1}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.col2}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.status}</td>
                      </tr>
                    ))}
                    {modalRows.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                          Belum ada aktivitas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActivityCell({ value, onClick }: { value: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg px-3 py-1.5 text-right font-display font-semibold text-primary transition hover:bg-primary-soft/50 hover:underline"
    >
      {value}
    </button>
  );
}

function MetricCard({
  icon,
  label,
  percent,
  isScore,
}: {
  icon: string;
  label: string;
  percent: number | null;
  isScore?: boolean;
}) {
  const t = tone(percent ?? 0);
  return (
    <Card className="rounded-3xl border-0 p-5 shadow-soft">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-lg">
        {icon}
      </div>
      <div className="mt-3 text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">
        {percent == null ? "—" : percent}
        {percent == null || isScore ? "" : "%"}
      </div>
      {percent == null && <div className="mt-1 text-xs text-muted-foreground">Belum ada data</div>}
      {isScore && percent != null && (
        <div className="mt-1 text-xs text-muted-foreground">
          {label === "Rata-rata Nilai" ? "Lihat status finalisasi di bawah" : null}
        </div>
      )}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${BAR_CLASS[t]}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </Card>
  );
}
