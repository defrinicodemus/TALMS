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
import { Download, Eye, Loader2, Lock, LockOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeacherClassSubject } from "@/lib/data/teaching";
import type { GradebookData, GradebookStudentRow } from "@/lib/data/gradebook";
import { lockAndCalculateGrades, unlockGradebook } from "./actions";
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
      const result = await lockAndCalculateGrades(classId, subjectId);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  function handleUnlock() {
    startTransition(async () => {
      const result = await unlockGradebook(classId, subjectId);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
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
  isPending,
  onLock,
  onUnlock,
}: {
  data: GradebookData;
  isPending: boolean;
  onLock: () => void;
  onUnlock: () => void;
}) {
  return data.isLocked ? (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 rounded-md bg-muted px-4 py-2.5 text-[clamp(0.8125rem,0.76rem+0.22cqw,0.9375rem)] text-muted-foreground">
        <Lock className="size-[clamp(0.875rem,0.8rem+0.4cqw,1.125rem)]" /> Buku nilai dikunci pada{" "}
        {data.lockedAt &&
          new Date(data.lockedAt).toLocaleDateString("id-ID", {
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
    <AlertDialog>
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
          <AlertDialogTitle>Kunci dan hitung nilai akhir sekarang?</AlertDialogTitle>
          <AlertDialogDescription>
            Semua nilai TP akan dihitung menjadi Nilai Akhir untuk seluruh siswa di kelas ini, dan
            tidak akan bisa diubah lagi setelahnya. Pastikan semua tugas dan kuis sudah dinilai
            sebelum mengunci.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction onClick={onLock}>Kunci & Hitung</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
