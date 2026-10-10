import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { unzipSync, strFromU8 } from "fflate";
import * as XLSX from "xlsx";

const require = createRequire(import.meta.url);
const [dataCode, exportCode, routeCode] = await Promise.all(
  [
    "../../src/lib/data/school-export.ts",
    "../../src/lib/exports/school.ts",
    "../../src/app/api/exports/school/route.ts",
  ].map(
    async (file) =>
      ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }).outputText,
  ),
);

function fixture() {
  return {
    schools: [
      { id: "school", name: "SMP Contoh", address: "Jalan Sekolah 1", phone: "001234" },
      { id: "other-school", name: "Sekolah Lain" },
    ],
    academic_years: [
      {
        id: "active",
        school_id: "school",
        year_label: "2025/2026",
        semester: "genap",
        is_active: true,
      },
      {
        id: "past",
        school_id: "school",
        year_label: "2025/2026",
        semester: "ganjil",
        is_active: false,
      },
      {
        id: "future",
        school_id: "school",
        year_label: "2026/2027",
        semester: "ganjil",
        is_active: false,
      },
      {
        id: "other-active",
        school_id: "other-school",
        year_label: "2025/2026",
        semester: "genap",
        is_active: true,
      },
    ],
    classes: [
      {
        id: "class",
        school_id: "school",
        academic_year_id: "active",
        name: "VII A",
        grade_level: 7,
        homeroom_teacher_id: "homeroom",
      },
      {
        id: "past-class",
        school_id: "school",
        academic_year_id: "past",
        name: "VII Lama",
        grade_level: 7,
        homeroom_teacher_id: null,
      },
      {
        id: "future-class",
        school_id: "school",
        academic_year_id: "future",
        name: "VIII Baru",
        grade_level: 8,
        homeroom_teacher_id: null,
      },
      {
        id: "other-class",
        school_id: "other-school",
        academic_year_id: "other-active",
        name: "Kelas Sekolah Lain",
        grade_level: 7,
        homeroom_teacher_id: null,
      },
    ],
    profiles: [
      { id: "admin", school_id: "school", role: "admin", full_name: "Admin Rahasia" },
      {
        id: "student",
        school_id: "school",
        role: "student",
        class_id: "class",
        full_name: '=HYPERLINK("https://example.test")',
        nisn: "0012345678",
      },
      {
        id: "student-past",
        school_id: "school",
        role: "student",
        class_id: "past-class",
        full_name: "Siswa Lama",
      },
      {
        id: "student-future",
        school_id: "school",
        role: "student",
        class_id: "future-class",
        full_name: "Siswa Baru",
      },
      {
        id: "student-unplaced",
        school_id: "school",
        role: "student",
        class_id: null,
        full_name: "Belum Ditempatkan",
      },
      {
        id: "student-other",
        school_id: "other-school",
        role: "student",
        class_id: "other-class",
        full_name: "Siswa Sekolah Lain",
      },
      {
        id: "teacher",
        school_id: "school",
        role: "teacher",
        full_name: "Guru Mapel",
        nip: "001234567890123456",
      },
      {
        id: "homeroom",
        school_id: "school",
        role: "teacher",
        full_name: "Wali Kelas",
        nip: "009876543210987654",
      },
      { id: "unassigned", school_id: "school", role: "teacher", full_name: "Guru Tanpa Penugasan" },
      {
        id: "principal",
        school_id: "school",
        role: "principal",
        full_name: "Kepala Sekolah",
        nip: null,
      },
      {
        id: "other-principal",
        school_id: "other-school",
        role: "principal",
        full_name: "Kepsek Sekolah Lain",
      },
    ],
    subjects: [
      { id: "subject", school_id: "school", name: "Matematika", code: "001" },
      { id: "unused-subject", school_id: "school", name: "Belum Digunakan", code: "002" },
      { id: "other-subject", school_id: "other-school", name: "Mapel Sekolah Lain", code: "003" },
    ],
    class_teacher_subjects: [
      { id: "assignment", class_id: "class", subject_id: "subject", teacher_id: "teacher" },
      {
        id: "past-assignment",
        class_id: "past-class",
        subject_id: "unused-subject",
        teacher_id: "unassigned",
      },
      {
        id: "future-assignment",
        class_id: "future-class",
        subject_id: "unused-subject",
        teacher_id: "unassigned",
      },
      {
        id: "other-assignment",
        class_id: "other-class",
        subject_id: "other-subject",
        teacher_id: "other-principal",
      },
    ],
  };
}

// Real data reader, XLSX/ZIP writer and HTTP handler, with a read-only DB double.
// Unknown tables, broad SELECTs, or mutation methods cannot pass this harness.
function setup(options = {}) {
  const tables = fixture();
  options.change?.(tables);
  const initial = structuredClone(tables);
  const reads = [];
  const errors = [];
  let activeReads = 0;
  const client = {
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
      const query = {
        table,
        filters: [],
        columns: [],
        from: 0,
        to: 999,
        ordered: false,
        select(columns) {
          assert.ok(!columns.includes("*"));
          this.columns = columns.split(",").map((column) => column.trim());
          return this;
        },
        eq(key, value) {
          this.filters.push((row) => row[key] === value);
          return this;
        },
        in(key, values) {
          if (key === "class_id") assert.ok(values.length <= 100);
          this.filters.push((row) => values.includes(row[key]));
          return this;
        },
        order(key) {
          assert.equal(key, "id");
          this.ordered = true;
          return this;
        },
        range(from, to) {
          assert.ok(this.ordered);
          this.from = from;
          this.to = to;
          return this;
        },
        execute(single = false) {
          reads.push({ table, columns: this.columns, from: this.from });
          if (options.hostedClassesSchema && table === "classes") {
            const columns = new Set(["id", "school_id", "academic_year_id", "name", "grade_level"]);
            const missing = this.columns.find((column) => !columns.has(column));
            if (missing)
              return {
                data: null,
                error: { code: "42703", message: `column classes.${missing} does not exist` },
              };
          }
          if (table === "academic_years" && ++activeReads === 2) options.beforeRecheck?.(tables);
          if (
            options.failTable === table ||
            (options.failSecondPage && table === "profiles" && this.from > 0)
          )
            return { data: null, error: { message: "Private database failure detail" } };
          let rows = tables[table].filter((row) => this.filters.every((filter) => filter(row)));
          if (this.ordered) rows = rows.toSorted((a, b) => a.id.localeCompare(b.id));
          rows = rows
            .slice(this.from, this.to + 1)
            .map((row) => Object.fromEntries(this.columns.map((key) => [key, row[key] ?? null])));
          if (single && rows.length > 1) return { data: null, error: { message: "Multiple rows" } };
          return { data: single ? (rows[0] ?? null) : rows, error: null };
        },
        async single() {
          return this.execute(true);
        },
        async maybeSingle() {
          return this.execute(true);
        },
        then(resolve, reject) {
          return Promise.resolve(this.execute()).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const modules = {
    "server-only": {},
    "@/lib/data/profile": {
      getSessionUser: async () =>
        options.role === null ? null : { id: "admin", role: options.role ?? "admin" },
    },
    "@/lib/supabase/server": { createClient: async () => client },
  };
  function evaluate(code) {
    const exports = {};
    new Function("require", "exports", "console", code)(
      (name) => (Object.hasOwn(modules, name) ? modules[name] : require(name)),
      exports,
      { ...console, error: (...args) => errors.push(args) },
    );
    return exports;
  }
  const data = (modules["@/lib/data/school-export"] = evaluate(dataCode));
  const writer = (modules["@/lib/exports/school"] = evaluate(exportCode));
  const route = evaluate(routeCode);
  return {
    tables,
    initial,
    reads,
    errors,
    client,
    data,
    writer,
    request: (query = "") =>
      route.GET({ nextUrl: new URL(`https://lms.test/api/exports/school${query}`) }),
    async read() {
      const { school, period } = await data.getSchoolExportContext(client, "admin");
      return data.readSchoolExportData(client, school, period);
    },
  };
}

for (const role of [null, "student", "teacher", "principal"]) {
  test(`export rejects ${role ?? "anonymous"} before reading school data`, async () => {
    const env = setup({ role });
    const response = await env.request();
    assert.equal(response.status, role === null ? 401 : 403);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(env.reads, []);
  });
}

test("fresh admin profile is checked and a missing school is not replaced by an arbitrary school", async () => {
  for (const [values, status] of [
    [{ role: "teacher" }, 403],
    [{ school_id: null }, 409],
  ]) {
    const env = setup({ change: (tables) => Object.assign(tables.profiles[0], values) });
    assert.equal((await env.request()).status, status);
    assert.deepEqual(
      env.reads.map((row) => row.table),
      ["profiles"],
    );
  }
});

test("export requires an active period and rejects a stale or forged period ID", async () => {
  const closed = setup({
    change: (tables) => tables.academic_years.forEach((row) => (row.is_active = false)),
  });
  assert.equal((await closed.request()).status, 409);
  for (const periodId of ["past", "future", "other-active"]) {
    const env = setup();
    assert.equal((await env.request(`?periodId=${periodId}`)).status, 409);
    assert.ok(!env.reads.some((row) => row.table === "classes"));
  }
});

test("export works with the hosted classes schema without a homeroom column", async () => {
  const env = setup({ hostedClassesSchema: true });
  const response = await env.request("?periodId=active");
  assert.equal(response.status, 200);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.equal(Object.keys(files).length, 5);
  const structure = XLSX.read(files["Struktur Akademik.xlsx"], { type: "array" });
  const headers = XLSX.utils.sheet_to_json(structure.Sheets["Kelas dan Rombel"], { header: 1 })[0];
  assert.ok(!headers.includes("Wali Kelas"));
  const assignments = XLSX.read(files["Penugasan Guru.xlsx"], { type: "array" });
  assert.ok(!assignments.SheetNames.includes("Wali Kelas"));
});

test("export scopes current placements, teachers and subjects to the admin school and active semester", async () => {
  const env = setup();
  const data = await env.read();
  assert.deepEqual(
    data.classes.map((row) => row.id),
    ["class"],
  );
  assert.deepEqual(
    data.students.map((row) => row.id),
    ["student"],
  );
  assert.deepEqual(
    data.assignments.map((row) => row.id),
    ["assignment"],
  );
  assert.deepEqual(
    data.subjects.map((row) => row.id),
    ["subject"],
  );
  assert.deepEqual(data.staff.map((row) => row.id).sort(), ["principal", "teacher"]);
  assert.deepEqual(env.tables, env.initial, "Export must not modify any data");
});

for (const failTable of [
  "schools",
  "academic_years",
  "classes",
  "profiles",
  "subjects",
  "class_teacher_subjects",
]) {
  test(`read failure on ${failTable} never returns a partial ZIP`, async () => {
    const env = setup({ failTable });
    const response = await env.request();
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.doesNotMatch(await response.text(), /Private database failure/);
    assert.equal(env.errors.length, 1, "Server failures should be logged for diagnostics");
    if (["classes", "subjects", "class_teacher_subjects"].includes(failTable))
      assert.equal(env.errors[0][1].cause.message, "Private database failure detail");
  });
}

for (const change of [
  (tables) => {
    tables.academic_years[0].is_active = false;
  },
  (tables) => {
    tables.academic_years[0].is_active = false;
    tables.academic_years[2].is_active = true;
  },
  (tables) => {
    tables.academic_years[0].year_label = "2028/2029";
  },
]) {
  test("period change during generation discards the ZIP", async () => {
    const response = await setup({ beforeRecheck: change }).request();
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /berubah saat ekspor/);
  });
}

test("multiple active periods and incomplete cross-school assignments fail closed", async () => {
  for (const change of [
    (tables) => {
      tables.academic_years[2].is_active = true;
    },
    (tables) => {
      tables.class_teacher_subjects[0].teacher_id = "other-principal";
    },
    (tables) => {
      tables.class_teacher_subjects[0].subject_id = "other-subject";
    },
  ]) {
    const response = await setup({ change }).request();
    assert.ok(response.status >= 400);
  }
});

const manyStudents = (tables) => {
  for (let index = 0; index < 1201; index++)
    tables.profiles.push({
      id: `student-${String(index).padStart(5, "0")}`,
      school_id: "school",
      role: "student",
      full_name: `Siswa ${index}`,
      nisn: `000${index}`,
      class_id: "class",
    });
};
test("more than 1000 students are exported without truncation and a failed later page aborts", async () => {
  const env = setup({ change: manyStudents });
  const data = await env.read();
  assert.equal(data.students.length, 1202);
  assert.equal(new Set(data.students.map((row) => row.id)).size, 1202);
  const response = await setup({ change: manyStudents, failSecondPage: true }).request();
  assert.equal(response.status, 500);
});

test("class filters are chunked without losing students in later class groups", async () => {
  const env = setup({
    change: (tables) => {
      for (let index = 0; index < 120; index++) {
        const id = `c-${index}`;
        tables.classes.push({
          id,
          school_id: "school",
          academic_year_id: "active",
          name: id,
          grade_level: 7,
          homeroom_teacher_id: null,
        });
        tables.profiles.push({
          id: `s-${index}`,
          school_id: "school",
          role: "student",
          full_name: id,
          class_id: id,
        });
      }
    },
  });
  const data = await env.read();
  assert.equal(data.classes.length, 121);
  assert.equal(data.students.length, 121);
  assert.equal(new Set(data.students.map((row) => row.id)).size, 121);
});

test("HTTP download contains five readable Excel files with preserved identifiers, metadata, filters and frozen headers", async () => {
  const env = setup();
  const response = await env.request("?periodId=active&schoolId=other-school");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.match(
    response.headers.get("content-disposition"),
    /Data-Sekolah-SMP-Contoh-2025-2026-Genap-/,
  );
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual(
    Object.keys(files).sort(),
    [
      "Profil Sekolah.xlsx",
      "Struktur Akademik.xlsx",
      "Data Siswa.xlsx",
      "Data Guru dan Kepsek.xlsx",
      "Penugasan Guru.xlsx",
    ].sort(),
  );
  for (const bytes of Object.values(files)) {
    const workbook = XLSX.read(bytes, { type: "array", cellStyles: true });
    assert.ok(workbook.SheetNames.includes("Informasi Ekspor"));
    const metadata = XLSX.utils.sheet_to_json(workbook.Sheets["Informasi Ekspor"], { header: 1 });
    assert.deepEqual(metadata[2], ["Tahun Ajaran", "2025/2026"]);
    assert.deepEqual(metadata[3], ["Semester", "Genap"]);
    for (const name of workbook.SheetNames) {
      assert.ok(workbook.Sheets[name]["!autofilter"]);
      assert.ok(workbook.Sheets[name]["!cols"].length > 0);
      const text = JSON.stringify(XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }));
      assert.doesNotMatch(
        text,
        /Sekolah Lain|Siswa Lama|Siswa Baru|Belum Ditempatkan|Guru Tanpa Penugasan|Admin Rahasia/,
      );
    }
    for (const [name, xml] of Object.entries(unzipSync(bytes))) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
        const text = strFromU8(xml);
        assert.match(
          text,
          /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/,
        );
        assert.doesNotMatch(text, /<f[\s>]/);
      }
    }
  }
  const students = XLSX.read(files["Data Siswa.xlsx"], { type: "array", cellNF: true }).Sheets
    .Siswa;
  assert.equal(students.C2.v, "0012345678");
  assert.equal(students.C2.t, "s");
  assert.equal(students.C2.z, "@");
  assert.equal(students.B2.v, '=HYPERLINK("https://example.test")');
  assert.equal(students.B2.t, "s");
  assert.equal(students.B2.f, undefined);
  const staff = XLSX.read(files["Data Guru dan Kepsek.xlsx"], { type: "array" }).Sheets[
    "Guru dan Kepala Sekolah"
  ];
  assert.equal(staff.C2.v, "001234567890123456");
  assert.equal(staff.C2.t, "s");
  const assignment = XLSX.read(files["Penugasan Guru.xlsx"], { type: "array" });
  assert.equal(assignment.Sheets["Guru Mapel"].D2.v, "001");
  assert.deepEqual(env.tables, env.initial);
});

test("empty semester still contains usable headers and no invented student history", async () => {
  const env = setup({
    change: (tables) => {
      tables.classes = [];
      tables.profiles = [tables.profiles[0]];
    },
  });
  const response = await env.request();
  assert.equal(response.status, 200);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.equal(Object.keys(files).length, 5);
  const sheet = XLSX.read(files["Data Siswa.xlsx"], { type: "array" }).Sheets.Siswa;
  assert.equal(sheet["!ref"], "A1:G1");
  assert.equal(sheet.C1.v, "NISN");
});

test("download name is header-safe and uses the export date in WITA", async () => {
  const env = setup();
  const data = await env.read();
  data.school.name = 'SMP / \\\" Sekolah\r\ncontoh';
  const { filename } = env.writer.buildSchoolExport(data, new Date("2026-10-10T18:00:00Z"));
  assert.match(filename, /-2026-10-11\.zip$/);
  assert.match(filename, /^[a-zA-Z0-9.-]+$/);
});
