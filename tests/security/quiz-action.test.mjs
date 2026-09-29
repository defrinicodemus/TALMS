import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { z } from "zod";

// Run the actual server action and role guard with mocked I/O. Database behavior
// is covered separately in submission-grades.test.mjs. No Next server or keys.
async function compile(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const [actionCode, guardCode] = await Promise.all([
  compile("../../src/app/(app)/subjects/actions.ts"),
  compile("../../src/lib/auth/guard.ts"),
]);
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const questions = [
  {
    id: id(10),
    question_type: "multiple_choice",
    points: 50,
    quiz_options: [
      { id: id(11), is_correct: true },
      { id: id(12), is_correct: false },
    ],
  },
  { id: id(20), question_type: "true_false", points: 20, correct_answer_text: "benar" },
  {
    id: id(30),
    question_type: "drag_and_drop",
    points: 20,
    quiz_pairs: [{ id: id(31) }, { id: id(32) }],
  },
  {
    id: id(40),
    question_type: "sequence",
    points: 10,
    quiz_steps: [
      { id: id(41), correct_order: 1 },
      { id: id(42), correct_order: 2 },
    ],
  },
];
const answers = [
  { questionId: id(10), selectedOptionId: id(11) },
  { questionId: id(20), trueFalseAnswer: "salah" },
  { questionId: id(30), dragDropAnswer: { [id(31)]: id(31), [id(32)]: id(31) } },
  { questionId: id(40), sequenceAnswer: [id(42), id(41)] },
];

function setup(options = {}) {
  const state = {
    user: { id: id(1), role: "student" },
    questions,
    existing: null,
    questionsError: null,
    writeError: null,
    ...options,
    rpcCalls: [],
    invalidated: [],
    clientCreated: false,
  };
  const modules = {
    zod: { z },
    "next/cache": { revalidatePath: (path) => state.invalidated.push(path) },
    "next/navigation": {
      redirect: () => {
        throw new Error("Unexpected redirect");
      },
    },
    "@/lib/data/profile": { getCurrentUser: async () => state.user },
    "@/lib/data/subjects": {
      getQuizForStudent: () => {
        throw new Error("Unexpected quiz fetch");
      },
    },
    "@/lib/supabase/server": {
      createClient: async () => {
        state.clientCreated = true;
        return {
          from: (table) => {
            assert.ok(["submissions", "quiz_questions"].includes(table));
            // Deliberately expose reads only: grading must never use this client.
            return {
              select() {
                return this;
              },
              eq() {
                return this;
              },
              maybeSingle: async () => ({ data: state.existing, error: null }),
              then(resolve, reject) {
                assert.equal(table, "quiz_questions");
                return Promise.resolve({ data: state.questions, error: state.questionsError }).then(
                  resolve,
                  reject,
                );
              },
            };
          },
        };
      },
    },
    "@/lib/supabase/admin": {
      createAdminClient: () => ({
        rpc: async (name, params) => {
          state.rpcCalls.push({ name, params });
          return { data: state.writeError ? null : id(99), error: state.writeError };
        },
      }),
    },
  };
  function evaluate(code) {
    const exports = {};
    const require = (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
      return modules[name];
    };
    // Execute repository code compiled above; user-provided content is never code.
    new Function("require", "exports", code)(require, exports);
    return exports;
  }
  modules["@/lib/auth/guard"] = evaluate(guardCode);
  return { state, action: evaluate(actionCode).submitQuizAnswers };
}

test("quiz action derives the student and all points on the server, ignoring forged grading fields", async () => {
  const { state, action } = setup();
  const result = await action(
    id(2),
    answers.map((answer) => ({
      ...answer,
      score: 100,
      points_earned: 100,
      student_id: id(999),
      status: "graded",
    })),
  );
  assert.deepEqual(result, { ok: true, message: "Kuis berhasil dikumpulkan!", score: 60 });
  assert.equal(state.rpcCalls.length, 1);
  const { name, params } = state.rpcCalls[0];
  assert.equal(name, "save_scored_quiz");
  assert.equal(params.p_student_id, state.user.id);
  assert.equal(params.p_assignment_id, id(2));
  assert.equal(params.p_score, 60);
  assert.deepEqual(
    params.p_answers.map((answer) => answer.points_earned),
    [50, 0, 10, 0],
  );
  assert.deepEqual(state.invalidated, ["/subjects"]);
});

for (const role of [null, "teacher", "principal", "admin"]) {
  test(`quiz action rejects ${role ?? "unauthenticated"} callers before privileged access`, async () => {
    const { state, action } = setup({ user: role ? { id: id(1), role } : null });
    assert.equal((await action(id(2), answers)).ok, false);
    assert.equal(state.clientCreated, false);
    assert.deepEqual(state.rpcCalls, []);
  });
}

test("quiz action rejects malformed payloads before reading or saving", async () => {
  for (const payload of [
    null,
    {},
    [{ questionId: "bad-id" }],
    [{ questionId: id(10), sequenceAnswer: "bad" }],
  ]) {
    const { state, action } = setup();
    assert.equal((await action(id(2), payload)).ok, false);
    assert.equal(state.clientCreated, false);
    assert.deepEqual(state.rpcCalls, []);
  }
  const { state, action } = setup();
  assert.equal((await action("bad-id", answers)).ok, false);
  assert.deepEqual(state.rpcCalls, []);
});

test("quiz action does not grade inaccessible questions or a completed attempt", async () => {
  for (const options of [
    { questions: [] },
    { questions: null, questionsError: { message: "Read failed" } },
    { existing: { status: "graded" } },
  ]) {
    const { state, action } = setup(options);
    assert.equal((await action(id(2), answers)).ok, false);
    assert.deepEqual(state.rpcCalls, []);
  }
});

test("quiz action reports a failed atomic save without returning a successful score", async () => {
  const { state, action } = setup({ writeError: { message: "Gagal menyimpan jawaban." } });
  assert.deepEqual(await action(id(2), answers), {
    ok: false,
    message: "Gagal menyimpan jawaban.",
  });
  assert.equal(state.rpcCalls.length, 1);
  assert.deepEqual(state.invalidated, []);
});
