import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { z } from "zod";
const compile = async (p) =>
  ts.transpileModule(await readFile(new URL("../../" + p, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const [actionsCode, guardCode, timeCode] = await Promise.all([
  compile("src/app/(app)/classroom/actions.ts"),
  compile("src/lib/auth/guard.ts"),
  compile("src/lib/assignmentConstants.ts"),
]);
const id = (n) => "30000000-0000-4000-8000-" + String(n).padStart(12, "0");
function setup(published = false, role = "teacher") {
  const state = { writes: [], rpcs: [], invalidated: [] };
  const query = (table) => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: async () => ({
      data:
        table === "quiz_questions"
          ? { assignment_id: id(2) }
          : { id: id(2), is_published: published },
      error: null,
    }),
    insert(values) {
      state.writes.push({ table, values });
      return this;
    },
    update(values) {
      state.writes.push({ table, values });
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve({ error: null }).then(resolve, reject);
    },
  });
  const modules = {
    zod: { z },
    "next/cache": { revalidatePath: (p) => state.invalidated.push(p) },
    "next/navigation": {},
    "@/lib/data/profile": { getCurrentUser: async () => ({ id: id(1), role }) },
    "@/lib/supabase/server": {
      createClient: async () => ({
        from: query,
        rpc: async (name, params) => {
          state.rpcs.push({ name, params });
          return { data: id(3), error: null };
        },
      }),
    },
    "@/lib/supabase/admin": {},
    "@/lib/materialEmbeds": {},
    "@/lib/validateUpload": {},
    "@/lib/assignmentFiles": {},
    "@/lib/sanitizeRichText": { sanitizeRichText: (x) => x },
    "@/lib/richTextEmpty": { richTextIsEmpty: (x) => !x },
  };
  const evaluate = (code) => {
    const exports = {};
    new Function("require", "exports", code)((name) => {
      assert.ok(Object.hasOwn(modules, name), name);
      return modules[name];
    }, exports);
    return exports;
  };
  modules["@/lib/auth/guard"] = evaluate(guardCode);
  modules["@/lib/assignmentConstants"] = evaluate(timeCode);
  return { state, actions: evaluate(actionsCode) };
}
function quizForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    id: id(2),
    class_id: id(4),
    subject_id: id(5),
    title: "Quiz",
    quiz_type: "latihan",
    learning_objective_id: id(6),
    description: "Instructions",
    due_date: "2099-01-01",
    due_time: "15:30",
    timer_minutes: "20",
    passing_grade: "70",
  }))
    form.set(key, value);
  return form;
}

test("new quiz remains a draft and stores its WITA deadline independently of server timezone", async () => {
  const { state, actions } = setup();
  assert.equal((await actions.createQuiz(quizForm())).ok, true);
  assert.equal(state.writes[0].values.is_published, false);
  assert.equal(state.writes[0].values.due_at, "2099-01-01T07:30:00.000Z");
});
test("published quiz only updates approved metadata even with forged or missing grading inputs", async () => {
  const { state, actions } = setup(true);
  const form = quizForm();
  form.set("learning_objective_id", "");
  form.set("passing_grade", "999");
  form.set("quiz_type", "fake");
  assert.equal((await actions.updateQuiz(form)).ok, true);
  assert.deepEqual(Object.keys(state.writes[0].values).sort(), ["description", "due_at", "title"]);
});
test("question edit passes its changed type and all answer content to one atomic RPC", async () => {
  const { state, actions } = setup();
  const form = new FormData();
  for (const [key, value] of Object.entries({
    id: id(3),
    question_text: "Order",
    question_type: "sequence",
    points: "100",
  }))
    form.set(key, value);
  form.append("step_text", "First");
  form.append("step_text", "Second");
  assert.equal((await actions.updateQuizQuestion(form)).ok, true);
  assert.equal(state.writes.length, 0);
  assert.equal(state.rpcs.length, 1);
  assert.equal(state.rpcs[0].name, "save_quiz_question");
  assert.equal(state.rpcs[0].params.p_question.questionType, "sequence");
  assert.deepEqual(state.rpcs[0].params.p_question.steps, ["First", "Second"]);
});
test("incomplete matching pairs are rejected instead of silently discarded", async () => {
  const { state, actions } = setup();
  const form = new FormData();
  for (const [key, value] of Object.entries({
    assignment_id: id(2),
    question_text: "Match",
    question_type: "drag_and_drop",
    points: "100",
  }))
    form.set(key, value);
  for (const text of ["A", "B", "Unfinished"]) form.append("pair_drag_text", text);
  for (const text of ["1", "2", ""]) form.append("pair_target_text", text);
  assert.equal((await actions.addQuizQuestion(form)).ok, false);
  assert.equal(state.rpcs.length, 0);
});
