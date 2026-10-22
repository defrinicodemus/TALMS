"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ResponsiveDialogContent } from "@/components/ResponsiveDialogContent";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  GradebookStudentRow,
  HistoryAssignmentRow,
  HistoryMaterialRow,
  HistoryTpGroup,
} from "@/lib/data/gradebook";
import type { StudentHistoryData } from "@/lib/data/gradebook";
import { fetchStudentHistory } from "./actions";

const FLUID_LABEL = "text-[clamp(0.6875rem,0.65rem+0.2cqw,0.8125rem)]";
const FLUID_BODY = "text-[clamp(0.8125rem,0.76rem+0.22cqw,0.9375rem)]";
const FLUID_TITLE = "text-[clamp(1rem,0.875rem+0.45cqw,1.25rem)]";

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("id-ID", {
    timeZone: "Asia/Makassar",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function StudentHistoryDialog({
  student,
  open,
  classId,
  subjectId,
  onClose,
}: {
  student: GradebookStudentRow | null;
  open: boolean;
  classId: string;
  subjectId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<StudentHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    if (!student) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStudentHistory(student.studentId, classId, subjectId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setError("Riwayat belajar belum dapat dimuat. Periksa koneksi lalu coba lagi.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [student, classId, subjectId, requestKey]);

  if (!student) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <ResponsiveDialogContent
        title={`Riwayat Belajar - ${student.fullName}`}
        className="sm:h-[80vh] sm:max-w-[75vw]"
      >
        <div className="@container p-4 sm:p-6">
          {loading && <p className="text-sm text-muted-foreground">Memuat riwayat...</p>}

          {!loading && error && (
            <div role="alert" className="space-y-3 text-sm">
              <p>{error}</p>
              <Button variant="outline" onClick={() => setRequestKey((value) => value + 1)}>
                Coba Lagi
              </Button>
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* Mobile: vertical, card-based per TP */}
              <div className="space-y-4 sm:hidden">
                <div>
                  <div className={`font-display ${FLUID_TITLE} font-bold`}>{student.fullName}</div>
                  <div className={`${FLUID_LABEL} text-muted-foreground`}>
                    NISN: {student.nisn ?? "-"}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <QuickInfoCard
                    emoji="📖"
                    label="Progres Materi"
                    value={`${data.materialsViewedPercent}% Dibaca`}
                  />
                  <QuickInfoCard
                    emoji="🏆"
                    label="Rata-rata Tugas"
                    value={`${data.averageTugas ?? "-"} / 100`}
                  />
                </div>
                <div className="flex justify-center">
                  <div className="w-1/2">
                    <QuickInfoCard
                      emoji="🎮"
                      label="Rata-rata Kuis"
                      value={`${data.averageKuis ?? "-"} / 100`}
                    />
                  </div>
                </div>

                <Tabs defaultValue="materi">
                  <TabsList className={`rounded-md ${FLUID_BODY}`}>
                    <TabsTrigger value="materi" className={`rounded-md ${FLUID_BODY}`}>
                      Materi
                    </TabsTrigger>
                    <TabsTrigger value="tugas" className={`rounded-md ${FLUID_BODY}`}>
                      Tugas
                    </TabsTrigger>
                    <TabsTrigger value="kuis" className={`rounded-md ${FLUID_BODY}`}>
                      Kuis
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="materi" className="mt-4 space-y-4">
                    {data.materialsByTp.length === 0 && (
                      <p className="p-4 text-center text-sm text-muted-foreground">
                        Belum ada materi.
                      </p>
                    )}
                    {data.materialsByTp.map((group) => (
                      <MobileTpSection
                        key={group.tpId}
                        group={group}
                        renderItem={(item) => <MobileMaterialCard item={item} />}
                      />
                    ))}
                  </TabsContent>

                  <TabsContent value="tugas" className="mt-4 space-y-4">
                    {data.tugasByTp.length === 0 && (
                      <p className="p-4 text-center text-sm text-muted-foreground">
                        Belum ada tugas.
                      </p>
                    )}
                    {data.tugasByTp.map((group) => (
                      <MobileTpSection
                        key={group.tpId}
                        group={group}
                        renderItem={(item) => (
                          <MobileAssignmentCard item={item} dateLabel="Dikumpulkan" />
                        )}
                      />
                    ))}
                  </TabsContent>

                  <TabsContent value="kuis" className="mt-4 space-y-4">
                    {data.kuisByTp.length === 0 && (
                      <p className="p-4 text-center text-sm text-muted-foreground">
                        Belum ada kuis.
                      </p>
                    )}
                    {data.kuisByTp.map((group) => (
                      <MobileTpSection
                        key={group.tpId}
                        group={group}
                        renderItem={(item) => (
                          <MobileAssignmentCard item={item} dateLabel="dikerjakan" />
                        )}
                      />
                    ))}
                  </TabsContent>
                </Tabs>
              </div>

              {/* Desktop: table-based per TP */}
              <div className="hidden sm:block">
                <div className="flex items-center gap-3">
                  <div className="grid size-[clamp(2.75rem,2.4rem+1.2cqw,3.5rem)] shrink-0 place-items-center rounded-full bg-primary-soft/50 text-[clamp(1.25rem,1.1rem+0.6cqw,1.5rem)]">
                    {student.avatar ?? "🙂"}
                  </div>
                  <div>
                    <div className={`font-display ${FLUID_TITLE} font-bold`}>
                      Riwayat Belajar: {student.fullName}
                    </div>
                    <div className={`${FLUID_LABEL} text-muted-foreground`}>
                      NISN: {student.nisn ?? "-"}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <QuickInfoCard
                    emoji="📖"
                    label="Progres Materi"
                    value={`${data.materialsViewedPercent}% Dibaca`}
                  />
                  <QuickInfoCard
                    emoji="🏆"
                    label="Rata-rata Tugas"
                    value={`${data.averageTugas ?? "-"} / 100`}
                  />
                  <QuickInfoCard
                    emoji="🎮"
                    label="Rata-rata Kuis"
                    value={`${data.averageKuis ?? "-"} / 100`}
                  />
                </div>

                <Tabs defaultValue="materi" className="mt-4">
                  <TabsList className={`rounded-md ${FLUID_BODY}`}>
                    <TabsTrigger value="materi" className={`rounded-md ${FLUID_BODY}`}>
                      Materi
                    </TabsTrigger>
                    <TabsTrigger value="tugas" className={`rounded-md ${FLUID_BODY}`}>
                      Tugas
                    </TabsTrigger>
                    <TabsTrigger value="kuis" className={`rounded-md ${FLUID_BODY}`}>
                      Kuis
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="materi" className="mt-4 space-y-4">
                    {data.materialsByTp.length === 0 && (
                      <p className="p-4 text-center text-sm text-muted-foreground">
                        Belum ada materi.
                      </p>
                    )}
                    {data.materialsByTp.map((group) => (
                      <DesktopMaterialTable key={group.tpId} group={group} />
                    ))}
                  </TabsContent>

                  <TabsContent value="tugas" className="mt-4 space-y-4">
                    {data.tugasByTp.length === 0 && (
                      <p className="p-4 text-center text-sm text-muted-foreground">
                        Belum ada tugas.
                      </p>
                    )}
                    {data.tugasByTp.map((group) => (
                      <DesktopAssignmentTable
                        key={group.tpId}
                        group={group}
                        columnLabel="Nama Tugas"
                        dateLabel="Tanggal Kumpul"
                      />
                    ))}
                  </TabsContent>

                  <TabsContent value="kuis" className="mt-4 space-y-4">
                    {data.kuisByTp.length === 0 && (
                      <p className="p-4 text-center text-sm text-muted-foreground">
                        Belum ada kuis.
                      </p>
                    )}
                    {data.kuisByTp.map((group) => (
                      <DesktopAssignmentTable
                        key={group.tpId}
                        group={group}
                        columnLabel="Nama Kuis"
                        dateLabel="Tanggal Dikerjakan"
                      />
                    ))}
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </div>
      </ResponsiveDialogContent>
    </Dialog>
  );
}

function QuickInfoCard({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <Card className="rounded-md border-0 bg-muted/40 p-4">
      <div className={`${FLUID_LABEL} text-muted-foreground`}>
        {emoji} {label}
      </div>
      <div className={`mt-1 font-display ${FLUID_TITLE} font-bold`}>{value}</div>
    </Card>
  );
}

function MobileTpSection<T extends { id: string }>({
  group,
  renderItem,
}: {
  group: HistoryTpGroup<T>;
  renderItem: (item: T) => React.ReactNode;
}) {
  return (
    <div>
      <div className={`mb-2 font-display ${FLUID_BODY} font-bold`}>{group.tpTitle}</div>
      <div className="space-y-2">
        {group.items.map((item) => (
          <div key={item.id}>{renderItem(item)}</div>
        ))}
      </div>
    </div>
  );
}

function MobileMaterialCard({ item }: { item: HistoryMaterialRow }) {
  return (
    <Card className="rounded-md border p-3">
      <div className={`${FLUID_BODY} font-medium`}>{item.title}</div>
      <div
        className={`mt-1 ${FLUID_LABEL} ${item.viewed ? "text-primary" : "text-muted-foreground"}`}
      >
        {item.viewed ? "✓ Sudah Dilihat" : "Belum Dilihat"}
      </div>
      <div className={`mt-0.5 ${FLUID_LABEL} text-muted-foreground`}>
        {formatDate(item.viewedAt)}
      </div>
    </Card>
  );
}

function MobileAssignmentCard({
  item,
  dateLabel,
}: {
  item: HistoryAssignmentRow;
  dateLabel: string;
}) {
  return (
    <Card className="rounded-md border p-3">
      <div className={`${FLUID_BODY} font-medium`}>{item.title}</div>
      <div className={`mt-1 ${FLUID_LABEL}`}>
        Nilai : <span className="font-semibold">{item.score ?? "-"}</span>
      </div>
      <div className={`mt-0.5 ${FLUID_LABEL} text-muted-foreground`}>
        {dateLabel} : {formatDate(item.submittedAt)}
      </div>
    </Card>
  );
}

function DesktopMaterialTable({ group }: { group: HistoryTpGroup<HistoryMaterialRow> }) {
  return (
    <div>
      <div className={`mb-2 font-display ${FLUID_BODY} font-bold`}>{group.tpTitle}</div>
      <div className="overflow-hidden rounded-md border">
        <table className={`w-full table-fixed ${FLUID_LABEL}`}>
          <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="border-r p-2 text-left">Nama Materi</th>
              <th className="w-32 border-r p-2 text-left">Status</th>
              <th className="w-36 p-2 text-left">Tanggal Dilihat</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((m) => (
              <tr key={m.id} className="border-b last:border-0">
                <td className="border-r p-2 font-medium">{m.title}</td>
                <td className="border-r p-2">
                  {m.viewed ? (
                    <span className="text-primary">Sudah Dilihat</span>
                  ) : (
                    <span className="text-muted-foreground">Belum Dilihat</span>
                  )}
                </td>
                <td className="p-2 text-muted-foreground">{formatDate(m.viewedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DesktopAssignmentTable({
  group,
  columnLabel,
  dateLabel,
}: {
  group: HistoryTpGroup<HistoryAssignmentRow>;
  columnLabel: string;
  dateLabel: string;
}) {
  return (
    <div>
      <div className={`mb-2 font-display ${FLUID_BODY} font-bold`}>{group.tpTitle}</div>
      <div className="overflow-hidden rounded-md border">
        <table className={`w-full table-fixed ${FLUID_LABEL}`}>
          <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="border-r p-2 text-left">{columnLabel}</th>
              <th className="w-36 border-r p-2 text-left">{dateLabel}</th>
              <th className="w-20 p-2 text-left">Nilai</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((item) => (
              <tr key={item.id} className="border-b last:border-0">
                <td className="border-r p-2 font-medium">{item.title}</td>
                <td className="border-r p-2 text-muted-foreground">
                  {formatDate(item.submittedAt)}
                </td>
                <td className="p-2 font-semibold">{item.score ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
