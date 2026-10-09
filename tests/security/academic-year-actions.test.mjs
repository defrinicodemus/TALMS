import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function compile(path) {
  return ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const [actionCode, guardCode] = await Promise.all([
  compile("../../src/app/(app)/actions.ts"),
  compile("../../src/lib/auth/guard.ts"),
]);

function setup({ role = "admin", error = null } = {}) {
  const writes = [];
  const calls = [];
  const invalidated = [];
  const client = {
    async rpc(name, params) {
      calls.push({ name, params });
      return { error };
    },
    from(table) {
      return {
        select() {
          assert.equal(table, "schools");
          return this;
        },
        limit() {
          return this;
        },
        async single() {
          return { data: { id: "school" } };
        },
        async insert(values) {
          assert.equal(table, "academic_years");
          writes.push(values);
          return { error };
        },
      };
    },
  };
  const modules = {
    "next/cache": { revalidatePath: (path) => invalidated.push(path) },
    "next/navigation": {},
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/supabase/admin": {},
    "@/lib/data/profile": {
      getCurrentUser: async () => (role ? { id: "user", role } : null),
    },
    "@/lib/validateUpload": {},
  };
  function evaluate(code) {
    const exports = {};
    new Function("require", "exports", code)((name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
      return modules[name];
    }, exports);
    return exports;
  }
  modules["@/lib/auth/guard"] = evaluate(guardCode);
  return { actions: evaluate(actionCode), writes, calls, invalidated };
}

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

test("creation keeps a new year inactive even when a caller supplies an active flag", async () => {
  const { actions, writes, calls } = setup();
  const result = await actions.createAcademicYear(
    form({ year_label: "2026/2027", semester: "ganjil", is_active: "true" }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(writes, [
    { school_id: "school", year_label: "2026/2027", semester: "ganjil", is_active: false },
  ]);
  assert.deepEqual(calls, []);
});

test("activation uses the atomic RPC and refreshes the administrative views", async () => {
  const { actions, writes, calls, invalidated } = setup();
  assert.equal((await actions.setActiveAcademicYear(form({ id: "year" }))).ok, true);
  assert.deepEqual(calls, [{ name: "set_active_academic_year", params: { p_id: "year" } }]);
  assert.deepEqual(writes, []);
  for (const path of ["/academic", "/master-kelas", "/users", "/dashboard"])
    assert.ok(invalidated.includes(path));
});

test("activation failure is returned without fallback writes or success invalidation", async () => {
  const { actions, writes, calls, invalidated } = setup({
    error: { message: "Activation failed" },
  });
  assert.deepEqual(await actions.setActiveAcademicYear(form({ id: "year" })), {
    ok: false,
    message: "Activation failed",
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(writes, []);
  assert.deepEqual(invalidated, []);
});

test("invalid creation and activation input does not write or call the RPC", async () => {
  const { actions, writes, calls } = setup();
  assert.equal((await actions.setActiveAcademicYear(form({}))).ok, false);
  assert.equal((await actions.deactivateAcademicYear(form({}))).ok, false);
  assert.equal(
    (await actions.createAcademicYear(form({ year_label: "2026/2027", semester: "other" }))).ok,
    false,
  );
  assert.deepEqual(writes, []);
  assert.deepEqual(calls, []);
});

test("non-admin and unauthenticated callers cannot create or activate years", async () => {
  for (const role of ["student", "teacher", "principal", null]) {
    const { actions, writes, calls } = setup({ role });
    assert.equal((await actions.setActiveAcademicYear(form({ id: "year" }))).ok, false);
    assert.equal((await actions.deactivateAcademicYear(form({ id: "year" }))).ok, false);
    assert.equal(
      (await actions.createAcademicYear(form({ year_label: "2026/2027", semester: "ganjil" }))).ok,
      false,
    );
    assert.deepEqual(writes, []);
    assert.deepEqual(calls, []);
  }
});

test("deactivation uses its RPC, propagates failures, and refreshes layout only on success", async () => {
  for (const error of [null, { message: "Stale year" }]) {
    const { actions, calls, writes, invalidated } = setup({ error });
    const result = await actions.deactivateAcademicYear(form({ id: "year" }));
    assert.equal(result.ok, !error);
    assert.deepEqual(calls, [{ name: "deactivate_academic_year", params: { p_id: "year" } }]);
    assert.deepEqual(writes, []);
    if (error) {
      assert.equal(result.message, error.message);
      assert.deepEqual(invalidated, []);
    } else assert.ok(invalidated.includes("/"));
  }
});
