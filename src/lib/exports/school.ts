import "server-only";
import * as XLSX from "xlsx";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { SchoolExportData } from "@/lib/data/school-export";

type Cell = string | number | null;
type Table = { name: string; headers: string[]; rows: Cell[][]; widths: number[] };

function makeWorkbook(tables: Table[], info: Table, schoolName: string, exportedAt: Date) {
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: "Ekspor Data Sekolah", Author: schoolName, CreatedDate: exportedAt };
  for (const table of [...tables, info]) {
    // Explicit string cells preserve identifiers and never interpret user input as formulas.
    const rows = [table.headers, ...table.rows].map((row) =>
      row.map((value) => (typeof value === "number" ? value : { t: "s", v: value ?? "", z: "@" })),
    );
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = table.widths.map((wch) => ({ wch }));
    sheet["!autofilter"] = { ref: sheet["!ref"]! };
    XLSX.utils.book_append_sheet(workbook, sheet, table.name);
  }

  // The installed SheetJS CE writer omits frozen panes. Add only the view XML
  // to our own generated worksheets; cell data is still serialized by SheetJS.
  const files = unzipSync(
    new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" })),
  );
  const frozenView =
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
  for (const path of Object.keys(files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
    const xml = strFromU8(files[path]);
    const view = /<sheetViews>[\s\S]*?<\/sheetViews>/;
    if (!view.test(xml)) throw new Error("Worksheet view is missing");
    files[path] = strToU8(xml.replace(view, frozenView));
  }
  return zipSync(files, { level: 6 });
}

export function buildSchoolExport(data: SchoolExportData, exportedAt = new Date()) {
  const { school, period } = data;
  const semester = period.semester === "ganjil" ? "Ganjil" : "Genap";
  const periodCells = [period.year_label, semester];
  const periodHeaders = ["Tahun Ajaran", "Semester"];
  const timestamp = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "long",
    timeZone: "Asia/Makassar",
  }).format(exportedAt);
  const info: Table = {
    name: "Informasi Ekspor",
    headers: ["Keterangan", "Isi"],
    widths: [26, 90],
    rows: [
      ["Nama Sekolah", school.name],
      ["Tahun Ajaran", period.year_label],
      ["Semester", semester],
      ["Waktu Ekspor (WITA)", timestamp],
      ["Cakupan", "Data administrasi pada semester aktif saat ekspor."],
      ["Penempatan Siswa", "Penempatan kelas saat ini; bukan riwayat penempatan siswa."],
      [
        "Guru dan Kepala Sekolah",
        "Guru mapel terkait semester ini dan kepala sekolah saat ekspor.",
      ],
      ["Arsip Semester", "Unduh sebelum menonaktifkan semester dan memindahkan siswa."],
    ],
  };
  const compareName = (a: string, b: string) => a.localeCompare(b, "id", { numeric: true });
  const classes = [...data.classes].sort(
    (a, b) => a.grade_level - b.grade_level || compareName(a.name, b.name),
  );
  const classMap = new Map(classes.map((row) => [row.id, row]));
  const classOrder = new Map(classes.map((row, index) => [row.id, index]));
  const staffMap = new Map(data.staff.map((row) => [row.id, row]));
  const subjectMap = new Map(data.subjects.map((row) => [row.id, row]));
  const studentCounts = new Map<string, number>();
  for (const row of data.students)
    studentCounts.set(row.class_id, (studentCounts.get(row.class_id) ?? 0) + 1);
  const students = [...data.students].sort(
    (a, b) =>
      classOrder.get(a.class_id)! - classOrder.get(b.class_id)! ||
      compareName(a.full_name, b.full_name),
  );
  const staff = [...data.staff].sort((a, b) => compareName(a.full_name, b.full_name));
  const subjects = [...data.subjects].sort((a, b) => compareName(a.name, b.name));
  const assignments = [...data.assignments].sort(
    (a, b) =>
      classOrder.get(a.class_id)! - classOrder.get(b.class_id)! ||
      compareName(subjectMap.get(a.subject_id)!.name, subjectMap.get(b.subject_id)!.name),
  );
  const workbooks: Record<string, Table[]> = {
    "Profil Sekolah.xlsx": [
      {
        name: "Profil Sekolah",
        headers: ["Nama Sekolah", "Alamat", "Nomor Telepon"],
        widths: [40, 70, 24],
        rows: [[school.name, school.address, school.phone]],
      },
    ],
    "Struktur Akademik.xlsx": [
      {
        name: "Tahun Ajaran",
        headers: [...periodHeaders, "Status Saat Ekspor"],
        widths: [20, 16, 24],
        rows: [[...periodCells, "Aktif"]],
      },
      {
        name: "Kelas dan Rombel",
        headers: ["No.", "Kelas / Rombel", "Tingkat", "Jumlah Siswa", ...periodHeaders],
        widths: [8, 22, 12, 18, 20, 16],
        rows: classes.map((row, index) => [
          index + 1,
          row.name,
          row.grade_level,
          studentCounts.get(row.id) ?? 0,
          ...periodCells,
        ]),
      },
      {
        name: "Mata Pelajaran",
        headers: ["No.", "Kode Mapel", "Mata Pelajaran", ...periodHeaders],
        widths: [8, 20, 40, 20, 16],
        rows: subjects.map((row, index) => [index + 1, row.code, row.name, ...periodCells]),
      },
    ],
    "Data Siswa.xlsx": [
      {
        name: "Siswa",
        headers: ["No.", "Nama Siswa", "NISN", "Kelas / Rombel", "Tingkat", ...periodHeaders],
        widths: [8, 38, 26, 22, 12, 20, 16],
        rows: students.map((row, index) => [
          index + 1,
          row.full_name,
          row.nisn,
          classMap.get(row.class_id)!.name,
          classMap.get(row.class_id)!.grade_level,
          ...periodCells,
        ]),
      },
    ],
    "Data Guru dan Kepsek.xlsx": [
      {
        name: "Guru dan Kepala Sekolah",
        headers: ["No.", "Nama", "NIP", "Peran", ...periodHeaders],
        widths: [8, 38, 28, 24, 20, 16],
        rows: staff.map((row, index) => [
          index + 1,
          row.full_name,
          row.nip,
          row.role === "principal" ? "Kepala Sekolah" : "Guru",
          ...periodCells,
        ]),
      },
    ],
    "Penugasan Guru.xlsx": [
      {
        name: "Guru Mapel",
        headers: [
          "No.",
          "Nama Guru",
          "NIP",
          "Kode Mapel",
          "Mata Pelajaran",
          "Kelas / Rombel",
          ...periodHeaders,
        ],
        widths: [8, 38, 28, 20, 40, 22, 20, 16],
        rows: assignments.map((row, index) => [
          index + 1,
          staffMap.get(row.teacher_id)!.full_name,
          staffMap.get(row.teacher_id)!.nip ?? "",
          subjectMap.get(row.subject_id)!.code ?? "",
          subjectMap.get(row.subject_id)!.name,
          classMap.get(row.class_id)!.name,
          ...periodCells,
        ]),
      },
    ],
  };
  const files = Object.fromEntries(
    Object.entries(workbooks).map(([name, tables]) => [
      name,
      makeWorkbook(tables, info, school.name, exportedAt),
    ]),
  );
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(exportedAt);
  const safe = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  const filename = `Data-Sekolah-${safe(school.name) || "Sekolah"}-${safe(period.year_label)}-${semester}-${date}.zip`;
  // XLSX files are already compressed, so store them without recompressing.
  return { bytes: zipSync(files, { level: 0 }), filename };
}
