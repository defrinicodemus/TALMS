import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const project = fileURLToPath(new URL("../../", import.meta.url));
const id = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const version = "2026-01-01T00:00:00+00:00";
const photo = () =>
  new File([new Uint8Array([255, 216, 255, 224, 1])], "jawaban.jpg", { type: "image/jpeg" });
function form(values = {}) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}
function setup(options = {}) {
  const state = {
    user: { id: id(5), role: "student", classId: id(2) },
    task: {
      id: id(1),
      class_id: id(2),
      subject_id: id(3),
      kind: "essay",
      is_published: true,
      allowed_methods: ["text", "photo"],
      due_at: "2099-01-01T00:00:00Z",
      learning_objective_id: id(4),
      attachment_image_url: "https://storage.example/old.jpg",
    },
    submission: null,
    teaching: true,
    objective: true,
    lock: null,
    writeError: null,
    readError: null,
    uploadError: null,
    rpcError: null,
    emptyUpdate: false,
    ...options,
    uploads: [],
    removed: [],
    writes: [],
    rpcCalls: [],
    invalidated: [],
  };
  const client = {
    from(table) {
      let mode = "select",
        payload;
      const equal = {},
        notEqual = {};
      const query = {
        select() {
          return this;
        },
        eq(key, value) {
          equal[key] = value;
          return this;
        },
        neq(key, value) {
          notEqual[key] = value;
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
        delete() {
          mode = "delete";
          return this;
        },
        maybeSingle() {
          return execute();
        },
        single() {
          return execute();
        },
        then(resolve, reject) {
          return execute().then(resolve, reject);
        },
      };
      function matches(row) {
        return (
          row &&
          Object.entries(equal).every(([k, v]) => k.includes(".") || row[k] === v) &&
          Object.entries(notEqual).every(([k, v]) => k.includes(".") || row[k] !== v)
        );
      }
      async function execute() {
        if (mode !== "select") {
          state.writes.push({ table, mode, payload, equal, notEqual });
          if (state.writeError) return { data: null, error: state.writeError };
          if (state.emptyUpdate) return { data: null, error: null };
          if (table === "assignments") {
            if (mode === "insert") {
              state.task = { ...payload };
              return { data: { id: payload.id }, error: null };
            }
            if (!matches(state.task)) return { data: null, error: null };
            if (mode === "delete") {
              state.task = null;
              return { data: { id: id(1) }, error: null };
            }
            Object.assign(state.task, payload);
          }
          if (table === "submissions") {
            if (!matches(state.submission)) return { data: null, error: null };
            Object.assign(state.submission, payload);
          }
          return { data: { id: id(1) }, error: null };
        }
        if (state.readError) return { data: null, error: { message: "Read failed" }, count: null };
        if (table === "assignments")
          return { data: matches(state.task) ? { ...state.task } : null, error: null };
        if (table === "submissions")
          return {
            data: matches(state.submission)
              ? { ...state.submission, assignments: state.task }
              : null,
            error: null,
            count: state.submission ? 1 : 0,
          };
        if (table === "gradebook_locks") return { data: state.lock, error: null };
        if (table === "class_teacher_subjects") {
          assert.equal(equal.teacher_id, state.user.id);
          assert.equal(equal.class_id, id(2));
          assert.equal(equal.subject_id, id(3));
          return { data: state.teaching ? { id: id(8) } : null, error: null };
        }
        if (table === "learning_objectives") {
          assert.equal(equal["curriculum_plans.class_id"], id(2));
          assert.equal(equal["curriculum_plans.subject_id"], id(3));
          return { data: state.objective ? { id: id(4) } : null, error: null };
        }
        throw new Error(`Unexpected table ${table}`);
      }
      return query;
    },
  };
  const admin = {
    async rpc(name, params) {
      assert.equal(name, "save_assignment_submission");
      state.rpcCalls.push(params);
      if (state.rpcError) return { error: state.rpcError, data: null };
      state.submission = {
        id: id(6),
        assignment_id: params.p_assignment_id,
        student_id: params.p_student_id,
        status: "submitted",
        content_url: params.p_content,
        submitted_at: version,
        updated_at: version,
        score: null,
      };
      return { data: [{ submitted_at: version, updated_at: version }], error: null };
    },
    storage: {
      from(bucket) {
        return {
          async upload(uploadPath, file, opts) {
            state.uploads.push({
              bucket,
              path: uploadPath,
              file,
              opts,
              priorWrites: state.writes.length,
            });
            return { error: state.uploadError };
          },
          getPublicUrl: (uploadPath) => ({
            data: { publicUrl: `https://storage.example/${uploadPath}` },
          }),
          async remove(paths) {
            state.removed.push(...paths);
            return { error: null };
          },
          async createSignedUrl(uploadPath) {
            return {
              data: { signedUrl: `https://storage.example/signed/${uploadPath}` },
              error: null,
            };
          },
        };
      },
    },
  };
  const mocks = {
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/data/profile": { getCurrentUser: async () => state.user },
    "@/lib/data/subjects": {},
    "@/lib/quizServer": {},
    "@/lib/data/review": {},
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
    new Function("require", "exports", code)(
      (name) =>
        mocks[name] ?? (name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : require(name)),
      exports,
    );
    cache.set(filename, exports);
    return exports;
  }
  return {
    state,
    student: load("src/app/(app)/subjects/actions.ts"),
    teacher: load("src/app/(app)/classroom/actions.ts"),
    review: load("src/app/(app)/assessments/actions.ts"),
    helpers: load("src/lib/assignmentConstants.ts"),
  };
}
const existing = {
  id: id(6),
  assignment_id: id(1),
  student_id: id(5),
  status: "submitted",
  updated_at: version,
  score: null,
  content_url: "Old answer",
};
const teacherUser = { id: id(7), role: "teacher" };
const taskForm = (extra = {}) => {
  const data = form({
    id: id(1),
    title: "Pecahan",
    class_id: id(2),
    subject_id: id(3),
    learning_objective_id: id(4),
    due_date: "2099-03-04",
    due_time: "23:59",
    ...extra,
  });
  data.append("allowed_methods", "text");
  return data;
};

test("school deadline conversion is WITA, validates calendar dates and preserves minute precision", () => {
  const { helpers } = setup();
  assert.equal(helpers.parseAssignmentDeadline("2026-10-15", "23:59"), "2026-10-15T15:59:00.000Z");
  assert.equal(helpers.parseAssignmentDeadline("2026-02-30", "12:00"), null);
  assert.equal(helpers.parseAssignmentDeadline("2026-10-15", "24:00"), null);
  assert.deepEqual(helpers.assignmentTimeInputs("2026-10-15T15:59:00Z"), {
    date: "2026-10-15",
    time: "23:59",
  });
  assert.match(helpers.formatAssignmentTime("2026-10-15T15:59:00Z"), /23[.:]59 WITA/);
});

test("student text uses authenticated identity and returns saved submission evidence", async () => {
  const { student, state } = setup();
  const result = await student.submitAssignment(
    id(1),
    form({ method: "text", content: " My answer ", student_id: id(99) }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.submission.content, "My answer");
  assert.equal(result.submission.updatedAt, version);
  assert.equal(state.rpcCalls[0].p_student_id, id(5));
  assert.equal(state.writes.length, 0);
});

for (const [name, options] of [
  ["anonymous", { user: null }],
  ["teacher", { user: teacherUser }],
  ["missing active class", { user: { id: id(5), role: "student" } }],
  ["unreadable previous answer", { readError: true }],
  ["graded", { submission: { ...existing, status: "graded" } }],
  ["partially graded", { submission: { ...existing, score: 80 } }],
  ["stale answer", { submission: existing }],
])
  test(`submission rejects ${name} before upload and RPC`, async () => {
    const { student, state } = setup(options);
    assert.equal(
      (await student.submitAssignment(id(1), form({ method: "photo", photo: photo() }))).ok,
      false,
    );
    assert.equal(state.uploads.length, 0);
    assert.equal(state.rpcCalls.length, 0);
  });

for (const change of [
  { due_at: "2000-01-01" },
  { is_published: false },
  { class_id: id(99) },
  { kind: "quiz" },
  { allowed_methods: ["text"] },
]) {
  test(`submission checks task eligibility before photo upload: ${JSON.stringify(change)}`, async () => {
    const { student, state } = setup();
    Object.assign(state.task, change);
    assert.equal(
      (await student.submitAssignment(id(1), form({ method: "photo", photo: photo() }))).ok,
      false,
    );
    assert.equal(state.uploads.length, 0);
    assert.equal(state.rpcCalls.length, 0);
  });
}

for (const [name, file] of [
  ["empty", new File([], "empty.jpg", { type: "image/jpeg" })],
  ["oversized", new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" })],
  ["wrong MIME", new File(["pdf"], "document.pdf", { type: "application/pdf" })],
  ["forged MIME", new File(["<script>alert(1)</script>"], "fake.jpg", { type: "image/jpeg" })],
])
  test(`student and teacher reject ${name} photos without uploading`, async () => {
    const { student, teacher, state } = setup();
    assert.equal(
      (await student.submitAssignment(id(1), form({ method: "photo", photo: file }))).ok,
      false,
    );
    state.user = teacherUser;
    assert.equal((await teacher.createAssignment(taskForm({ attachment_image: file }))).ok, false);
    assert.equal(state.uploads.length, 0);
    assert.equal(state.writes.length, 0);
  });

test("photo is private and resubmission preserves the original until the RPC saves", async () => {
  const { student, state } = setup({ submission: { ...existing } });
  const result = await student.submitAssignment(
    id(1),
    form({ method: "photo", photo: photo(), expected_updated_at: version }),
  );
  assert.equal(result.ok, true);
  assert.equal(state.uploads[0].bucket, "assignment-submissions");
  assert.match(result.submission.content, /^assignment-submissions\//);
  assert.match(result.submission.photoUrl, /^https:\/\/storage.example\/signed\//);
  assert.equal(state.rpcCalls[0].p_expected_updated_at, version);
  assert.equal(state.removed.length, 0);
});

for (const [code, cleaned] of [
  ["55000", true],
  ["FETCH_ERROR", false],
]) {
  test(`RPC failure ${code} keeps old answer and handles upload cleanup safely`, async () => {
    const { student, state } = setup({
      submission: { ...existing },
      rpcError: { code, message: "Failed" },
    });
    assert.equal(
      (
        await student.submitAssignment(
          id(1),
          form({ method: "photo", photo: photo(), expected_updated_at: version }),
        )
      ).ok,
      false,
    );
    assert.equal(state.submission.content_url, "Old answer");
    assert.equal(state.removed.length, cleaned ? 1 : 0);
  });
}

test("teacher creates a task only after the attachment succeeds, with WITA deadline", async () => {
  const { teacher, state } = setup({ user: teacherUser });
  assert.equal((await teacher.createAssignment(taskForm({ attachment_image: photo() }))).ok, true);
  assert.equal(state.uploads[0].priorWrites, 0);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].payload.due_at, "2099-03-04T15:59:00.000Z");
  assert.match(state.writes[0].payload.attachment_image_url, /^https:\/\/storage.example\//);
});

test("failed teacher attachment upload leaves no task; failed replacement keeps old attachment", async () => {
  const { teacher, state } = setup({ user: teacherUser, uploadError: { message: "Offline" } });
  assert.equal((await teacher.createAssignment(taskForm({ attachment_image: photo() }))).ok, false);
  assert.equal(state.writes.length, 0);
  assert.equal((await teacher.updateAssignment(taskForm({ attachment_image: photo() }))).ok, false);
  assert.equal(state.task.attachment_image_url, "https://storage.example/old.jpg");
  assert.equal(state.writes.length, 0);
});

test("teacher extends deadline without changing the task or its existing attachment", async () => {
  const { teacher, state } = setup({ user: teacherUser });
  assert.equal((await teacher.updateAssignment(taskForm())).ok, true);
  assert.equal(state.task.id, id(1));
  assert.equal(state.task.attachment_image_url, "https://storage.example/old.jpg");
  assert.equal(state.task.due_at, "2099-03-04T15:59:00.000Z");
});

test("teacher cannot deactivate a task after a student submits and must extend an expired task", async () => {
  const used = setup({ user: teacherUser, submission: { ...existing } });
  const usedResult = await used.teacher.setAssignmentActive(id(1), false);
  assert.equal(usedResult.ok, false);
  assert.match(usedResult.message, /sudah memiliki pengumpulan/i);
  assert.equal(used.state.writes.length, 0);

  const expired = setup({ user: teacherUser });
  expired.state.task.is_published = false;
  expired.state.task.due_at = "2000-01-01T00:00:00Z";
  const expiredResult = await expired.teacher.setAssignmentActive(id(1), true);
  assert.equal(expiredResult.ok, false);
  assert.match(expiredResult.message, /perpanjang tenggat/i);
  assert.equal(expired.state.writes.length, 0);
});

test("teacher cannot deactivate a quiz after a student answer exists", async () => {
  const { teacher, state } = setup({ user: teacherUser, submission: { ...existing } });
  Object.assign(state.task, {
    kind: "quiz",
    teacher_id: teacherUser.id,
    is_active: true,
  });
  const result = await teacher.setQuizActive(id(1), false);
  assert.equal(result.ok, false);
  assert.match(result.message, /sudah memiliki jawaban/i);
  assert.equal(state.writes.length, 0);
});

test("grade writes compare the exact opened answer version and reject concurrent changes", async () => {
  const { review, state } = setup({
    user: teacherUser,
    submission: { ...existing },
    emptyUpdate: true,
  });
  const result = await review.gradeSubmission(
    form({ submission_id: id(6), expected_updated_at: version, score: "80" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(state.writes[0].equal.updated_at, version);
  assert.equal(state.submission.score, null);
});

test("teacher cannot grade a stale answer or a locked gradebook", async () => {
  const { review, state } = setup({ user: teacherUser, submission: { ...existing } });
  assert.equal(
    (
      await review.gradeSubmission(
        form({ submission_id: id(6), expected_updated_at: "2000-01-01T00:00:00Z", score: "80" }),
      )
    ).conflict,
    true,
  );
  state.lock = { id: id(10) };
  assert.equal(
    (
      await review.gradeSubmission(
        form({ submission_id: id(6), expected_updated_at: version, score: "80" }),
      )
    ).ok,
    false,
  );
  assert.equal(state.writes.length, 0);
});
