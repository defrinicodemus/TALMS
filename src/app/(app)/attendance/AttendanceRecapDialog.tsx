"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Download, Loader2 } from "lucide-react";
import type { AttendanceRecap, AttendanceStatus } from "@/lib/data/attendance";
import { fetchAttendanceRecap } from "./actions";

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  hadir: "Hadir",
  sakit: "Sakit",
  izin: "Izin",
  alfa: "Alfa",
};

const STATUS_LETTER: Record<AttendanceStatus, string> = {
  hadir: "H",
  sakit: "S",
  izin: "I",
  alfa: "A",
};

const STATUS_BADGE: Record<AttendanceStatus, string> = {
  hadir: "bg-emerald-100 text-emerald-700",
  sakit: "bg-amber-100 text-amber-700",
  izin: "bg-blue-100 text-blue-700",
  alfa: "bg-red-100 text-red-700",
};

export function AttendanceRecapDialog({
  classId,
  subjectId,
  className,
  subjectName,
  onClose,
}: {
  classId: string;
  subjectId: string;
  className: string;
  subjectName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<AttendanceRecap | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const exporting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAttendanceRecap(classId, subjectId).then((result) => {
      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [classId, subjectId]);

  async function handleExport() {
    if (!data || data.meetingNumbers.length === 0 || exporting.current) return;
    exporting.current = true;
    setIsExporting(true);
    try {
      const XLSX = await import("xlsx");
      const rows = data.students.map((st) => {
        const row: Record<string, string> = { "Nama Siswa": st.fullName, NISN: st.nisn ?? "-" };
        for (const n of data.meetingNumbers) {
          const status = st.statusByMeeting[n];
          row[`Pertemuan ${n}`] = status ? STATUS_LABEL[status] : "-";
        }
        return row;
      });
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Rekap Presensi");
      await XLSX.writeFile(workbook, `Rekap-Presensi-${className}-${subjectName}.xlsx`);
    } catch {
      toast.error("Ekspor Excel gagal. Coba lagi atau muat ulang halaman.");
    } finally {
      exporting.current = false;
      setIsExporting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] w-[90vw] max-w-5xl overflow-y-auto">
        <div>
          <div className="font-display text-lg font-bold">Rekap Presensi</div>
          <div className="text-xs text-muted-foreground">
            {className} - {subjectName}
          </div>
        </div>

        {loading && <p className="mt-6 text-sm text-muted-foreground">Memuat rekap presensi...</p>}

        {!loading && data && (
          <div className="mt-4 min-w-0 space-y-4">
            {data.meetingNumbers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada pertemuan yang diisi presensinya.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="sticky left-0 z-10 bg-muted/50 p-3 text-left">Nama Siswa</th>
                      <th className="p-3 text-left">NISN</th>
                      {data.meetingNumbers.map((n) => (
                        <th key={n} className="whitespace-nowrap p-3 text-center">
                          P{n}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.students.map((st) => (
                      <tr key={st.studentId} className="border-t">
                        <td className="sticky left-0 z-10 bg-background p-3 font-medium">
                          {st.fullName}
                        </td>
                        <td className="p-3 text-muted-foreground">{st.nisn ?? "-"}</td>
                        {data.meetingNumbers.map((n) => {
                          const status = st.statusByMeeting[n];
                          return (
                            <td key={n} className="p-3 text-center">
                              {status ? (
                                <span
                                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${STATUS_BADGE[status]}`}
                                  title={STATUS_LABEL[status]}
                                >
                                  {STATUS_LETTER[status]}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {data.students.length === 0 && (
                      <tr>
                        <td
                          colSpan={data.meetingNumbers.length + 2}
                          className="p-6 text-center text-muted-foreground"
                        >
                          Belum ada siswa di kelas ini.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="button"
                className="rounded-md bg-emerald-700 hover:bg-emerald-800"
                disabled={isExporting || data.meetingNumbers.length === 0}
                aria-busy={isExporting}
                onClick={handleExport}
              >
                {isExporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {isExporting ? "Menyiapkan Excel…" : "Ekspor ke Excel"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
