import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// Execute actual server actions and usage helpers with mocked session/query I/O.
// Real SQL constraints, RLS and transactions are covered in the companion test.
async function compile(path) {
  return ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const [actionCode, usageCode] = await Promise.all([
  compile("../../src/app/(app)/curriculum/actions.ts"),
  compile("../../src/lib/data/learning-objective-usage.ts"),
]);
const plan = { id: "cp", class_id: "class", subject_id: "subject" };
const objective = { id: "tp", curriculum_plan_id: plan.id };

function setup(options = {}) {
  const state = {
    user: { id: "teacher", role: "teacher" },
    authorized: true,
    counts: { materials: 0, assignments: 0, quizzes: 0, meetings: 0 },
    usageError: null,
    usageMissing: false,
    mutationError: null,
    ...options,
    writes: [],
    rpcCalls: [],
    invalidated: [],
    scopeChecks: [],
  };
  const client = {
    rpc: async (name, params) => {
      state.rpcCalls.push({ name, params });
      if (name === "learning_objective_usage") {
        return {
          data: state.usageMissing ? [] : params.p_ids.map((id) => ({ id, ...state.counts })),
          error: state.usageError,
        };
      }
      assert.equal(name, "move_learning_objective");
      return { data: null, error: state.mutationError };
    },
    from(table) {
      const query = {
        filters: {},
        write: false,
        select() {
          return this;
        },
        eq(key, value) {
          this.filters[key] = value;
          return this;
        },
        update(values) {
          return this.mutate("update", values);
        },
        insert(values) {
          return this.mutate("insert", values);
        },
        upsert(values, options) {
          return this.mutate("upsert", values, options);
        },
        delete() {
          return this.mutate("delete");
        },
        mutate(operation, values, options) {
          this.write = true;
          state.writes.push({ table, operation, values, options });
          return this;
        },
        single() {
          return this.maybeSingle();
        },
        maybeSingle: async function () {
          if (this.write) return { data: { id: "saved" }, error: state.mutationError };
          if (table === "class_teacher_subjects") {
            state.scopeChecks.push(this.filters);
            return { data: state.authorized ? { id: "teaching" } : null, error: null };
          }
          if (table === "curriculum_plans") return { data: plan, error: null };
          assert.equal(table, "learning_objectives");
          return { data: objective, error: null };
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: this.write ? null : [objective],
            error: this.write ? state.mutationError : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const modules = {
    "next/cache": { revalidatePath: (path) => state.invalidated.push(path) },
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/data/profile": { getCurrentUser: async () => state.user },
  };
  function evaluate(code) {
    const exports = {};
    new Function("require", "exports", code)((name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
      return modules[name];
    }, exports);
    return exports;
  }
  const usage = evaluate(usageCode);
  modules["@/lib/data/learning-objective-usage"] = usage;
  return { state, usage, actions: evaluate(actionCode) };
}

function form(values) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

for (const dependency of ["materials", "assignments", "quizzes", "meetings"]) {
  test(`server actions reject TP and CP deletion when ${dependency} uses the TP`, async () => {
    const { state, actions } = setup({
      counts: { materials: 0, assignments: 0, quizzes: 0, meetings: 0, [dependency]: 1 },
    });
    assert.equal((await actions.deleteLearningObjective("tp")).ok, false);
    assert.equal((await actions.deleteCurriculumPlan("cp")).ok, false);
    assert.deepEqual(state.writes, []);
  });
}

for (const unavailable of [
  { usageError: { message: "Unavailable RPC" } },
  { usageMissing: true },
]) {
  test(`usage ${unavailable.usageMissing ? "missing rows" : "query failure"} blocks edit inspection, delete and reorder`, async () => {
    const { state, actions } = setup(unavailable);
    for (const result of [
      await actions.inspectCurriculumUsage("cp", "tp"),
      await actions.deleteLearningObjective("tp"),
      await actions.deleteCurriculumPlan("cp"),
      await actions.moveLearningObjective("tp", "down"),
    ])
      assert.equal(result.ok, false);
    assert.deepEqual(state.writes, []);
    assert.ok(state.rpcCalls.every(({ name }) => name === "learning_objective_usage"));
  });
}

test("unused CP/TP deletion succeeds only after matching teacher, class and subject", async () => {
  const { state, actions } = setup();
  assert.equal((await actions.deleteLearningObjective("tp")).ok, true);
  assert.equal((await actions.deleteCurriculumPlan("cp")).ok, true);
  assert.deepEqual(
    state.writes.map(({ operation }) => operation),
    ["delete", "delete"],
  );
  assert.ok(
    state.scopeChecks.every(
      (filters) =>
        filters.teacher_id === "teacher" &&
        filters.class_id === "class" &&
        filters.subject_id === "subject",
    ),
  );
  assert.ok(state.invalidated.includes("/curriculum"));
  assert.ok(state.invalidated.includes("/subjects"));
});

test("teacher without the matching assignment and non-teachers cannot mutate or inspect", async () => {
  for (const options of [
    { authorized: false },
    { user: { id: "student", role: "student" } },
    { user: null },
  ]) {
    const { state, actions } = setup(options);
    assert.equal((await actions.deleteLearningObjective("tp")).ok, false);
    assert.equal((await actions.deleteCurriculumPlan("cp")).ok, false);
    assert.equal((await actions.inspectCurriculumUsage("cp", "tp")).ok, false);
    assert.equal((await actions.moveLearningObjective("tp", "down")).ok, false);
    assert.deepEqual(state.writes, []);
    assert.deepEqual(state.rpcCalls, []);
  }
});

test("fresh edit inspection returns separate counts and includes journals in total", async () => {
  const { actions } = setup({
    counts: { materials: "2", assignments: "1", quizzes: "1", meetings: "1" },
  });
  const result = await actions.inspectCurriculumUsage("cp", "tp");
  assert.deepEqual(result, {
    ok: true,
    usage: { materials: 2, assignments: 1, quizzes: 1, meetings: 1, total: 5, isUsed: true },
  });
  assert.deepEqual(await actions.inspectCurriculumUsage("cp"), result);
});

test("used TP typo correction updates only its text and invalidates linked views", async () => {
  const { state, actions } = setup({
    counts: { materials: 2, assignments: 1, quizzes: 1, meetings: 0 },
  });
  assert.equal(
    (
      await actions.updateLearningObjective(
        form({
          id: "tp",
          title: " Corrected title ",
          sort_order: "99",
          curriculum_plan_id: "other",
        }),
      )
    ).ok,
    true,
  );
  assert.deepEqual(state.writes, [
    {
      table: "learning_objectives",
      operation: "update",
      values: { title: "Corrected title" },
      options: undefined,
    },
  ]);
  assert.ok(state.invalidated.includes("/grades"));
  assert.ok(state.invalidated.includes("/gradebook"));
});

test("saving CP content does not mutate or reassign its TP children", async () => {
  const { state, actions } = setup();
  assert.equal(
    (
      await actions.saveCurriculumPlan(
        form({
          class_id: "class",
          subject_id: "subject",
          cp_text: "Corrected CP",
        }),
      )
    ).ok,
    true,
  );
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].table, "curriculum_plans");
  assert.equal(state.writes[0].values.cp_text, "Corrected CP");
});

test("reorder uses the atomic RPC and rejects used TP and invalid direction", async () => {
  const { state, actions } = setup();
  assert.equal((await actions.moveLearningObjective("tp", "down")).ok, true);
  assert.deepEqual(state.rpcCalls.at(-1), {
    name: "move_learning_objective",
    params: { p_id: "tp", p_direction: "down" },
  });
  assert.deepEqual(state.writes, []);
  assert.equal((await actions.moveLearningObjective("tp", "sideways")).ok, false);
  state.counts.materials = 1;
  assert.equal((await actions.moveLearningObjective("tp", "up")).ok, false);
  assert.equal(state.rpcCalls.filter(({ name }) => name === "move_learning_objective").length, 1);
});

test("a concurrent dependency rejected by the database is returned as a friendly delete error", async () => {
  for (const code of ["23503", "23001"]) {
    const { actions } = setup({ mutationError: { code, message: "Raw FK error" } });
    assert.deepEqual(await actions.deleteLearningObjective("tp"), {
      ok: false,
      message:
        "Tujuan Pembelajaran tidak dapat dihapus karena sudah digunakan dalam aktivitas pembelajaran.",
    });
    assert.deepEqual(await actions.deleteCurriculumPlan("cp"), {
      ok: false,
      message:
        "CP tidak dapat dihapus karena masih memiliki Tujuan Pembelajaran yang digunakan dalam aktivitas pembelajaran.",
    });
  }
});
