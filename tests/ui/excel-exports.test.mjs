import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as XLSX from "xlsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const name of [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLSelectElement",
  "DocumentFragment",
  "MutationObserver",
  "CustomEvent",
  "Event",
  "MouseEvent",
]) {
  globalThis[name] = dom.window[name];
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const { act, createElement: h } = require("react");
const { createRoot } = require("react-dom/client");
const project = fileURLToPath(new URL("../../", import.meta.url));
const cache = new Map();
const errors = [];
const downloads = [];
let importCalls;
let importResult;
let writeResult;
let recap;
let root;

// Run real components and workbook utilities, with no server calls or disk downloads.
// Replace only the dynamic import boundary to simulate a slow/failing chunk request.
function controlExcelImport(context) {
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "xlsx"
    ) {
      return context.factory.createCallExpression(
        context.factory.createIdentifier("loadXlsx"),
        undefined,
        [],
      );
    }
    return ts.visitEachChild(node, visit, context);
  };
  return (source) => ts.visitNode(source, visit);
}

function loadSource(filename) {
  filename = path.resolve(project, filename);
  if (!path.extname(filename)) filename += existsSync(`${filename}.tsx`) ? ".tsx" : ".ts";
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    transformers: { before: [controlExcelImport] },
  }).outputText;
  new Function("require", "exports", "loadXlsx", code)(
    (name) => {
      if (name === "xlsx") assert.fail("Excel must not be imported eagerly by the component");
      if (name === "sonner") return { toast: { error: (message) => errors.push(message) } };
      if (name === "./actions")
        return {
          fetchAttendanceRecap: async () => recap,
          lockAndCalculateGrades: () => assert.fail("Export must not change grades"),
          unlockGradebook: () => assert.fail("Export must not unlock grades"),
        };
      if (name === "./StudentHistoryDialog") return { StudentHistoryDialog: () => null };
      if (name === "@/components/ui/dialog")
        return {
          Dialog: ({ children }) => children,
          DialogContent: ({ children }) => h("div", { role: "dialog" }, children),
        };
      if (name.startsWith("@/")) return loadSource(`src/${name.slice(2)}`);
      if (name.startsWith(".")) return loadSource(path.resolve(path.dirname(filename), name));
      return require(name);
    },
    exports,
    () => {
      importCalls++;
      return importResult();
    },
  );
  return exports;
}

const { AttendanceRecapDialog } = loadSource("src/app/(app)/attendance/AttendanceRecapDialog.tsx");
const { GradebookManager } = loadSource("src/app/(app)/gradebook/GradebookManager.tsx");
const excelModule = {
  ...XLSX,
  writeFile(workbook, filename) {
    // Round-trip actual XLSX bytes, retaining numeric cells and leading-zero identifiers.
    const parsed = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
    downloads.push({
      filename,
      sheets: parsed.SheetNames,
      rows: XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]], { header: 1 }),
    });
    return writeResult();
  },
};
const gradeData = {
  tpColumns: [
    { id: "tp2", title: "Pecahan", sortOrder: 2 },
    { id: "tp4", title: "Perbandingan", sortOrder: 4 },
  ],
  students: [
    { studentId: "a", fullName: "Ayu", tpAverages: { tp2: 0, tp4: 82.5 }, finalGrade: 41.25 },
    { studentId: "b", fullName: "Budi", tpAverages: { tp2: null }, finalGrade: null },
    { studentId: "c", fullName: "Citra", tpAverages: { tp2: 0, tp4: 0 }, finalGrade: 0 },
  ],
  isLocked: true,
  lockedAt: "2026-10-01T00:00:00Z",
};
const cases = [
  {
    name: "attendance",
    component: () =>
      h(AttendanceRecapDialog, {
        classId: "class1",
        subjectId: "subject1",
        className: "VII A",
        subjectName: "Matematika",
        onClose() {},
      }),
    expected: {
      filename: "Rekap-Presensi-VII A-Matematika.xlsx",
      sheets: ["Rekap Presensi"],
      rows: [
        ["Nama Siswa", "NISN", "Pertemuan 1", "Pertemuan 3", "Pertemuan 5", "Pertemuan 8"],
        ["Ayu", "0012345678", "Hadir", "Sakit", "Izin", "Alfa"],
        ["Budi", "-", "-", "-", "-", "Hadir"],
      ],
    },
  },
  {
    name: "gradebook",
    component: (data = gradeData) =>
      h(GradebookManager, {
        combos: [
          {
            classId: "class1",
            subjectId: "subject1",
            className: "VII A",
            subjectName: "Matematika",
          },
        ],
        gradebookByKey: { "class1:subject1": data },
      }),
    expected: {
      filename: "Buku-Nilai-VII A-Matematika.xlsx",
      sheets: ["Nilai"],
      rows: [
        ["Nama Siswa", "Nilai Pecahan", "Nilai Perbandingan", "Nilai Akhir"],
        ["Ayu", 0, 82.5, 41.25],
        ["Budi", "-", "-", "-"],
        ["Citra", 0, 0, 0],
      ],
    },
  },
];

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function render(component) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(component));
}

function exportButton() {
  const button = [...document.querySelectorAll("button")].find((element) =>
    /Ekspor ke Excel|Menyiapkan Excel/.test(element.textContent),
  );
  assert.ok(button, "Export button is visible");
  return button;
}

function assertBusy(busy) {
  assert.equal(exportButton().disabled, busy);
  assert.equal(exportButton().getAttribute("aria-busy"), String(busy));
  assert.equal(exportButton().textContent, busy ? "Menyiapkan Excel…" : "Ekspor ke Excel");
  const select = document.querySelector('[role="combobox"]');
  if (select) assert.equal(select.disabled, busy);
}

beforeEach(() => {
  importCalls = 0;
  importResult = async () => excelModule;
  writeResult = () => undefined;
  recap = {
    meetingNumbers: [1, 3, 5, 8],
    students: [
      {
        studentId: "a",
        fullName: "Ayu",
        nisn: "0012345678",
        statusByMeeting: { 1: "hadir", 3: "sakit", 5: "izin", 8: "alfa" },
      },
      { studentId: "b", fullName: "Budi", nisn: null, statusByMeeting: { 1: null, 8: "hadir" } },
    ],
  };
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  document.body.replaceChildren();
  downloads.length = 0;
  errors.length = 0;
});
after(() => dom.window.close());

for (const scenario of cases) {
  test(`${scenario.name}: loads Excel on demand, blocks repeated clicks and preserves workbook output`, async () => {
    const loading = deferred();
    const writing = deferred();
    importResult = () => loading.promise;
    writeResult = () => writing.promise;
    await render(scenario.component());
    assert.equal(importCalls, 0, "Rendering must not load Excel");
    assertBusy(false);
    await act(async () => {
      const button = exportButton();
      button.click();
      button.click();
    });
    assert.equal(importCalls, 1);
    assert.equal(downloads.length, 0);
    assertBusy(true);
    await act(async () => loading.resolve(excelModule));
    assertBusy(true);
    await act(async () => exportButton().click());
    assert.equal(importCalls, 1);
    assert.deepEqual(downloads, [scenario.expected]);
    await act(async () => writing.resolve());
    assertBusy(false);
    assert.deepEqual(errors, []);
  });

  test(`${scenario.name}: reports chunk loading failure and permits retry`, async () => {
    const loading = deferred();
    importResult = () => loading.promise;
    await render(scenario.component());
    await act(async () => exportButton().click());
    assertBusy(true);
    await act(async () => loading.reject(new Error("Chunk unavailable")));
    assertBusy(false);
    assert.deepEqual(errors, ["Ekspor Excel gagal. Coba lagi atau muat ulang halaman."]);
    assert.equal(downloads.length, 0);
    importResult = async () => excelModule;
    await act(async () => exportButton().click());
    assert.equal(importCalls, 2);
    assert.deepEqual(downloads, [scenario.expected]);
    assertBusy(false);
  });

  test(`${scenario.name}: reports workbook writing failure and releases the export guard`, async () => {
    writeResult = () => {
      throw new Error("Download failed");
    };
    await render(scenario.component());
    await act(async () => exportButton().click());
    assertBusy(false);
    assert.equal(errors.length, 1);
    writeResult = () => undefined;
    await act(async () => exportButton().click());
    assert.equal(importCalls, 2);
    assert.deepEqual(downloads, [scenario.expected, scenario.expected]);
    assert.equal(errors.length, 1);
    assertBusy(false);
  });
}

test("attendance: no meeting means no export or Excel request", async () => {
  recap = { meetingNumbers: [], students: [] };
  await render(cases[0].component());
  assert.equal(exportButton().disabled, true);
  await act(async () => exportButton().click());
  assert.equal(importCalls, 0);
  assert.deepEqual(downloads, []);
});

test("gradebook: unlocked grades cannot be exported or trigger an Excel request", async () => {
  await render(cases[1].component({ ...gradeData, isLocked: false, lockedAt: null }));
  assert.equal(exportButton().disabled, true);
  await act(async () => exportButton().click());
  assert.equal(importCalls, 0);
  assert.deepEqual(downloads, []);
});
