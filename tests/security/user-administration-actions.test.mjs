import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function compile(file) {
  return ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const [userCode, appCode, guardCode] = await Promise.all([
  compile("../../src/app/(app)/users/actions.ts"),
  compile("../../src/app/(app)/actions.ts"),
  compile("../../src/lib/auth/guard.ts"),
]);

function setup(options = {}) {
  const state = {
    role: "admin",
    targetRole: "student",
    email: "old@nggodimeda.sch.id",
    profileError: false,
    authError: false,
    rollbackError: false,
    ...options,
    writes: [],
    authWrites: [],
    invalidated: [],
    reads: 0,
  };
  state.profile = {
    id: "user",
    role: state.targetRole,
    username: "old",
    nisn: "old",
    nip: "old",
    full_name: "Nama Lama",
    class_id: "class-a",
    updated_at: "before",
  };
  const supabase = {
    from(table) {
      assert.equal(table, "profiles");
      const query = {
        values: null,
        filters: {},
        select() {
          return this;
        },
        eq(key, value) {
          this.filters[key] = value;
          return this;
        },
        is(key, value) {
          this.filters[key] = value;
          return this;
        },
        update(values) {
          this.values = values;
          return this;
        },
        async maybeSingle() {
          if (this.values) {
            state.writes.push({ values: this.values, filters: this.filters });
            if (state.concurrentIdentity) {
              state.profile.username = "concurrent";
              state.profile.updated_at = "concurrent";
              state.email = "concurrent@nggodimeda.sch.id";
            }
            if (state.profileError) return { data: null, error: { message: "Perubahan ditolak" } };
            if (
              state.zeroRows ||
              !Object.entries(this.filters).every(([k, v]) => state.profile[k] === v)
            ) {
              return { data: null, error: null };
            }
            Object.assign(state.profile, this.values, { updated_at: "after" });
            if (state.lostWriteResponse) throw new Error("Connection lost after commit");
            return { data: { id: state.profile.id }, error: null };
          }
          state.reads++;
          if (state.readError || (state.verifyError && state.reads > 1)) {
            return { data: null, error: { message: "Read failed" } };
          }
          return { data: state.missing ? null : { ...state.profile }, error: null };
        },
      };
      return query;
    },
  };
  const admin = {
    auth: {
      admin: {
        async getUserById() {
          return state.authReadError
            ? { data: null, error: {} }
            : { data: { user: { email: state.email } }, error: null };
        },
        async updateUserById(id, values) {
          assert.equal(id, "user");
          state.authWrites.push(values);
          if (state.authThrow) throw new Error("Network unavailable");
          if (state.authNoUser) return { data: { user: null }, error: null };
          if (state.authError || (state.rollbackError && state.authWrites.length > 1)) {
            return { error: { message: "Email already been registered" } };
          }
          if (values.email) state.email = values.email;
          return { data: { user: { email: state.email } }, error: null };
        },
      },
    },
  };
  const modules = {
    "next/cache": { revalidatePath: (url) => state.invalidated.push(url) },
    "next/navigation": {},
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/data/profile": {
      getCurrentUser: async () => (state.role ? { id: "admin", role: state.role } : null),
    },
    "@/lib/validateUpload": {},
  };
  function evaluate(code) {
    const exports = {};
    new Function("require", "exports", code)((name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
      return modules[name];
    }, exports);
    return exports;
  }
  modules["@/lib/auth/guard"] = evaluate(guardCode);
  return { state, users: evaluate(userCode), app: evaluate(appCode) };
}
function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const edit = { id: "user", name: "Nama Baru", nisn: "new", nip: "new", class_id: "class-b" };

for (const [label, nisn, nip, password] of [
  ["student NISN", "0012345678", null, "0012345678"],
  ["staff NIP", null, "197001012000010001", "197001012000010001"],
  ["empty NISN with valid NIP", " ", "00123456", "00123456"],
]) {
  test(`reset retains ${label} as the default password`, async () => {
    const { state, users } = setup();
    Object.assign(state.profile, { nisn, nip });
    const result = await users.resetPasswordToDefault("user");
    assert.equal(result.ok, true);
    assert.deepEqual(state.authWrites, [{ password }]);
    assert.doesNotMatch(result.message, new RegExp(password));
    assert.deepEqual(state.writes, []);
  });
}

for (const options of [
  { role: "student" },
  { role: "teacher" },
  { role: "principal" },
  { role: null },
  { missing: true },
  { readError: true },
]) {
  test(`reset refuses an unauthorized/unreadable target: ${JSON.stringify(options)}`, async () => {
    const { state, users } = setup(options);
    assert.equal((await users.resetPasswordToDefault("user")).ok, false);
    assert.deepEqual(state.authWrites, []);
  });
}

test("missing identifiers prevent reset and Auth errors never produce success", async () => {
  const { state, users } = setup();
  Object.assign(state.profile, { nisn: " ", nip: null });
  assert.equal((await users.resetPasswordToDefault("user")).ok, false);
  assert.deepEqual(state.authWrites, []);
  for (const options of [{ authError: true }, { authThrow: true }, { authNoUser: true }]) {
    const fixture = setup(options);
    assert.equal((await fixture.users.resetPasswordToDefault("user")).ok, false);
  }
});

for (const targetRole of ["student", "teacher", "principal"]) {
  const method = targetRole === "student" ? "updateStudent" : "updateStaff";
  test(`${targetRole}: success requires both Auth and profile updates`, async () => {
    const { state, users } = setup({ targetRole });
    assert.equal((await users[method](form(edit))).ok, true);
    assert.equal(state.email, "new@nggodimeda.sch.id");
    assert.equal(state.profile.username, "new");
    assert.equal(state.profile.full_name, "Nama Baru");
    assert.equal(state.writes[0].filters.updated_at, "before");
    assert.ok(state.invalidated.includes("/users"));
    assert.ok(state.invalidated.includes("/master-kelas"));
  });
  test(`${targetRole}: profile rejection restores Auth and returns failure`, async () => {
    const { state, users } = setup({ targetRole, profileError: true });
    const result = await users[method](form(edit));
    assert.equal(result.ok, false);
    assert.match(result.message, /dikembalikan/);
    assert.equal(state.email, "old@nggodimeda.sch.id");
    assert.equal(state.profile.username, "old");
    assert.equal(state.authWrites.length, 2);
    assert.deepEqual(state.invalidated, []);
  });
}

test("Auth rejection never writes the profile", async () => {
  const { state, users } = setup({ authError: true });
  const result = await users.updateStudent(form(edit));
  assert.equal(result.ok, false);
  assert.match(result.message, /NISN ini sudah dipakai/);
  assert.deepEqual(state.writes, []);
});
test("zero updated rows are not reported as success; Auth is restored", async () => {
  const { state, users } = setup({ zeroRows: true });
  assert.equal((await users.updateStudent(form(edit))).ok, false);
  assert.equal(state.email, "old@nggodimeda.sch.id");
});
test("failed rollback reports an unresolved result, never restored/success", async () => {
  const { state, users } = setup({ profileError: true, rollbackError: true });
  const result = await users.updateStudent(form(edit));
  assert.equal(result.ok, false);
  assert.match(result.message, /belum dapat dipastikan atau dipulihkan/);
  assert.equal(state.email, "new@nggodimeda.sch.id");
  assert.deepEqual(state.invalidated, []);
});
test("unreadable outcome is not blindly rolled back", async () => {
  const { state, users } = setup({ profileError: true, verifyError: true });
  assert.equal((await users.updateStudent(form(edit))).ok, false);
  assert.equal(state.authWrites.length, 1);
});
test("lost response after commit is verified without reverting a saved identity", async () => {
  const { state, users } = setup({ lostWriteResponse: true });
  assert.equal((await users.updateStudent(form(edit))).ok, true);
  assert.equal(state.profile.username, "new");
  assert.equal(state.email, "new@nggodimeda.sch.id");
  assert.equal(state.authWrites.length, 1);
});
test("concurrent identity changes are not overwritten by compensation", async () => {
  const { state, users } = setup({ concurrentIdentity: true });
  assert.equal((await users.updateStudent(form(edit))).ok, false);
  assert.equal(state.email, "concurrent@nggodimeda.sch.id");
  assert.equal(state.profile.username, "concurrent");
  assert.equal(state.authWrites.length, 1);
});
test("editing name alone does not rewrite Auth", async () => {
  const { state, users } = setup();
  assert.equal((await users.updateStudent(form({ ...edit, nisn: "old" }))).ok, true);
  assert.deepEqual(state.authWrites, []);
});
for (const options of [
  { missing: true },
  { readError: true },
  { authReadError: true },
  { targetRole: "admin" },
]) {
  test(`invalid/unreadable target has no writes: ${JSON.stringify(options)}`, async () => {
    const { state, users } = setup(options);
    assert.equal((await users.updateStudent(form(edit))).ok, false);
    assert.deepEqual(state.authWrites, []);
    assert.deepEqual(state.writes, []);
  });
}
for (const role of [null, "student", "teacher", "principal"]) {
  test(`caller ${role} cannot update accounts or placements`, async () => {
    const { state, users, app } = setup({ role });
    assert.equal((await users.updateStudent(form(edit))).ok, false);
    assert.equal((await users.updateStaff(form(edit))).ok, false);
    assert.equal((await app.assignStudentToClass(form({ student_id: "user" }))).ok, false);
    assert.deepEqual(state.authWrites, []);
    assert.deepEqual(state.writes, []);
  });
}
test("moving a placed student requires explicit confirmation", async () => {
  const { state, app } = setup();
  const result = await app.assignStudentToClass(
    form({ student_id: "user", class_id: "class-b", expected_class_id: "class-a" }),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(state.writes, []);
});
test("confirmed move checks the original placement before updating", async () => {
  const { state, app } = setup();
  assert.equal(
    (
      await app.assignStudentToClass(
        form({
          student_id: "user",
          class_id: "class-b",
          expected_class_id: "class-a",
          confirm_move: "true",
        }),
      )
    ).ok,
    true,
  );
  assert.equal(state.profile.class_id, "class-b");
});
test("stale confirmation does not move a student from another class", async () => {
  const { state, app } = setup();
  assert.equal(
    (
      await app.assignStudentToClass(
        form({
          student_id: "user",
          class_id: "class-b",
          expected_class_id: "stale-class",
          confirm_move: "true",
        }),
      )
    ).ok,
    false,
  );
  assert.equal(state.profile.class_id, "class-a");
});
test("claiming an occupied student is unplaced cannot bypass confirmation", async () => {
  const { state, app } = setup();
  assert.equal(
    (
      await app.assignStudentToClass(
        form({ student_id: "user", class_id: "class-b", expected_class_id: "" }),
      )
    ).ok,
    false,
  );
  assert.equal(state.profile.class_id, "class-a");
});
test("an unplaced student can be assigned immediately", async () => {
  const { state, app } = setup();
  state.profile.class_id = null;
  assert.equal(
    (
      await app.assignStudentToClass(
        form({ student_id: "user", class_id: "class-b", expected_class_id: "" }),
      )
    ).ok,
    true,
  );
  assert.equal(state.profile.class_id, "class-b");
});
test("removing a student also checks their current class", async () => {
  const { state, app } = setup();
  assert.equal(
    (await app.assignStudentToClass(form({ student_id: "user", expected_class_id: "class-a" }))).ok,
    true,
  );
  assert.equal(state.profile.class_id, null);
});
