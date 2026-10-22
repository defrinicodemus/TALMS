import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import crypto from "node:crypto";
import ts from "typescript";
import { z } from "zod";

const paths = [
  "src/app/(app)/subjects/actions.ts",
  "src/lib/auth/guard.ts",
  "src/lib/quizServer.ts",
  "src/lib/quizReview.ts",
  "src/lib/data/subjects.ts",
];
const code = await Promise.all(
  paths.map(
    async (path) =>
      ts.transpileModule(await readFile(new URL("../../" + path, import.meta.url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
  ),
);
const id = (n) => "20000000-0000-4000-8000-" + String(n).padStart(12, "0");
const questions = [
  {
    id: id(10),
    question_type: "multiple_choice",
    points: 50,
    quiz_options: [
      { id: id(11), option_text: "Correct", is_correct: true },
      { id: id(12), option_text: "Wrong", is_correct: false },
    ],
  },
  { id: id(20), question_type: "true_false", points: 20, correct_answer_text: "benar" },
  {
    id: id(30),
    question_type: "drag_and_drop",
    points: 20,
    quiz_pairs: [
      { id: id(31), drag_text: "A", target_text: "1" },
      { id: id(32), drag_text: "B", target_text: "2" },
    ],
  },
  {
    id: id(40),
    question_type: "sequence",
    points: 10,
    quiz_steps: [
      { id: id(41), step_text: "First", correct_order: 1 },
      { id: id(42), step_text: "Second", correct_order: 2 },
    ],
  },
].map((q, i) => ({
  question_text: "Question " + i,
  explanation: "Explanation " + i,
  correct_answer_text: null,
  quiz_options: [],
  quiz_pairs: [],
  quiz_steps: [],
  sort_order: i,
  ...q,
}));
// Dummy test-only key; no hosted credentials or network calls.
process.env.SUPABASE_SERVICE_ROLE_KEY = "local-quiz-test-key";
function setup(options = {}) {
  const state = {
    user: { id: id(1), role: "student", classId: id(3) },
    questions: structuredClone(questions),
    assignment: {
      id: id(2),
      is_active: true,
      due_at: "2099-01-01T00:00:00Z",
      timer_minutes: 30,
      passing_grade: 70,
    },
    existing: null,
    questionsError: null,
    writeError: null,
    readError: null,
    savedAnswers: [],
    ...options,
    rpcCalls: [],
    invalidated: [],
    reads: [],
    bankReads: 0,
  };
  function query(table, admin = false) {
    state.reads.push({ table, admin, filters: [] });
    const log = state.reads.at(-1);
    const value = () => {
      if (table === "assignments") return { data: state.assignment, error: state.readError };
      if (table === "submissions") return { data: state.existing, error: state.readError };
      if (table === "quiz_answers") return { data: state.savedAnswers, error: state.readError };
      assert.equal(table, "quiz_questions");
      assert.equal(admin, true, "Answer-bank reads must use the authorized server path");
      state.bankReads++;
      return { data: state.questions, error: state.questionsError };
    };
    return {
      select() {
        return this;
      },
      eq(k, v) {
        log.filters.push([k, v]);
        return this;
      },
      order() {
        return this;
      },
      maybeSingle: async () => value(),
      then(resolve, reject) {
        return Promise.resolve(value()).then(resolve, reject);
      },
    };
  }
  const modules = {
    "server-only": {},
    "node:crypto": crypto,
    zod: { z },
    "next/cache": { revalidatePath: (p, t) => state.invalidated.push([p, t]) },
    "next/navigation": {
      redirect: () => {
        throw new Error("Unexpected redirect");
      },
    },
    "@/lib/data/profile": { getCurrentUser: async () => state.user },
    "@/lib/supabase/server": { createClient: async () => ({ from: (table) => query(table) }) },
    "@/lib/supabase/admin": {
      createAdminClient: () => ({
        from: (table) => query(table, true),
        rpc: async (name, params) => {
          state.rpcCalls.push({ name, params });
          return { data: id(99), error: state.writeError };
        },
      }),
    },
    "@/lib/assignmentConstants": {},
    "@/lib/assignmentFiles": {},
    "@/lib/quizStatus": {},
  };
  function evaluate(source) {
    const exports = {};
    new Function("require", "exports", source)((name) => {
      assert.ok(Object.hasOwn(modules, name), "Unexpected import " + name);
      return modules[name];
    }, exports);
    return exports;
  }
  modules["@/lib/auth/guard"] = evaluate(code[1]);
  const helpers = (modules["@/lib/quizServer"] = evaluate(code[2]));
  modules["@/lib/quizReview"] = evaluate(code[3]);
  const data = (modules["@/lib/data/subjects"] = evaluate(code[4]));
  const actions = evaluate(code[0]);
  const token = (pair) => helpers.quizTargetToken(id(1), id(2), pair);
  const answers = [
    { questionId: id(10), selectedOptionId: id(11) },
    { questionId: id(20), trueFalseAnswer: "salah" },
    { questionId: id(30), dragDropAnswer: { [id(31)]: token(id(31)), [id(32)]: token(id(32)) } },
    { questionId: id(40), sequenceAnswer: [id(42), id(41)] },
  ];
  return { state, actions, data, helpers, answers, token };
}

test("server computes all four types, ignores forged grades, and stores original pair IDs", async () => {
  const { state, actions, answers } = setup();
  const result = await actions.submitQuizAnswers(
    id(2),
    answers.map((a) => ({ ...a, score: 100, student_id: id(999), points_earned: 100 })),
  );
  assert.equal(result.ok, true);
  assert.equal(result.score, 70);
  assert.equal(state.rpcCalls.length, 1);
  const { name, params } = state.rpcCalls[0];
  assert.equal(name, "save_scored_quiz");
  assert.equal(params.p_student_id, id(1));
  assert.deepEqual(
    params.p_answers.map((a) => a.points_earned),
    [50, 0, 20, 0],
  );
  assert.deepEqual(params.p_answers[2].drag_drop_answer, { [id(31)]: id(31), [id(32)]: id(32) });
  assert.deepEqual(
    state.invalidated.map((x) => x[0]),
    ["/subjects", "/assessments", "/dashboard"],
  );
});
for (const role of [null, "teacher", "principal", "admin"])
  test("rejects caller " + role, async () => {
    const { state, actions, answers } = setup({
      user: role ? { id: id(1), role, classId: id(3) } : null,
    });
    assert.equal((await actions.submitQuizAnswers(id(2), answers)).ok, false);
    assert.equal(await actions.fetchQuizForStudent(id(2)), null);
    assert.equal(state.reads.length, 0);
    assert.equal(state.rpcCalls.length, 0);
  });
for (const [label, options] of [
  ["no class", { user: { id: id(1), role: "student", classId: null } }],
  ["inaccessible quiz", { assignment: null }],
  ["inactive quiz", { assignment: { is_active: false } }],
  ["expired quiz", { assignment: { is_active: true, due_at: "2000-01-01T00:00:00Z" } }],
  ["read failed", { readError: { message: "failed" } }],
])
  test("rejects " + label + " before reading the answer bank", async () => {
    const { state, actions, answers } = setup(options);
    assert.equal((await actions.submitQuizAnswers(id(2), answers)).ok, false);
    assert.equal(state.bankReads, 0);
    assert.equal(state.rpcCalls.length, 0);
  });
for (const [label, mutate] of [
  ["missing answer", (a) => a.pop()],
  ["duplicate question", (a) => (a[1] = a[0])],
  ["foreign option", (a) => (a[0].selectedOptionId = id(999))],
  ["missing true/false", (a) => delete a[1].trueFalseAnswer],
  ["reused matching target", (a) => (a[2].dragDropAnswer[id(32)] = a[2].dragDropAnswer[id(31)])],
  ["foreign target", (a) => (a[2].dragDropAnswer[id(31)] = "a".repeat(64))],
  ["duplicate sequence step", (a) => (a[3].sequenceAnswer = [id(41), id(41)])],
  ["foreign sequence step", (a) => (a[3].sequenceAnswer = [id(41), id(999)])],
])
  test("rejects " + label + " without saving", async () => {
    const { state, actions, answers } = setup();
    mutate(answers);
    assert.equal((await actions.submitQuizAnswers(id(2), answers)).ok, false);
    assert.equal(state.rpcCalls.length, 0);
  });
test("rejects invalid payloads before I/O", async () => {
  for (const answers of [null, {}, [], [{ questionId: "bad" }]]) {
    const { state, actions } = setup();
    assert.equal((await actions.submitQuizAnswers(id(2), answers)).ok, false);
    assert.equal(state.reads.length, 0);
  }
});
test("missing/broken question bank cannot be graded", async () => {
  for (const options of [
    { questions: [] },
    { questionsError: { message: "Failed" } },
    { questions: questions.map((q) => ({ ...q, points: 1 })) },
  ]) {
    const { state, actions, answers } = setup(options);
    assert.equal((await actions.submitQuizAnswers(id(2), answers)).ok, false);
    assert.equal(state.rpcCalls.length, 0);
  }
});
test("retry recovers the existing grade without another attempt", async () => {
  const { state, actions, answers } = setup({
    existing: { id: id(99), status: "graded", score: 70, submitted_at: "2026-10-16T00:00:00Z" },
  });
  const result = await actions.submitQuizAnswers(id(2), answers);
  assert.equal(result.ok, true);
  assert.equal(result.score, 70);
  assert.equal(state.rpcCalls.length, 0);
  assert.equal(state.bankReads, 0);
});
test("failed atomic write does not return a successful score", async (t) => {
  t.mock.method(console, "error", () => {});
  const { state, actions, answers } = setup({
    writeError: { code: "55000", message: "Kuis ditutup" },
  });
  const result = await actions.submitQuizAnswers(id(2), answers);
  assert.equal(result.ok, false);
  assert.equal(result.message, "Kuis ditutup");
  assert.equal(state.invalidated.length, 0);
});
test("missing scoring RPC explains the required database migration", async (t) => {
  t.mock.method(console, "error", () => {});
  const { actions, answers } = setup({
    writeError: {
      code: "PGRST202",
      message: "Could not find the function public.save_scored_quiz in the schema cache",
    },
  });
  const result = await actions.submitQuizAnswers(id(2), answers);
  assert.equal(result.ok, false);
  assert.equal(
    result.message,
    "Konfigurasi penyimpanan kuis belum tersedia. Minta admin menjalankan migrasi database terbaru.",
  );
});
test("student payload omits keys and explanations and hides the matching relation", async () => {
  const { actions, helpers } = setup();
  const data = await actions.fetchQuizForStudent(id(2));
  assert.equal(data.review, null);
  assert.equal(data.questions.length, 4);
  const json = JSON.stringify(data.questions);
  for (const secret of ["is_correct", "correct_order", "correct_answer_text", "Explanation"])
    assert.equal(json.includes(secret), false);
  const pair = data.questions[2];
  assert.ok(pair.dragBlocks.every((p) => !pair.targetBlocks.some((t) => t.id === p.id)));
  assert.notEqual(
    helpers.quizTargetToken(id(1), id(2), id(31)),
    helpers.quizTargetToken(id(99), id(2), id(31)),
  );
});
test("feedback is released only after the authenticated student's saved grade", async () => {
  const { actions, state } = setup({
    existing: { id: id(99), status: "graded", score: 70, submitted_at: "2026-10-16T00:00:00Z" },
    savedAnswers: [{ question_id: id(10), selected_option_id: id(11), points_earned: 50 }],
  });
  const data = await actions.fetchQuizForStudent(id(2));
  assert.equal(data.questions.length, 0);
  assert.equal(data.review[0].correctAnswerLabel, "Correct");
  assert.equal(data.review[0].explanation, "Explanation 0");
  assert.ok(
    state.reads.some(
      (r) =>
        r.table === "submissions" &&
        r.filters.some(([key, value]) => key === "student_id" && value === id(1)),
    ),
  );
  assert.ok(
    state.reads.some(
      (r) =>
        r.table === "assignments" &&
        r.filters.some(([key, value]) => key === "class_id" && value === id(3)),
    ),
  );
});

test("review excludes unused inactive questions but retains answered legacy questions", async () => {
  const bank = structuredClone(questions);
  bank[1].is_active = false;
  bank[2].is_active = false;
  const { actions } = setup({
    questions: bank,
    existing: { id: id(99), status: "graded", score: 50 },
    savedAnswers: [{ question_id: id(20), true_false_answer: "salah", points_earned: 0 }],
  });
  const result = await actions.fetchQuizForStudent(id(2));
  assert.equal(
    result.review.some((q) => q.questionId === id(30)),
    false,
  );
  assert.equal(
    result.review.some((q) => q.questionId === id(20)),
    true,
  );
});
