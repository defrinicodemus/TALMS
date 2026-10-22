import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import ts from "typescript";

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
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLSelectElement",
  "File",
  "Blob",
  "FormData",
  "DocumentFragment",
  "NodeFilter",
  "MutationObserver",
  "CustomEvent",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
])
  globalThis[name] = dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLElement.prototype.scrollIntoView = function () {};
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.setPointerCapture = function () {};
HTMLElement.prototype.releasePointerCapture = function () {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let nextUrl = 0;
URL.createObjectURL = () => `blob:http://localhost/${++nextUrl}`;
URL.revokeObjectURL = () => {};
const require = createRequire(import.meta.url);
const { act, createElement: h } = require("react");
const { createRoot } = require("react-dom/client");
const project = fileURLToPath(new URL("../../", import.meta.url));
const cache = new Map();
let root, calls, errors, successes, refreshed, result, reviewResult;
const action = async (...args) => {
  calls.push(args);
  return typeof result === "function" ? result() : result;
};
function load(filename) {
  filename = path.resolve(project, filename);
  if (!path.extname(filename)) filename += existsSync(`${filename}.tsx`) ? ".tsx" : ".ts";
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "exports", code)((name) => {
    if (name === "sonner")
      return { toast: { error: (m) => errors.push(m), success: (m) => successes.push(m) } };
    if (name === "next/navigation") return { useRouter: () => ({ refresh: () => refreshed++ }) };
    if (name === "./actions" || name === "../../actions")
      return {
        submitAssignment: action,
        createAssignment: action,
        updateAssignment: action,
        deleteAssignment: action,
        setAssignmentActive: action,
        removeAssignmentAttachmentImage: action,
        gradeSubmission: action,
        fetchTaskSubmission: async () => reviewResult,
      };
    if (name === "@/components/RichTextEditor")
      return {
        RichTextEditor: ({ name, defaultValue, onChange }) =>
          h("textarea", { name, defaultValue, onChange: (e) => onChange?.(e.target.value) }),
      };
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}`);
    if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name));
    return require(name);
  }, exports);
  cache.set(filename, exports);
  return exports;
}
const { TugasDetailContent } = load(
  "src/app/(app)/subjects/tugas/[assignmentId]/TugasDetailContent.tsx",
);
const { AssignmentsTab } = load("src/app/(app)/classroom/AssignmentsTab.tsx");
const { GradeSplitDialog } = load("src/app/(app)/assessments/GradeSplitDialog.tsx");
const assignment = {
  id: "task",
  title: "Tugas pecahan",
  kind: "essay",
  description: "<p>Kerjakan soal.</p>",
  dueAt: "2099-03-04T15:59:00Z",
  status: "belum",
  allowedMethods: ["text", "photo"],
  submissionContent: null,
  submittedAt: null,
  submissionUpdatedAt: null,
  submissionPhotoUrl: null,
  score: null,
  teacherComment: null,
  attachmentImageUrl: null,
};
const version = "2026-10-15T00:00:00+00:00";
function button(label) {
  const found = [...document.querySelectorAll("button")].find(
    (el) => el.textContent.trim() === label,
  );
  assert.ok(found, `Missing button: ${label}`);
  return found;
}
async function click(label) {
  await act(async () => button(label).click());
}
async function render(node) {
  await act(async () => root.render(node));
}
async function change(input, value) {
  await act(async () => {
    const proto =
      input.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function chooseFile(file) {
  const input = document.querySelector('input[type="file"]');
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  root = createRoot(document.getElementById("root"));
  calls = [];
  errors = [];
  successes = [];
  refreshed = 0;
  result = { ok: false, message: "Simulasi gagal menyimpan" };
  reviewResult = {
    contentUrl: "Jawaban terbaru",
    photoUrl: null,
    submittedAt: version,
    updatedAt: version,
    status: "submitted",
    score: null,
    teacherComment: null,
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
});
after(() => dom.window.close());

test("photo-only task provides an upload instead of a text answer", async () => {
  await render(h(TugasDetailContent, { assignment: { ...assignment, allowedMethods: ["photo"] } }));
  assert.equal(document.querySelector("textarea"), null);
  assert.ok(document.querySelector('input[type="file"]'));
  assert.match(document.body.textContent, /2 MB/);
  assert.equal(button("Kumpulkan Tugas").disabled, true);
});

test("both allowed methods give one choice and send only the selected photo", async () => {
  await render(h(TugasDetailContent, { assignment }));
  await change(document.querySelector("textarea"), "Text draft");
  await act(async () => document.querySelectorAll('input[type="radio"]')[1].click());
  const file = new File(["photo"], "answer.jpg", { type: "image/jpeg" });
  await chooseFile(file);
  assert.ok(document.querySelector('img[alt="Pratinjau foto sebelum dikirim"]'));
  await click("Kumpulkan Tugas");
  assert.equal(calls[0][1].get("method"), "photo");
  assert.equal(calls[0][1].get("photo").name, "answer.jpg");
  assert.ok(
    document.querySelector('img[alt="Pratinjau foto sebelum dikirim"]'),
    "failed upload keeps preview",
  );
});

test("oversized photo does not discard the valid photo already selected", async () => {
  await render(h(TugasDetailContent, { assignment: { ...assignment, allowedMethods: ["photo"] } }));
  await chooseFile(new File(["photo"], "valid.jpg", { type: "image/jpeg" }));
  await chooseFile(
    new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" }),
  );
  assert.equal(errors.length, 1);
  assert.match(document.body.textContent, /valid.jpg/);
  assert.doesNotMatch(document.body.textContent, /large.jpg/);
});

test("successful submission shows stored evidence and requires deliberate editing", async () => {
  await render(h(TugasDetailContent, { assignment }));
  await change(document.querySelector("textarea"), "Jawaban saya");
  result = {
    ok: true,
    message: "Terkirim",
    submission: {
      content: "Jawaban saya",
      photoUrl: null,
      submittedAt: version,
      updatedAt: version,
    },
  };
  await click("Kumpulkan Tugas");
  assert.equal(document.querySelector("textarea"), null);
  assert.match(document.body.textContent, /Pengumpulan terakhir:/);
  assert.match(document.body.textContent, /Jawaban saya/);
  assert.equal(refreshed, 1);
  await click("Ubah Jawaban");
  assert.equal(button("Simpan Perubahan Jawaban").disabled, true);
  await change(document.querySelector("textarea"), "Perubahan");
  await click("Batal");
  assert.match(document.body.textContent, /Jawaban saya/);
  assert.doesNotMatch(document.body.textContent, /Perubahan/);
});

test("network failure keeps the student's text and the previous stored answer", async () => {
  await render(
    h(TugasDetailContent, {
      assignment: {
        ...assignment,
        status: "submitted",
        submissionContent: "Lama",
        submissionUpdatedAt: version,
        submittedAt: version,
      },
    }),
  );
  await click("Ubah Jawaban");
  await change(document.querySelector("textarea"), "Baru");
  result = async () => {
    throw new Error("Offline");
  };
  await click("Simpan Perubahan Jawaban");
  assert.equal(document.querySelector("textarea").value, "Baru");
  assert.match(document.body.textContent, /Lama/);
  assert.equal(errors.length, 1);
  assert.equal(calls[0][1].get("expected_updated_at"), version);
});

test("graded work keeps the student's answer visible alongside grade and feedback", async () => {
  await render(
    h(TugasDetailContent, {
      assignment: {
        ...assignment,
        status: "graded",
        submissionContent: "Jawaban yang dinilai",
        score: 85,
        teacherComment: "Bagus",
        submittedAt: version,
      },
    }),
  );
  assert.match(document.body.textContent, /Jawaban yang dinilai/);
  assert.match(document.body.textContent, /85/);
  assert.match(document.body.textContent, /Bagus/);
  assert.equal(document.querySelector("textarea"), null);
  assert.doesNotMatch(document.body.textContent, /Ubah Jawaban/);
});

test("expired task closes submissions but keeps submitted work readable", async () => {
  await render(
    h(TugasDetailContent, {
      assignment: {
        ...assignment,
        status: "submitted",
        submissionContent: "Jawaban tersimpan",
        dueAt: "2000-01-01T00:00:00Z",
      },
    }),
  );
  assert.match(document.body.textContent, /Tenggat pengumpulan sudah berakhir/);
  assert.match(document.body.textContent, /Jawaban tersimpan/);
  assert.equal(document.querySelector("textarea"), null);
  assert.doesNotMatch(document.body.textContent, /Ubah Jawaban/);
});

test("teacher can extend a deadline in WITA without changing the allowed methods", async () => {
  const row = {
    ...assignment,
    learningObjectiveId: "tp",
    learningObjectiveTitle: "Mengenal pecahan",
    isPublished: true,
  };
  await render(
    h(AssignmentsTab, {
      combos: [
        { classId: "class", subjectId: "subject", className: "4A", subjectName: "Matematika" },
      ],
      assignmentsByKey: { "class:subject": [row] },
      objectivesByKey: { "class:subject": [{ id: "tp", title: "Mengenal pecahan" }] },
    }),
  );
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((el) => el.textContent.includes("Tugas pecahan"))
      .click(),
  );
  await click("Edit");
  const date = [...document.querySelectorAll('input[type="date"]')].at(-1);
  const time = [...document.querySelectorAll('input[type="time"]')].at(-1);
  assert.equal(date.value, "2099-03-04");
  assert.equal(time.value, "23:59");
  await change(date, "2099-03-05");
  await click("Simpan Perubahan");
  assert.equal(calls[0][0].get("due_date"), "2099-03-05");
  assert.equal(calls[0][0].get("due_time"), "23:59");
  assert.equal(calls[0][0].has("allowed_methods"), false);
  assert.equal(date.value, "2099-03-05", "failed edit retains input");
});

test("teacher opens the latest answer and grades its exact version", async () => {
  await render(
    h(GradeSplitDialog, {
      assignmentTitle: "Tugas",
      student: {
        studentId: "student",
        studentName: "Siswa",
        submissionId: "submission",
        contentUrl: "Old snapshot",
        updatedAt: "old",
      },
      disabled: false,
    }),
  );
  await click("Periksa");
  assert.match(document.body.textContent, /Jawaban terbaru/);
  assert.doesNotMatch(document.body.textContent, /Old snapshot/);
  await change(document.querySelector('input[name="score"]'), "85");
  result = { ok: false, conflict: true, message: "Jawaban sudah berubah" };
  await click("Simpan Nilai");
  assert.equal(calls[0][0].get("expected_updated_at"), version);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(refreshed, 1);
});
