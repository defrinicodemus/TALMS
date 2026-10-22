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
  "HTMLAnchorElement",
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
let root, calls, errors, successes, refreshed, result, quizData, fetchError, navigated;
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
      return {
        toast: {
          error: (m) => errors.push(m),
          success: (m) => successes.push(m),
          info: (m) => successes.push(m),
        },
      };
    if (name === "next/navigation")
      return {
        useRouter: () => ({ refresh: () => refreshed++, push: (href) => navigated.push(href) }),
      };
    if (name === "./actions" || name === "../../actions")
      return {
        submitQuizAnswers: action,
        fetchQuizForStudent: async () => {
          if (fetchError) throw new Error("Offline");
          return structuredClone(quizData);
        },
        createQuiz: action,
        updateQuiz: action,
        deleteQuiz: action,
        publishQuiz: action,
        setQuizActive: action,
        addQuizQuestion: action,
        updateQuizQuestion: action,
        deleteQuizQuestion: action,
        setQuizQuestionActive: action,
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

const { KuisDetailContent } = load(
  "src/app/(app)/subjects/kuis/[assignmentId]/KuisDetailContent.tsx",
);
const { QuizzesTab } = load("src/app/(app)/classroom/QuizzesTab.tsx");
const assignment = {
  id: "quiz",
  title: "Kuis pecahan",
  description: "<p>Pilih jawaban terbaik.</p>",
  dueAt: "2099-01-01T00:00:00Z",
  isActive: true,
  status: "belum",
  quizStatus: "aktif",
  learningObjectiveTitle: "Memahami pecahan",
};
const question = {
  id: "q1",
  questionText: "Satu ditambah satu?",
  questionType: "multiple_choice",
  points: 100,
  options: [
    { id: "a", text: "Dua" },
    { id: "b", text: "Tiga" },
  ],
  dragBlocks: [],
  targetBlocks: [],
  steps: [],
};
function button(label) {
  const found = [...document.querySelectorAll("button")].find(
    (el) => el.textContent.trim() === label,
  );
  assert.ok(found, "Missing button: " + label);
  return found;
}
async function click(label) {
  await act(async () => button(label).click());
}
async function render(node) {
  await act(async () => root.render(node));
}
beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  root = createRoot(document.getElementById("root"));
  calls = [];
  errors = [];
  successes = [];
  refreshed = 0;
  navigated = [];
  fetchError = false;
  result = { ok: false, message: "Simulasi gagal menyimpan" };
  quizData = {
    questions: [structuredClone(question)],
    alreadySubmitted: false,
    score: null,
    timerMinutes: 20,
    passingGrade: 70,
    submittedAt: null,
    dueAt: assignment.dueAt,
    isActive: true,
    review: null,
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
});
after(() => dom.window.close());

test("student sees TP, instructions, WITA deadline and answered progress", async () => {
  await render(h(KuisDetailContent, { assignment }));
  assert.match(document.body.textContent, /Memahami pecahan/);
  assert.match(document.body.textContent, /Pilih jawaban terbaik/);
  assert.match(document.body.textContent, /WITA/);
  assert.match(document.body.textContent, /0 dari 1 soal terjawab/);
  assert.equal(button("Kirim Jawaban").disabled, true);
  await act(async () => document.querySelector('input[type="radio"]').click());
  assert.match(document.body.textContent, /1 dari 1 soal terjawab/);
  assert.equal(button("Kirim Jawaban").disabled, false);
});
test("sequence requires deliberate confirmation even when initial order is correct", async () => {
  quizData.questions = [
    {
      ...question,
      questionType: "sequence",
      options: [],
      steps: [
        { id: "s1", text: "Awal" },
        { id: "s2", text: "Akhir" },
      ],
    },
  ];
  await render(h(KuisDetailContent, { assignment }));
  assert.equal(button("Kirim Jawaban").disabled, true);
  await act(async () => document.querySelector('input[type="checkbox"]').click());
  assert.equal(button("Kirim Jawaban").disabled, false);
  await act(async () => document.querySelector('button[aria-label="Pindah ke bawah"]').click());
  assert.equal(button("Kirim Jawaban").disabled, true);
});
test("a matching target can only be reused after releasing its previous pair", async () => {
  quizData.questions = [
    {
      ...question,
      questionType: "drag_and_drop",
      options: [],
      dragBlocks: [
        { id: "a", text: "Kiri A" },
        { id: "b", text: "Kiri B" },
      ],
      targetBlocks: [
        { id: "x", text: "Kanan X" },
        { id: "y", text: "Kanan Y" },
      ],
    },
  ];
  await render(h(KuisDetailContent, { assignment }));
  await click("Kiri A");
  await click("Kanan X");
  await click("Kiri B");
  assert.equal(button("Kanan X").disabled, true);
  await click("Lepas pasangan Kiri A");
  assert.equal(button("Kanan X").disabled, false);
  await click("Kanan X");
  await click("Kiri A");
  await click("Kanan Y");
  assert.equal(button("Kirim Jawaban").disabled, false);
});
test("submission requires confirmation and a failed request retains selected answers", async () => {
  await render(h(KuisDetailContent, { assignment }));
  await act(async () => document.querySelector('input[type="radio"]').click());
  await click("Kirim Jawaban");
  assert.equal(calls.length, 0);
  await click("Periksa Lagi");
  assert.equal(calls.length, 0);
  await click("Kirim Jawaban");
  await click("Ya, Kirim Jawaban");
  assert.equal(calls.length, 1);
  assert.equal(document.querySelector('input[type="radio"]').checked, true);
  assert.equal(errors.length, 1);
});
test("successful submission shows saved grade and immediate explanations", async () => {
  await render(h(KuisDetailContent, { assignment }));
  await act(async () => document.querySelector('input[type="radio"]').click());
  result = () => {
    quizData = {
      ...quizData,
      alreadySubmitted: true,
      score: 100,
      submittedAt: "2026-10-16T00:00:00Z",
      questions: [],
      review: [
        {
          questionId: "q1",
          questionText: "Satu ditambah satu?",
          questionTypeLabel: "Pilihan Ganda",
          points: 100,
          pointsEarned: 100,
          studentAnswerLabel: "Dua",
          correctAnswerLabel: "Dua",
          explanation: "Satu dan satu menjadi dua.",
        },
      ],
    };
    return { ok: true, message: "Tersimpan", score: 100, submittedAt: quizData.submittedAt };
  };
  await click("Kirim Jawaban");
  await click("Ya, Kirim Jawaban");
  assert.match(document.body.textContent, /100[/]100/);
  assert.match(document.body.textContent, /Satu dan satu menjadi dua/);
  assert.match(document.body.textContent, /Tuntas/);
  assert.equal(document.querySelector('input[type="radio"]'), null);
});
test("fetch failure has a working retry and an empty bank cannot be submitted", async () => {
  fetchError = true;
  await render(h(KuisDetailContent, { assignment }));
  assert.match(document.body.textContent, /Soal belum dapat dimuat/);
  fetchError = false;
  quizData.questions = [];
  await click("Coba Lagi");
  assert.match(document.body.textContent, /Soal belum tersedia/);
  assert.equal(button("Kirim Jawaban").disabled, true);
});
test("pending submission disables answer controls and prevents another submission", async () => {
  let finish;
  result = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await render(h(KuisDetailContent, { assignment }));
  await act(async () => document.querySelector('input[type="radio"]').click());
  await click("Kirim Jawaban");
  await click("Ya, Kirim Jawaban");
  assert.equal(document.querySelector("fieldset").disabled, true);
  assert.equal(button("Mengirim...").disabled, true);
  await act(async () => finish({ ok: false, message: "Gagal" }));
  assert.equal(document.querySelector("fieldset").disabled, false);
});
test("internal navigation asks before discarding an unfinished answer", async () => {
  await render(h(KuisDetailContent, { assignment }));
  await act(async () => document.querySelector('input[type="radio"]').click());
  const link = document.createElement("a");
  link.href = "/subjects";
  link.textContent = "Kembali";
  document.body.append(link);
  await act(async () => link.click());
  assert.match(document.body.textContent, /Tinggalkan kuis/);
  assert.equal(navigated.length, 0);
  await click("Tetap Mengerjakan");
  assert.equal(document.querySelector('input[type="radio"]').checked, true);
});
test("published teacher quiz hides question mutation controls and locks its grading fields", async () => {
  const quiz = {
    id: "quiz",
    title: "Kuis contoh",
    description: null,
    quizType: "latihan",
    dueAt: assignment.dueAt,
    timerMinutes: 20,
    passingGrade: 70,
    learningObjectiveId: "tp",
    learningObjectiveTitle: "TP",
    createdAt: "2026-10-16",
    questionCount: 1,
    totalPoints: 100,
    isPublished: true,
    isActive: true,
    status: "aktif",
  };
  const q = {
    id: "q1",
    questionText: "Pertanyaan",
    questionType: "multiple_choice",
    points: 100,
    isActive: true,
    options: [
      { id: "a", text: "A", isCorrect: true },
      { id: "b", text: "B", isCorrect: false },
    ],
    pairs: [],
    steps: [],
    correctAnswerText: null,
    explanation: null,
    sortOrder: 0,
  };
  await render(
    h(QuizzesTab, {
      combos: [{ classId: "c", subjectId: "s", className: "4A", subjectName: "MTK" }],
      quizzesByKey: { "c:s": [quiz] },
      questionsByQuizId: { quiz: [q] },
      objectivesByKey: { "c:s": [{ id: "tp", title: "TP" }] },
    }),
  );
  const row = [...document.querySelectorAll("button")].find((el) =>
    el.textContent.includes("Kuis contoh"),
  );
  await act(async () => row.click());
  assert.match(document.body.textContent, /Soal dikunci sejak publikasi/);
  assert.equal(
    [...document.querySelectorAll("button")].some(
      (el) => el.textContent.trim() === "Tambah Pertanyaan",
    ),
    false,
  );
  await click("Edit");
  assert.equal([...document.querySelectorAll('[name="timer_minutes"]')].at(-1).disabled, true);
  assert.equal([...document.querySelectorAll('[name="passing_grade"]')].at(-1).disabled, true);
  assert.equal([...document.querySelectorAll('[name="due_date"]')].at(-1).disabled, false);
  assert.match(document.body.textContent, /Estimasi pengerjaan/);
});

test("deadline closes submission while an open page preserves its current answer", async () => {
  const originalNow = Date.now;
  const future = new Date(assignment.dueAt).getTime() + 1;
  await render(h(KuisDetailContent, { assignment }));
  await act(async () => document.querySelector('input[type="radio"]').click());
  try {
    Date.now = () => future;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    assert.equal(button("Kirim Jawaban").disabled, true);
    assert.equal(document.querySelector("fieldset").disabled, true);
    assert.equal(document.querySelector('input[type="radio"]').checked, true);
  } finally {
    Date.now = originalNow;
  }
});
