import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function compile(file) {
  return ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const [appCode, guardCode, validationCode, configCode] = await Promise.all([
  compile("../../src/app/(app)/actions.ts"),
  compile("../../src/lib/auth/guard.ts"),
  compile("../../src/lib/validateUpload.ts"),
  compile("../../next.config.ts"),
]);

// Run actual actions with failure-injectable storage/database responses, never a live project.
function setup(options = {}) {
  const state = {
    role: "admin",
    profile: { id: "school", logo_url: "https://assets.test/old.png" },
    writes: [],
    uploads: [],
    removals: [],
    invalidated: [],
    reads: 0,
    ...options,
  };
  const supabase = {
    from(table) {
      assert.equal(table, "schools");
      return {
        values: null,
        filters: {},
        select() {
          return this;
        },
        limit() {
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
            if (state.concurrentLogo) state.profile.logo_url = "https://assets.test/concurrent.png";
            if (state.writeError) return { data: null, error: { message: "Update rejected" } };
            if (
              state.zeroRows ||
              !Object.entries(this.filters).every(([k, v]) => state.profile[k] === v)
            )
              return { data: null, error: null };
            Object.assign(state.profile, this.values);
            if (state.lostResponse) throw new Error("Lost response after commit");
            return { data: { ...state.profile }, error: null };
          }
          state.reads++;
          if (state.readError || (state.verifyError && state.reads > 1))
            return { data: null, error: { message: "Read failed" } };
          return { data: state.missing ? null : { ...state.profile }, error: null };
        },
      };
    },
  };
  const storage = {
    async upload(path, file, options) {
      state.uploads.push({ path, file, options });
      return { error: state.uploadError ? { message: "Upload rejected" } : null };
    },
    getPublicUrl(path) {
      return { data: { publicUrl: `https://assets.test/${path}` } };
    },
    async remove(paths) {
      state.removals.push(...paths);
      if (state.cleanupThrows) throw new Error("Cleanup unavailable");
      return { error: state.cleanupError ? { message: "Cleanup failed" } : null };
    },
  };
  const modules = {
    "next/cache": { revalidatePath: (...args) => state.invalidated.push(args) },
    "next/navigation": {},
    "@/lib/data/profile": {
      getCurrentUser: async () => (state.role ? { role: state.role } : null),
    },
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/supabase/admin": {
      createAdminClient: () => ({
        storage: {
          from(bucket) {
            assert.equal(bucket, "school-assets");
            return storage;
          },
        },
      }),
    },
  };
  function evaluate(code) {
    const exports = {};
    new Function("require", "exports", code)((name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
      return modules[name];
    }, exports);
    return exports;
  }
  modules["@/lib/auth/guard"] = evaluate(guardCode);
  modules["@/lib/validateUpload"] = evaluate(validationCode);
  return { state, actions: evaluate(appCode) };
}
function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const logo = () => new File(["image data"], "untrusted-name.svg", { type: "image/png" });

for (const role of [null, "student", "teacher", "principal"]) {
  test(`${role}: cannot save school identity or logo`, async () => {
    const { actions, state } = setup({ role });
    assert.equal((await actions.saveSchoolSettings(form({ name: "Changed" }))).ok, false);
    assert.equal((await actions.uploadSchoolLogo(form({ logo: logo() }))).ok, false);
    assert.deepEqual(state.writes, []);
    assert.deepEqual(state.uploads, []);
  });
}
test("school profile success requires an updated row and refreshes the shared identity", async () => {
  const { actions, state } = setup();
  assert.equal(
    (
      await actions.saveSchoolSettings(
        form({ name: " Sekolah Baru ", phone: "0123", address: "Alamat" }),
      )
    ).ok,
    true,
  );
  assert.equal(state.profile.name, "Sekolah Baru");
  assert.deepEqual(state.invalidated, [["/", "layout"]]);
});
for (const options of [
  { writeError: true },
  { zeroRows: true },
  { missing: true },
  { readError: true },
]) {
  test(`school profile failure does not claim success: ${JSON.stringify(options)}`, async () => {
    const { actions, state } = setup(options);
    assert.equal((await actions.saveSchoolSettings(form({ name: "Changed" }))).ok, false);
    assert.deepEqual(state.invalidated, []);
  });
}
test("logo accepts exactly 2 MB, derives extension from MIME, and returns persisted URL", async () => {
  const { actions, state } = setup();
  const result = await actions.uploadSchoolLogo(
    form({ logo: new File([new Uint8Array(2 * 1024 * 1024)], "name.svg", { type: "image/png" }) }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.logoUrl, state.profile.logo_url);
  assert.match(state.uploads[0].path, /^logo\/school\/.+\.png$/);
  assert.equal(state.uploads[0].options.upsert, false);
  assert.equal(state.writes[0].filters.logo_url, "https://assets.test/old.png");
  assert.deepEqual(state.removals, []);
  assert.deepEqual(state.invalidated, [["/", "layout"]]);
});
for (const file of [
  "not a file",
  new File([], "empty.png", { type: "image/png" }),
  new File(["text"], "text.txt", { type: "text/plain" }),
  new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
]) {
  test(`invalid logo is rejected before upload: ${typeof file === "string" ? file : file.name}`, async () => {
    const { actions, state } = setup();
    assert.equal((await actions.uploadSchoolLogo(form({ logo: file }))).ok, false);
    assert.deepEqual(state.uploads, []);
    assert.deepEqual(state.writes, []);
  });
}
test("storage failure never updates the school or changes its previous logo", async () => {
  const { actions, state } = setup({ uploadError: true });
  assert.equal((await actions.uploadSchoolLogo(form({ logo: logo() }))).ok, false);
  assert.deepEqual(state.writes, []);
  assert.equal(state.profile.logo_url, "https://assets.test/old.png");
});
for (const options of [{ writeError: true }, { zeroRows: true }, { concurrentLogo: true }]) {
  test(`failed logo save removes only its own new file: ${JSON.stringify(options)}`, async () => {
    const { actions, state } = setup(options);
    assert.equal((await actions.uploadSchoolLogo(form({ logo: logo() }))).ok, false);
    assert.deepEqual(state.removals, [state.uploads[0].path]);
    assert.equal(
      state.profile.logo_url,
      options.concurrentLogo ? "https://assets.test/concurrent.png" : "https://assets.test/old.png",
    );
    assert.deepEqual(state.invalidated, []);
  });
}
test("lost response after logo commit is verified and the referenced file is retained", async () => {
  const { actions, state } = setup({ lostResponse: true });
  const result = await actions.uploadSchoolLogo(form({ logo: logo() }));
  assert.equal(result.ok, true);
  assert.equal(result.logoUrl, state.profile.logo_url);
  assert.deepEqual(state.removals, []);
});
test("uncertain database outcome never deletes a potentially referenced logo", async () => {
  const { actions, state } = setup({ writeError: true, verifyError: true });
  const result = await actions.uploadSchoolLogo(form({ logo: logo() }));
  assert.equal(result.ok, false);
  assert.match(result.message, /belum dapat dipastikan/);
  assert.deepEqual(state.removals, []);
});
for (const options of [{ cleanupError: true }, { cleanupThrows: true }]) {
  test(`cleanup failure is reported without claiming success: ${JSON.stringify(options)}`, async () => {
    const { actions } = setup({ writeError: true, ...options });
    const result = await actions.uploadSchoolLogo(form({ logo: logo() }));
    assert.equal(result.ok, false);
    assert.match(result.message, /belum dapat dibersihkan/);
  });
}
test("request budget accommodates a 2 MB file in both production and dev-tunnel configurations", () => {
  for (const NODE_ENV of ["production", "development"]) {
    const exports = {};
    new Function("exports", "process", configCode)(exports, {
      env: { NODE_ENV, DEV_TUNNEL_HOST: "school.example.test" },
    });
    assert.equal(exports.default.experimental.serverActions.bodySizeLimit, "3mb");
    assert.deepEqual(
      exports.default.experimental.serverActions.allowedOrigins,
      NODE_ENV === "development" ? ["school.example.test", "localhost:3000"] : undefined,
    );
  }
});
