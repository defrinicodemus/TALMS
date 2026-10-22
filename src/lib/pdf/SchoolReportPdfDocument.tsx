import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { SchoolReportData } from "@/lib/data/schoolReport";

export interface SchoolReportPdfProps {
  schoolName: string;
  schoolLogoUrl: string | null;
  yearLabel: string;
  semesterLabel: string;
  printedAt: string;
  data: SchoolReportData;
}

const styles = StyleSheet.create({
  coverPage: {
    padding: "2cm",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 90,
    height: 90,
    marginBottom: 20,
    objectFit: "contain",
  },
  schoolName: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginBottom: 6,
  },
  coverTitle: {
    fontSize: 15,
    fontFamily: "Helvetica",
    textAlign: "center",
    color: "#15803d",
    marginBottom: 36,
  },
  coverMeta: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
  coverMetaRow: {
    display: "flex",
    flexDirection: "row",
    fontSize: 11,
  },
  coverMetaLabel: {
    fontFamily: "Helvetica-Bold",
    width: 100,
  },
  contentPage: {
    padding: "2cm",
    fontSize: 9,
    fontFamily: "Helvetica",
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    color: "#166534",
  },
  subSectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  summaryRow: {
    display: "flex",
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  summaryBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
    padding: 10,
  },
  summaryLabel: {
    fontSize: 8,
    color: "#4b5563",
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
  },
  table: {
    display: "flex",
    flexDirection: "column",
    borderWidth: 1,
    borderColor: "#d1d5db",
    marginBottom: 20,
  },
  tableHeaderRow: {
    display: "flex",
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
  },
  tableRow: {
    display: "flex",
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  tableCellHeader: {
    padding: 5,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  tableCell: {
    padding: 5,
    fontSize: 9,
  },
  footer: {
    position: "absolute",
    bottom: "1cm",
    left: "2cm",
    right: "2cm",
    fontSize: 7,
    color: "#9ca3af",
    textAlign: "center",
  },
});

function SummaryBox({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.summaryBox}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function PdfTable({
  columns,
  widths,
  rows,
}: {
  columns: string[];
  widths: number[];
  rows: string[][];
}) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        {columns.map((col, i) => (
          <Text key={col} style={[styles.tableCellHeader, { width: `${widths[i]}%` }]}>
            {col}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View key={row.join("|") || rowIndex} style={styles.tableRow}>
          {row.map((cell, i) => (
            <Text key={`${i}-${cell}`} style={[styles.tableCell, { width: `${widths[i]}%` }]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
      {rows.length === 0 && (
        <View style={styles.tableRow}>
          <Text style={[styles.tableCell, { width: "100%", textAlign: "center" }]}>
            Tidak ada data.
          </Text>
        </View>
      )}
    </View>
  );
}

export function SchoolReportPdfDocument({
  schoolName,
  schoolLogoUrl,
  yearLabel,
  semesterLabel,
  printedAt,
  data,
}: SchoolReportPdfProps) {
  const formatFraction = (
    actual: number,
    expected: number,
    percent: number | null,
    emptyLabel: string,
  ) => (percent == null ? emptyLabel : `${actual}/${expected} (${percent}%)`);

  const teacherRows = data.teacherRows.map((t) => [
    t.name,
    String(t.materiCount),
    String(t.tugasCount),
    String(t.kuisCount),
    String(t.presensiCount),
    String(t.totalActivity),
  ]);

  const classRows = data.classRows.map((c) => [
    c.className,
    String(c.studentCount),
    formatFraction(c.attendanceHadir, c.attendanceTotal, c.attendancePercent, "Belum ada presensi"),
    formatFraction(c.tugasActual, c.tugasExpected, c.tugasCompletionPercent, "Belum ada tugas"),
    formatFraction(c.kuisActual, c.kuisExpected, c.kuisCompletionPercent, "Belum ada kuis"),
    c.averageGradePercent == null
      ? `— (${c.finalGradebookCount}/${c.totalGradebookCount} final)`
      : `${c.averageGradePercent} (${c.finalGradebookCount}/${c.totalGradebookCount} final)`,
  ]);

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={styles.coverPage}>
        {schoolLogoUrl && <Image src={schoolLogoUrl} style={styles.logo} />}
        <Text style={styles.schoolName}>{schoolName}</Text>
        <Text style={styles.coverTitle}>Laporan Aktivitas LMS</Text>
        <View style={styles.coverMeta}>
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Tahun Ajaran</Text>
            <Text>: {yearLabel}</Text>
          </View>
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Semester</Text>
            <Text>: {semesterLabel}</Text>
          </View>
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Tanggal Cetak</Text>
            <Text>: {printedAt}</Text>
          </View>
        </View>
      </Page>

      <Page size="A4" orientation="portrait" style={styles.contentPage}>
        <Text style={styles.sectionTitle}>1. Ringkasan Sekolah</Text>
        <View style={styles.summaryRow}>
          <SummaryBox label="Total Guru Aktif" value={data.totalGuruAktif} />
          <SummaryBox label="Total Siswa Aktif" value={data.totalSiswaAktif} />
          <SummaryBox label="Materi Aktif" value={data.materiPublishedCount} />
          <SummaryBox
            label="Buku Nilai Final"
            value={`${data.finalGradebookCount}/${data.totalGradebookCount}`}
          />
        </View>

        <Text style={styles.sectionTitle}>2. Aktivitas Pembelajaran</Text>

        <Text style={styles.subSectionTitle}>Rekap Kinerja Guru</Text>
        <PdfTable
          columns={["Nama Guru", "Materi", "Tugas", "Kuis", "Presensi/Jurnal", "Total Aktivitas"]}
          widths={[24, 12, 12, 12, 20, 20]}
          rows={teacherRows}
        />

        <Text style={styles.subSectionTitle}>Rekap Pembelajaran Kelas</Text>
        <PdfTable
          columns={[
            "Kelas",
            "Jumlah Siswa",
            "Kehadiran",
            "Penyelesaian Tugas",
            "Penyelesaian Kuis",
            "Nilai Final (Buku Nilai)",
          ]}
          widths={[16, 14, 18, 18, 18, 16]}
          rows={classRows}
        />

        <Text style={styles.footer} fixed>
          {schoolName} · Laporan Aktivitas LMS · {yearLabel} {semesterLabel}
        </Text>
      </Page>
    </Document>
  );
}
