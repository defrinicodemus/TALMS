import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function compile(path) {
  return ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function evaluate(code, modules = {}) {
  const exports = {};
  new Function("require", "exports", code)((name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected module: ${name}`);
    return modules[name];
  }, exports);
  return exports;
}
const [transferCode, readinessCode, actionCode, guardCode] = await Promise.all([
  compile("../../src/lib/academic-transfers.ts"),
  compile("../../src/lib/academic-readiness.ts"),
  compile("../../src/app/(app)/academic/readiness-actions.ts"),
  compile("../../src/lib/auth/guard.ts"),
]);
const { academicYearStart, isTransferTarget } = evaluate(transferCode);
const helpers = evaluate(readinessCode);
const period = (id, label, semester) => ({ id, year_label: label, semester });

test("UI only offers consecutive periods compatible with the transfer kind", () => {
  const first = period("a", "2025/2026", "ganjil");
  const second = period("b", "2025/2026", "genap");
  const third = period("c", "2026/2027", "ganjil");
  assert.equal(isTransferTarget(first, second, "semester"), true);
  assert.equal(isTransferTarget(second, third, "promotion"), true);
  for (const [source, target, kind] of [
    [first, first, "semester"],
    [second, first, "semester"],
    [first, third, "semester"],
    [first, second, "promotion"],
    [first, third, "promotion"],
    [third, second, "promotion"],
    [second, period("d", "2027/2028", "ganjil"), "promotion"],
    [second, period("e", "invalid", "ganjil"), "promotion"],
  ])
    assert.equal(isTransferTarget(source, target, kind), false);
  assert.equal(academicYearStart(" 2026 / 2027 "), 2026);
  assert.equal(academicYearStart("2026/2028"), null);
});

const structure = {
  years: [period("old", "2025/2026", "genap"), period("new", "2026/2027", "ganjil")],
  classes: [
    { id: "old-class", name: "1A", grade_level: 1, academic_year_id: "old" },
    { id: "new-one", name: "1A", grade_level: 1, academic_year_id: "new" },
    { id: "new-four", name: "4A", grade_level: 4, academic_year_id: "new" },
  ],
  students: [{ class_id: "old-class" }, { class_id: "new-one" }, { class_id: null }],
  subjects: [
    { id: "math", min_grade: null, max_grade: null },
    { id: "science", min_grade: 4, max_grade: 6 },
  ],
  assignments: [
    { class_id: "old-class", subject_id: "math" },
    { class_id: "new-one", subject_id: "math" },
    { class_id: "new-four", subject_id: "science" },
  ],
};
test("readiness scopes placements and teacher needs by period and subject grade range", () => {
  const before = structuredClone(structure);
  assert.deepEqual(
    helpers.summarizeAcademicReadiness(
      "new",
      structure.classes,
      structure.students,
      structure.subjects,
      structure.assignments,
    ),
    {
      classCount: 2,
      studentCount: 1,
      unplacedStudents: 1,
      otherPeriodStudents: 1,
      emptyClasses: ["4A"],
      missingAssignments: 1,
      classesMissingTeachers: ["4A"],
    },
  );
  assert.deepEqual(structure, before);
});

function setup({ role = "admin", fail = false } = {}) {
  let reads = 0;
  const modules = {
    "next/navigation": {},
    "@/lib/data/profile": { getCurrentUser: async () => (role ? { id: "user", role } : null) },
    "@/lib/data/academic": {
      getAcademicStructure: async () => {
        reads++;
        if (fail) throw new Error("DB unavailable");
        return structure;
      },
    },
    "@/lib/academic-readiness": helpers,
  };
  modules["@/lib/auth/guard"] = evaluate(guardCode, modules);
  return { actions: evaluate(actionCode, modules), readCount: () => reads };
}
test("readiness is admin-only and does not read data for other roles", async () => {
  for (const role of [null, "teacher", "student", "principal"]) {
    const { actions, readCount } = setup({ role });
    assert.equal((await actions.getAcademicYearReadiness("new")).ok, false);
    assert.equal(readCount(), 0);
  }
});
test("readiness refreshes data on each request without activation or other writes", async () => {
  const { actions, readCount } = setup();
  for (let i = 0; i < 2; i++) {
    const result = await actions.getAcademicYearReadiness("new");
    assert.equal(result.ok, true);
    assert.equal(result.summary.missingAssignments, 1);
  }
  assert.equal(readCount(), 2);
});
test("readiness reports missing periods and query errors instead of a false empty or ready state", async () => {
  assert.equal((await setup().actions.getAcademicYearReadiness("missing")).ok, false);
  const result = await setup({ fail: true }).actions.getAcademicYearReadiness("new");
  assert.equal(result.ok, false);
  assert.match(result.message, /belum dapat dimuat/);
  assert.equal(result.summary, undefined);
});
