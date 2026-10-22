import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const project = fileURLToPath(new URL("../../", import.meta.url));
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const original = {
  id: id(1),
  class_id: id(2),
  subject_id: id(3),
  kind: "pdf",
  url: "https://storage.example/old.pdf",
  learning_objective_id: id(4),
  is_active: true,
};
const pdf = () => new File(["%PDF-1.7\nexample"], "materi.pdf", { type: "application/pdf" });
function form(values = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    id: id(1),
    class_id: id(2),
    subject_id: id(3),
    learning_objective_id: id(4),
    title: "Pecahan",
    kind: "pdf",
    ...values,
  }))
    data.set(key, value);
  return data;
}

// Execute real actions/validators; only Supabase, identity, and Next cache are mocked.
function setup(options = {}) {
  const state = {
    user: { id: id(5), role: "teacher", classId: id(2) },
    material: { ...original },
    teaching: true,
    objective: true,
    writeError: null,
    uploadError: null,
    emptyUpdate: false,
    ...options,
    uploads: [],
    removed: [],
    writes: [],
    reads: [],
    invalidated: [],
    views: new Set(),
  };
  const client = {
    from(table) {
      let mode = "select",
        payload,
        settings;
      const filters = {};
      const query = {
        select() {
          return this;
        },
        eq(key, value) {
          filters[key] = value;
          return this;
        },
        insert(value) {
          mode = "insert";
          payload = value;
          return this;
        },
        update(value) {
          mode = "update";
          payload = value;
          return this;
        },
        upsert(value, opts) {
          mode = "upsert";
          payload = value;
          settings = opts;
          return this;
        },
        maybeSingle() {
          return execute();
        },
        then(resolve, reject) {
          return execute().then(resolve, reject);
        },
      };
      async function execute() {
        if (mode !== "select") {
          state.writes.push({ table, mode, payload, filters: { ...filters }, settings });
          if (state.writeError) return { data: null, error: state.writeError };
          if (mode === "update" && state.emptyUpdate) return { data: null, error: null };
          if (table === "materials") Object.assign(state.material, payload);
          if (table === "material_views")
            state.views.add(`${payload.material_id}:${payload.student_id}`);
          return { data: { id: id(1) }, error: null };
        }
        state.reads.push({ table, filters: { ...filters } });
        if (table === "class_teacher_subjects") {
          assert.deepEqual(filters, {
            teacher_id: state.user.id,
            class_id: id(2),
            subject_id: id(3),
          });
          return { data: state.teaching ? { id: id(10) } : null, error: null };
        }
        if (table === "learning_objectives") {
          assert.equal(filters["curriculum_plans.class_id"], id(2));
          assert.equal(filters["curriculum_plans.subject_id"], id(3));
          return {
            data: state.objective && filters.id === id(4) ? { id: id(4) } : null,
            error: null,
          };
        }
        assert.equal(table, "materials");
        const visible =
          state.material &&
          Object.entries(filters).every(([key, value]) => state.material[key] === value);
        return { data: visible ? { ...state.material } : null, error: null };
      }
      return query;
    },
  };
  const modules = {
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/supabase/admin": {
      createAdminClient: () => ({
        storage: {
          from(bucket) {
            assert.equal(bucket, "learning-materials");
            return {
              async upload(uploadPath, file, opts) {
                state.uploads.push({ path: uploadPath, file, opts });
                return { error: state.uploadError };
              },
              getPublicUrl: (uploadPath) => ({
                data: { publicUrl: `https://storage.example/${uploadPath}` },
              }),
              async remove(paths) {
                state.removed.push(...paths);
                return { error: null };
              },
            };
          },
        },
      }),
    },
    "@/lib/data/profile": { getCurrentUser: async () => state.user },
    "@/lib/data/subjects": {},
    "@/lib/quizServer": {},
    "next/cache": { revalidatePath: (...args) => state.invalidated.push(args) },
    "next/navigation": { redirect: () => assert.fail("Unexpected redirect") },
  };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    const code = ts.transpileModule(readFileSync(path.join(project, filename), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    new Function("require", "exports", code)((name) => {
      if (modules[name]) return modules[name];
      if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
      return require(name);
    }, exports);
    cache.set(filename, exports);
    return exports;
  }
  return {
    state,
    actions: load("src/app/(app)/classroom/actions.ts"),
    mark: load("src/app/(app)/subjects/actions.ts").markMaterialViewed,
    embeds: load("src/lib/materialEmbeds.ts"),
  };
}

test("published and ordinary Google Slides links retain the complete presentation ID", () => {
  const { embeds } = setup();
  assert.equal(
    embeds.getGoogleSlidesEmbedUrl(
      "https://docs.google.com/presentation/d/e/2PACX-example/pub?start=false",
    ),
    "https://docs.google.com/presentation/d/e/2PACX-example/embed",
  );
  assert.equal(
    embeds.getGoogleSlidesEmbedUrl(
      "https://docs.google.com/presentation/d/abc_123/edit?usp=sharing",
    ),
    "https://docs.google.com/presentation/d/abc_123/embed",
  );
  assert.equal(
    embeds.getGoogleSlidesEmbedUrl("https://docs.google.com/presentation/d/e/embed"),
    null,
  );
});

test("embeds reject lookalike domains, non-web protocols and invalid video IDs", () => {
  const { embeds } = setup();
  for (const value of [
    "https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "javascript:youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ-extra",
  ])
    assert.equal(embeds.extractYoutubeId(value), null);
  assert.equal(
    embeds.getGoogleSlidesEmbedUrl("https://evil.example/presentation/d/abc/edit"),
    null,
  );
  assert.equal(
    embeds.extractYoutubeId("https://youtube.com/watch?t=15&v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(embeds.extractYoutubeId("https://youtu.be/dQw4w9WgXcQ?si=abc"), "dQw4w9WgXcQ");
});

test("Canva view and smart embed links normalize without losing the share token", () => {
  const { embeds } = setup();
  for (const [input, expected] of [
    [
      "https://www.canva.com/design/DAG-example/Share_token-123/view?utm_content=DAG-example&utm_source=sharebutton",
      "https://www.canva.com/design/DAG-example/Share_token-123/view?embed",
    ],
    [
      "https://canva.com/design/DAG-example/view/",
      "https://www.canva.com/design/DAG-example/view?embed",
    ],
    [
      "https://www.canva.com/design/DAG-example/Share_token-123/view?embed=&meta=",
      "https://www.canva.com/design/DAG-example/Share_token-123/view?embed",
    ],
  ]) {
    assert.equal(embeds.getMaterialMediaUrl("slideshow", input), expected);
    assert.equal(embeds.getMaterialMediaUrl("slideshow", expected), expected);
    assert.equal(embeds.getMaterialOpenUrl("slideshow", input), expected.replace("?embed", ""));
  }
});

test("Canva support rejects editor, template, HTML, lookalike host and malformed links", () => {
  const { embeds } = setup();
  for (const input of [
    "https://www.canva.com/design/DAG-example/Share_token-123/edit",
    "https://www.canva.com/design/DAG-example/Share_token-123/template",
    "https://www.canva.com/design/DAG-example",
    "https://www.canva.com/design//view",
    "https://www.canva.com/design/DAG-example/token/view/extra",
    "https://www.canva.com.evil.example/design/DAG-example/token/view",
    "https://evil.example/design/DAG-example/token/view",
    "https://www.canva.com@evil.example/design/DAG-example/token/view",
    "https://evil.example@www.canva.com/design/DAG-example/token/view",
    "https://www.canva.com:444/design/DAG-example/token/view",
    "javascript:alert(1)",
    '<iframe src="https://www.canva.com/design/DAG-example/token/view?embed"></iframe>',
  ]) {
    assert.equal(embeds.getMaterialMediaUrl("slideshow", input), null, input);
    assert.equal(embeds.getMaterialOpenUrl("slideshow", input), null, input);
  }
});

test("teacher can create and edit Canva slideshows through the existing material actions", async () => {
  const { state, actions } = setup();
  assert.equal(
    (
      await actions.createMaterial(
        form({
          kind: "slideshow",
          url: "https://www.canva.com/design/DAG-example/token/view?utm_source=share",
          status: "published",
        }),
      )
    ).ok,
    true,
  );
  assert.equal(state.material.url, "https://www.canva.com/design/DAG-example/token/view?embed");
  assert.equal(state.material.kind, "slideshow");
  assert.equal(state.material.is_active, true);
  assert.equal(
    (
      await actions.updateMaterial(
        form({
          url: "https://www.canva.com/design/DAG-new/new_token/view?embed",
        }),
      )
    ).ok,
    true,
  );
  assert.equal(state.material.url, "https://www.canva.com/design/DAG-new/new_token/view?embed");
  assert.equal(state.material.id, original.id);
  assert.equal(state.material.learning_objective_id, original.learning_objective_id);
  assert.equal(state.uploads.length, 0);
});

test("backend rejects Canva edit links and retains the previous slideshow", async () => {
  const previous = {
    ...original,
    kind: "slideshow",
    url: "https://docs.google.com/presentation/d/old/embed",
  };
  const { state, actions } = setup({ material: previous });
  const input = form({
    kind: "slideshow",
    url: "https://www.canva.com/design/DAG-example/token/edit",
  });
  for (const action of [actions.createMaterial, actions.updateMaterial]) {
    const result = await action(input);
    assert.equal(result.ok, false);
    assert.match(result.message, /tautan tampilan\/embed Canva/);
  }
  assert.deepEqual(state.material, previous);
  assert.deepEqual(state.writes, []);
});

for (const role of [null, "student", "principal", "admin"])
  test(`material writes reject ${role ?? "anonymous"} before storage access`, async () => {
    const { state, actions } = setup({ user: role ? { id: id(5), role } : null });
    assert.equal((await actions.createMaterial(form({ file: pdf() }))).ok, false);
    assert.equal((await actions.updateMaterial(form({ file: pdf() }))).ok, false);
    assert.equal(state.uploads.length, 0);
    assert.equal(state.writes.length, 0);
  });

for (const restriction of [{ teaching: false }, { objective: false }])
  test(`upload requires teaching assignment and matching TP: ${JSON.stringify(restriction)}`, async () => {
    const { state, actions } = setup(restriction);
    assert.equal((await actions.createMaterial(form({ file: pdf() }))).ok, false);
    assert.equal((await actions.updateMaterial(form({ file: pdf() }))).ok, false);
    assert.equal(state.uploads.length, 0);
    assert.equal(state.writes.length, 0);
  });

for (const [label, file] of [
  [
    "oversized",
    new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" }),
  ],
  ["empty", new File([], "empty.pdf", { type: "application/pdf" })],
  ["wrong MIME", new File(["<svg/>"], "image.svg", { type: "image/svg+xml" })],
  ["forged MIME", new File(["<script>bad</script>"], "fake.pdf", { type: "application/pdf" })],
])
  test(`${label} file is rejected by create and update without changing the old material`, async () => {
    const { state, actions } = setup();
    assert.equal((await actions.createMaterial(form({ file }))).ok, false);
    assert.equal((await actions.updateMaterial(form({ file }))).ok, false);
    assert.equal(state.uploads.length, 0);
    assert.deepEqual(state.material, original);
  });

test("draft/publication retain existing is_active behavior", async () => {
  for (const status of ["draft", "published"]) {
    const { state, actions } = setup();
    assert.equal((await actions.createMaterial(form({ file: pdf(), status }))).ok, true);
    assert.equal(state.material.is_active, status === "published");
    assert.equal(state.material.teacher_id, id(5));
    assert.equal(state.uploads[0].opts.upsert, false);
  }
});

test("editing a title keeps the existing attachment, ID, TP and visibility", async () => {
  const { state, actions } = setup();
  assert.equal((await actions.updateMaterial(form())).ok, true);
  assert.equal(state.material.url, original.url);
  assert.equal(state.material.id, original.id);
  assert.equal(state.material.learning_objective_id, original.learning_objective_id);
  assert.equal(state.material.is_active, true);
  assert.equal(state.uploads.length, 0);
});

test("replacing a file uses a new storage path without deleting the old file or resetting progress", async () => {
  const { state, actions } = setup();
  assert.equal((await actions.updateMaterial(form({ file: pdf() }))).ok, true);
  assert.notEqual(state.material.url, original.url);
  assert.match(state.uploads[0].path, new RegExp(`^${id(2)}/${id(3)}/.+\\.pdf$`));
  assert.equal(state.material.id, original.id);
  assert.equal(state.material.learning_objective_id, original.learning_objective_id);
  assert.equal(state.writes.length, 1);
  assert.deepEqual(state.removed, []);
});

for (const options of [
  { uploadError: { message: "Storage unavailable" } },
  { writeError: { message: "Rejected by RLS" } },
  { emptyUpdate: true },
])
  test(`replacement failure preserves the original: ${JSON.stringify(options)}`, async () => {
    const { state, actions } = setup(options);
    assert.equal((await actions.updateMaterial(form({ file: pdf() }))).ok, false);
    assert.deepEqual(state.material, original);
    assert.deepEqual(state.invalidated, []);
    assert.deepEqual(state.removed, options.uploadError ? [] : [state.uploads[0].path]);
  });

test("failed creation cleans up only the newly uploaded file", async () => {
  const { state, actions } = setup({ writeError: { message: "Rejected" } });
  assert.equal((await actions.createMaterial(form({ file: pdf() }))).ok, false);
  assert.deepEqual(state.removed, [state.uploads[0].path]);
});

test("text sanitization rejects content empty after sanitizing", async () => {
  const { state, actions } = setup();
  assert.equal(
    (await actions.createMaterial(form({ kind: "text", content: "<script>alert(1)</script>" }))).ok,
    false,
  );
  assert.equal(
    (await actions.createMaterial(form({ kind: "text", content: "<p>&nbsp;</p>" }))).ok,
    false,
  );
  assert.equal(
    (
      await actions.createMaterial(
        form({ kind: "text", content: '<p onclick="bad()">Pecahan</p><script>bad()</script>' }),
      )
    ).ok,
    true,
  );
  assert.equal(state.material.content, "<p>Pecahan</p>");
});

test("teacher can repair a legacy broken slideshow URL without changing its TP or ID", async () => {
  const { state, actions } = setup({
    material: {
      ...original,
      kind: "slideshow",
      url: "https://docs.google.com/presentation/d/e/embed",
    },
  });
  assert.equal(
    (
      await actions.updateMaterial(
        form({ url: "https://docs.google.com/presentation/d/e/2PACX-new/pub" }),
      )
    ).ok,
    true,
  );
  assert.equal(state.material.url, "https://docs.google.com/presentation/d/e/2PACX-new/embed");
  assert.equal(state.material.id, original.id);
  assert.equal(state.material.learning_objective_id, original.learning_objective_id);
});

test("student read action is idempotent, uses authenticated identity and refreshes progress", async () => {
  const { state, mark } = setup({ user: { id: id(6), role: "student", classId: id(2) } });
  assert.equal((await mark(id(1))).ok, true);
  assert.equal((await mark(id(1))).ok, true);
  assert.equal(state.views.size, 1);
  for (const write of state.writes) {
    assert.deepEqual(write.payload, { material_id: id(1), student_id: id(6) });
    assert.equal(write.settings.ignoreDuplicates, true);
  }
  assert.ok(state.invalidated.some(([route, type]) => route === "/subjects" && type === "layout"));
});

for (const options of [
  { user: null },
  { user: { id: id(5), role: "teacher", classId: id(2) } },
  { user: { id: id(6), role: "student" } },
  { material: null },
  { material: { ...original, class_id: id(999) } },
  { material: { ...original, is_active: false } },
])
  test(`read action rejects inaccessible material/identity: ${JSON.stringify(options)}`, async () => {
    const { state, mark } = setup({
      user: { id: id(6), role: "student", classId: id(2) },
      ...options,
    });
    assert.equal((await mark(id(1))).ok, false);
    assert.deepEqual(state.writes, []);
    assert.deepEqual(state.invalidated, []);
  });

test("read action reports failed saves without advancing progress", async () => {
  const { state, mark } = setup({
    user: { id: id(6), role: "student", classId: id(2) },
    writeError: { message: "offline" },
  });
  assert.equal((await mark("invalid-id")).ok, false);
  assert.equal((await mark(id(1))).ok, false);
  assert.equal(state.views.size, 0);
  assert.deepEqual(state.invalidated, []);
});
