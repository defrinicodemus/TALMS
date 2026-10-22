"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, CheckCircle2, Download, Eye, Loader2, Lock, LockOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeacherClassSubject } from "@/lib/data/teaching";
import type { GradebookData, GradebookReadiness, GradebookStudentRow } from "@/lib/data/gradebook";
import { formatAssignmentTime } from "@/lib/assignmentConstants";
import { checkGradebookReadiness, lockAndCalculateGrades, unlockGradebook } from "./actions";
import { StudentHistoryDialog } from "./StudentHistoryDialog";

function comboKey(classId: string, subjectId: string) {
  return `${classId}:${subjectId}`;
}

export function GradebookManager({
  combos,
  gradebookByKey,
}: {
  combos: TeacherClassSubject[];
  gradebookByKey: Record<string, GradebookData>;
}) {
  const [selectedKey, setSelectedKey] = useState(comboKey(combos[0].classId, combos[0].subjectId));
  const selectedCombo = combos.find((c) => comboKey(c.classId, c.subjectId) === selectedKey)!;
  const data = gradebookByKey[selectedKey];
  const [isExporting, setIsExporting] = useState(false);
  const exporting = useRef(false);

  async function handleExport() {
    if (!data.isLocked || exporting.current) return;
    exporting.current = true;
    setIsExporting(true);
    try {
      const XLSX = await import("xlsx");
      const rows = data.students.map((st) => {
        const row: Record<string, string | number> = { "Nama Siswa": st.fullName };
        for (const tp of data.tpColumns) {
          row[`Nilai ${tp.title}`] = st.tpAverages[tp.id] ?? "-";
        }
        row["Nilai Akhir"] = st.finalGrade ?? "-";
        return row;
      });
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Nilai");
      await XLSX.writeFile(
        workbook,
        `Buku-Nilai-${selectedCombo.className}-${selectedCombo.subjectName}.xlsx`,
      );
    } catch {
      toast.error("Ekspor Excel gagal. Coba lagi atau muat ulang halaman.");
    } finally {
      exporting.current = false;
      setIsExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="@container rounded-md border-0 p-4 shadow-soft @sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full sm:w-80">
            <Label className="text-[clamp(0.6875rem,0.65rem+0.2cqw,0.8125rem)]">
              Kelas & Mata Pelajaran
            </Label>
            <Select value={selectedKey} onValueChange={setSelectedKey} disabled={isExporting}>
              <SelectTrigger className="mt-1 w-full text-[clamp(0.8125rem,0.76rem+0.22cqw,0.9375rem)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {combos.map((c) => (
                  <SelectItem
                    key={comboKey(c.classId, c.subjectId)}
                    value={comboKey(c.classId, c.subjectId)}
                  >
                    {c.className} - {c.subjectName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            className="rounded-md bg-emerald-700 text-[clamp(0.8125rem,0.76rem+0.22cqw,0.9375rem)] hover:bg-emerald-800"
            disabled={isExporting || !data.isLocked}
            aria-busy={isExporting}
            onClick={handleExport}
          >
            {isExporting ? (
              <Loader2 className="mr-2 size-[clamp(0.875rem,0.8rem+0.4cqw,1.125rem)] animate-spin" />
            ) : (
              <Download className="mr-2 size-[clamp(0.875rem,0.8rem+0.4cqw,1.125rem)]" />
            )}
            {isExporting ? "Menyiapkan Excel…" : "Ekspor ke Excel"}
          </Button>
        </div>
      </Card>

      <GradebookTable
        data={data}
        classId={selectedCombo.classId}
        subjectId={selectedCombo.subjectId}
      />
    </div>
  );
}

function GradebookTable({
  data,
  classId,
  subjectId,
}: {
  data: GradebookData;
  classId: string;
  subjectId: string;
}) {
  const [historyStudent, setHistoryStudent] = useState<GradebookStudentRow | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function openHistory(st: GradebookStudentRow) {
    setHistoryStudent(st);
    setHistoryOpen(true);
  }

  function handleLock() {
    startTransition(async () => {
      try {
        const result = await lockAndCalculateGrades(classId, subjectId);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      } catch {
        toast.error("Buku Nilai belum dapat dikunci. Periksa koneksi lalu coba lagi.");
      }
    });
  }

  function handleUnlock() {
    startTransition(async () => {
      try {
        const result = await unlockGradebook(classId, subjectId);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      } catch {
        toast.error("Kunci Buku Nilai belum dapat dibuka. Periksa koneksi lalu coba lagi.");
      }
    });
  }

  // Desktop: Nama Siswa fixed at 40%. The remaining 60% is split across TP
  // columns + Nilai Akhir + Riwayat, weighted by each column's minimum pixel
  // need (Nilai Akhir needs more room than a single TP score or the eye
  // icon). The table's own min-width is set to whatever width makes every
  // shared column land exactly at its floor; below that container width, the
  // table can no longer shrink and the wrapper's hidden-scrollbar
  // overflow-x-auto takes over.
  const TP_FLOOR_PX = 64;
  const NILAI_FLOOR_PX = 128;
  const RIWAYAT_FLOOR_PX = 64;
  const totalFloorPx = data.tpColumns.length * TP_FLOOR_PX + NILAI_FLOOR_PX + RIWAYAT_FLOOR_PX;
  const tpSharePercent = (TP_FLOOR_PX / totalFloorPx) * 60;
  const nilaiSharePercent = (NILAI_FLOOR_PX / totalFloorPx) * 60;
  const riwayatSharePercent = (RIWAYAT_FLOOR_PX / totalFloorPx) * 60;
  const tableMinWidthPx = Math.round(totalFloorPx / 0.6);

  // Mobile: every column (including Nama) is a fixed pixel width instead of a
  // percentage. Mixing a fixed-length column with percentage columns inside a
  // table-layout:fixed table turned out to make browsers dump all of the
  // table's leftover width onto the fixed-length column instead of honoring
  // it — so instead every mobile column is fixed px and the table's min-width
  // is exactly their sum, leaving no leftover to redistribute. That's what
  // keeps Nama Siswa locked at NAMA_WIDTH_PX_MOBILE no matter how many TP
  // columns get added; only the table's min-width (and therefore whether it
  // needs to scroll) grows. NAMA_WIDTH_PX_MOBILE is 40% of a typical mobile
  // card's content width (~330px), fixed as a constant rather than a live
  // percentage so it never grows with the table.
  const NAMA_WIDTH_PX_MOBILE = 132;
  const TP_WIDTH_PX_MOBILE = 48;
  const NILAI_WIDTH_PX_MOBILE = 64;
  const RIWAYAT_WIDTH_PX_MOBILE = 44;
  const tableMinWidthPxMobile =
    NAMA_WIDTH_PX_MOBILE +
    data.tpColumns.length * TP_WIDTH_PX_MOBILE +
    NILAI_WIDTH_PX_MOBILE +
    RIWAYAT_WIDTH_PX_MOBILE;

  return (
    <>
      <Card className="@container rounded-md border-0 p-1 shadow-soft sm:p-4 sm:@sm:p-6">
        {data.tpColumns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum ada Tujuan Pembelajaran (TP) untuk kelas & mapel ini. Isi dulu lewat menu Kelola
            Kurikulum.
          </p>
        ) : (
          <>
            <div className="hidden sm:block">
              <GradebookTableBody
                data={data}
                onOpenHistory={openHistory}
                namaWidth="40%"
                tpColumnWidth={`${tpSharePercent}%`}
                nilaiColumnWidth={`${nilaiSharePercent}%`}
                riwayatColumnWidth={`${riwayatSharePercent}%`}
                tableMinWidthPx={tableMinWidthPx}
                nilaiAkhirLabel="Nilai Akhir"
                unlockedLabel="Akan dihitung setelah dikunci"
              />
            </div>
            <div className="sm:hidden">
              <GradebookTableBody
                data={data}
                onOpenHistory={openHistory}
                namaWidth={`${NAMA_WIDTH_PX_MOBILE}px`}
                namaSticky
                tpColumnWidth={`${TP_WIDTH_PX_MOBILE}px`}
                nilaiColumnWidth={`${NILAI_WIDTH_PX_MOBILE}px`}
                riwayatColumnWidth={`${RIWAYAT_WIDTH_PX_MOBILE}px`}
                tableMinWidthPx={tableMinWidthPxMobile}
                nilaiAkhirLabel="NA"
                unlockedLabel="Belum Kunci"
                wrapperClassName="mx-[0.5%] mt-[0.5%]"
              />
            </div>

            <div className="mt-6 hidden justify-end sm:flex">
              <LockControls
                data={data}
                classId={classId}
                subjectId={subjectId}
                isPending={isPending}
                onLock={handleLock}
                onUnlock={handleUnlock}
              />
            </div>
          </>
        )}

        <StudentHistoryDialog
          student={historyStudent}
          open={historyOpen}
          classId={classId}
          subjectId={subjectId}
          onClose={() => setHistoryOpen(false)}
        />
      </Card>

      {data.tpColumns.length > 0 && (
        <div className="mt-4 flex justify-end sm:hidden">
          <LockControls
            data={data}
            classId={classId}
            subjectId={subjectId}
            isPending={isPending}
            onLock={handleLock}
            onUnlock={handleUnlock}
          />
        </div>
      )}
    </>
  );
}

function LockControls({
  data,
  classId,
  subjectId,
  isPending,
  onLock,
  onUnlock,
}: {
  data: GradebookData;
  classId: string;
  subjectId: string;
  isPending: boolean;
  onLock: () => void;
  onUnlock: () => void;
}) {
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [readiness, setReadiness] = useState<GradebookReadiness | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [isChecking, startChecking] = useTransition();

  function loadReadiness() {
    setReadiness(null);
    setReadinessError(null);
    startChecking(async () => {
      try {
        const result = await checkGradebookReadiness(classId, subjectId);
        if (result.ok) setReadiness(result.data);
        else setReadinessError(result.message);
      } catch {
        setReadinessError("Kesiapan Buku Nilai belum dapat diperiksa. Coba lagi.");
      }
    });
  }

  function handleLockDialogChange(next: boolean) {
    setLockDialogOpen(next);
    if (next) loadReadiness();
  }

  return data.isLocked ? (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 rounded-md bg-muted px-4 py-2.5 text-[clamp(0.8125rem,0.76rem+0.22cqw,0.9375rem)] text-muted-foreground">
        <Lock className="size-[clamp(0.875rem,0.8rem+0.4cqw,1.125rem)]" /> Buku nilai dikunci pada{" "}
        {data.lockedAt &&
          new Date(data.lockedAt).toLocaleDateString("id-ID", {
            timeZone: "Asia/Makassar",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className="rounded-md border-red-800 text-[clamp(0.8125rem,0.76rem+0.22cqw,0.9375rem)] text-red-800 hover:bg-red-50"
            disabled={isPending}
          >
            <LockOpen className="mr-2 size-[clamp(0.875rem,0.8rem+0.4cqw,1.125rem)]" /> Buka Kunci
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buka kunci buku nilai?</AlertDialogTitle>
            <AlertDialogDescription>
              Nilai Akhir yang sudah dihitung untuk kelas & mapel ini akan dihapus. Anda bisa
              menilai ulang tugas/kuis, lalu mengunci dan menghitung ulang nilai akhir kapan saja.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={onUnlock}>Buka Kunci</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  ) : (
    <AlertDialog open={lockDialogOpen} onOpenChange={handleLockDialogChange}>
      <AlertDialogTrigger asChild>
        <Button
          className="rounded-md bg-red-800 text-[clamp(0.8125rem,0.76rem+0.22cqw,0.9375rem)] text-white hover:bg-red-900"
          disabled={isPending || data.students.length === 0}
        >
          <Lock className="mr-2 size-[clamp(0.875rem,0.8rem+0.4cqw,1.125rem)]" /> Kunci & Hitung
          Nilai
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Periksa kesiapan Buku Nilai</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left">
              {isChecking && (
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Memeriksa tugas, kuis, dan nilai
                  siswa...
                </div>
              )}

              {!isChecking && readinessError && (
                <div role="alert" className="space-y-2">
                  <p>{readinessError}</p>
                  <Button type="button" variant="outline" size="sm" onClick={loadReadiness}>
                    Coba Lagi
                  </Button>
                </div>
              )}

              {!isChecking && readiness && <GradebookReadinessSummary readiness={readiness} />}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction
            onClick={onLock}
            disabled={isChecking || isPending || !readiness?.canLock}
          >
            Kunci & Hitung
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function GradebookReadinessSummary({ readiness }: { readiness: GradebookReadiness }) {
  const hasBlockers =
    readiness.alreadyLocked ||
    readiness.studentCount === 0 ||
    readiness.assessmentCount === 0 ||
    readiness.openActivities.length > 0 ||
    readiness.ungradedActivities.length > 0 ||
    readiness.unlinkedActivities.length > 0;

  return (
    <div className="space-y-3 text-sm">
      {readiness.canLock ? (
        <div className="flex gap-2 rounded-md bg-primary-soft/50 p-3 text-foreground">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            Buku Nilai siap dikunci. Nilai akhir akan dihitung untuk {readiness.studentCount} siswa.
          </p>
        </div>
      ) : (
        <div className="flex gap-2 rounded-md bg-destructive/10 p-3 text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>Selesaikan kondisi berikut sebelum mengunci Buku Nilai.</p>
        </div>
      )}

      {hasBlockers && (
        <ul className="list-disc space-y-1 pl-5 text-foreground">
          {readiness.alreadyLocked && <li>Buku Nilai sudah dikunci.</li>}
          {readiness.studentCount === 0 && <li>Kelas belum memiliki siswa.</li>}
          {readiness.assessmentCount === 0 && (
            <li>Belum ada tugas atau kuis aktif yang terhubung dengan TP.</li>
          )}
          {readiness.openActivities.map((activity) => (
            <li key={`open-${activity.assignmentId}`}>
              {activity.title} masih terbuka
              {activity.dueAt
                ? ` sampai ${formatAssignmentTime(activity.dueAt)}`
                : " tanpa tenggat"}
              .
            </li>
          ))}
          {readiness.ungradedActivities.map((activity) => (
            <li key={`ungraded-${activity.assignmentId}`}>
              {activity.submissionCount ?? 0} jawaban pada {activity.title} belum dinilai.
            </li>
          ))}
          {readiness.unlinkedActivities.map((activity) => (
            <li key={`unlinked-${activity.assignmentId}`}>
              {activity.title} belum terhubung dengan TP.
            </li>
          ))}
        </ul>
      )}

      {readiness.missingActivities.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-foreground">
          <p className="font-medium">Siswa yang tidak mengumpulkan akan memperoleh nilai 0:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {readiness.missingActivities.map((activity) => (
              <li key={`missing-${activity.assignmentId}`}>
                {activity.title}: {(activity.studentNames ?? []).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {readiness.unassessedObjectives.length > 0 && (
        <div className="rounded-md bg-muted p-3 text-foreground">
          <p>
            TP berikut belum memiliki aktivitas penilaian dan tidak ikut dihitung:{" "}
            {readiness.unassessedObjectives.map((objective) => objective.title).join(", ")}.
          </p>
        </div>
      )}

      {readiness.canLock && (
        <p>
          Setelah dikunci, pengumpulan siswa serta perubahan tugas, kuis, dan nilai akan ditutup
          sampai Guru membuka kembali Buku Nilai.
        </p>
      )}
    </div>
  );
}

function GradebookTableBody({
  data,
  onOpenHistory,
  namaWidth,
  namaSticky,
  tpColumnWidth,
  nilaiColumnWidth,
  riwayatColumnWidth,
  tableMinWidthPx,
  nilaiAkhirLabel,
  unlockedLabel,
  wrapperClassName,
}: {
  data: GradebookData;
  onOpenHistory: (student: GradebookStudentRow) => void;
  namaWidth: string;
  namaSticky?: boolean;
  tpColumnWidth: string;
  nilaiColumnWidth: string;
  riwayatColumnWidth: string;
  tableMinWidthPx: number;
  nilaiAkhirLabel: string;
  unlockedLabel: string;
  wrapperClassName?: string;
}) {
  return (
    <div className={`overflow-x-auto rounded-md border scrollbar-hide ${wrapperClassName ?? ""}`}>
      <table
        className="w-full table-fixed text-[clamp(0.6875rem,0.65rem+0.2cqw,0.8125rem)]"
        style={{ minWidth: `${tableMinWidthPx}px` }}
      >
        <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th
              className={cn("border-r p-2 text-left", namaSticky && "sticky left-0 z-10 bg-muted")}
              style={{ width: namaWidth }}
            >
              Nama Siswa
            </th>
            {data.tpColumns.map((tp, i) => (
              <th
                key={tp.id}
                className="border-r p-2 text-left"
                style={{ width: tpColumnWidth }}
                title={tp.title}
              >
                TP {i + 1}
              </th>
            ))}
            <th
              className="border-r whitespace-nowrap p-2 text-left"
              style={{ width: nilaiColumnWidth }}
            >
              {nilaiAkhirLabel}
            </th>
            <th className="p-2 text-left" style={{ width: riwayatColumnWidth }}>
              Riwayat
            </th>
          </tr>
        </thead>
        <tbody>
          {data.students.map((st) => (
            <tr key={st.studentId} className="border-b last:border-0">
              <td className={cn("border-r p-2", namaSticky && "sticky left-0 z-10 bg-background")}>
                <button
                  type="button"
                  onClick={() => onOpenHistory(st)}
                  className="whitespace-normal text-left font-bold wrap-break-word hover:underline"
                >
                  {st.fullName}
                </button>
              </td>
              {data.tpColumns.map((tp) => (
                <td key={tp.id} className="border-r p-2">
                  {st.tpAverages[tp.id] ?? <span className="text-muted-foreground">-</span>}
                </td>
              ))}
              <td className="border-r p-2">
                {data.isLocked ? (
                  <span className="font-display text-[clamp(0.9375rem,0.85rem+0.3cqw,1.125rem)] font-bold text-primary">
                    {st.finalGrade ?? "-"}
                  </span>
                ) : (
                  <span className="text-[clamp(0.625rem,0.58rem+0.2cqw,0.75rem)] text-muted-foreground">
                    {unlockedLabel}
                  </span>
                )}
              </td>
              <td className="p-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-[clamp(1.75rem,1.6rem+0.6cqw,2rem)] rounded-md"
                  onClick={() => onOpenHistory(st)}
                  aria-label="Lihat riwayat"
                >
                  <Eye className="size-[clamp(0.875rem,0.8rem+0.4cqw,1.125rem)]" />
                </Button>
              </td>
            </tr>
          ))}
          {data.students.length === 0 && (
            <tr>
              <td
                colSpan={data.tpColumns.length + 3}
                className="p-6 text-center text-sm text-muted-foreground"
              >
                Belum ada siswa di kelas ini.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
