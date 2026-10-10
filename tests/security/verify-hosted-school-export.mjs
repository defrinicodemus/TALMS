// Explicit read-only verification against the configured Supabase project.
// Usage: node --env-file=.env.local tests/security/verify-hosted-school-export.mjs --period-id=<active-period-id>
// Uses the real reader/writer; checks ZIP in memory without saving personal data.
// The service client verifies schema/data compatibility, not Admin session/RLS behavior.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx/xlsx.mjs";
import * as fflate from "fflate";
import ts from "typescript";

const periodId = process.argv.find((arg) => arg.startsWith("--period-id="))?.split("=")[1];
assert.ok(periodId, "Specify --period-id=<active-period-id>");
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
  assert.ok(process.env[key], `Missing configuration: ${key}`);
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) }),
    },
  },
);
async function load(file) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const imports = { "server-only": {}, xlsx: XLSX, fflate };
  new Function("require", "exports", code)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
    return imports[name];
  }, exports);
  return exports;
}

const reader = await load("../../src/lib/data/school-export.ts");
const writer = await load("../../src/lib/exports/school.ts");
const periodResult = await client
  .from("academic_years")
  .select("school_id")
  .eq("id", periodId)
  .eq("is_active", true)
  .single();
assert.equal(periodResult.error, null, "Could not read requested active period");
const adminResult = await client
  .from("profiles")
  .select("id")
  .eq("school_id", periodResult.data.school_id)
  .eq("role", "admin")
  .limit(1)
  .single();
assert.equal(adminResult.error, null, "Could not read an Admin profile for this school");
const { school, period } = await reader.getSchoolExportContext(client, adminResult.data.id);
assert.equal(period?.id, periodId);
const data = await reader.readSchoolExportData(client, school, period);
const { bytes } = writer.buildSchoolExport(data);
await reader.assertExportPeriodUnchanged(client, school.id, period);
const files = fflate.unzipSync(bytes);
assert.equal(Object.keys(files).length, 5);
for (const bytes of Object.values(files)) {
  const workbook = XLSX.read(bytes, { type: "array" });
  assert.ok(workbook.SheetNames.includes("Informasi Ekspor"));
}
const students = XLSX.read(files["Data Siswa.xlsx"], { type: "array" }).Sheets.Siswa;
assert.equal(XLSX.utils.sheet_to_json(students).length, data.students.length);
console.log(
  JSON.stringify({
    ok: true,
    excelFiles: Object.keys(files).length,
    classes: data.classes.length,
    students: data.students.length,
    staff: data.staff.length,
    teacherAssignments: data.assignments.length,
    zipBytes: bytes.length,
    databaseWrites: 0,
  }),
);
