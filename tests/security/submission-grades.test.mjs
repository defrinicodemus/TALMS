import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

// Real migrations/RLS/triggers in disposable PostgreSQL. Auth's tables, JWT
// context, and API table grants are scaffolding; no hosted credentials are used.
const db = new PGlite({ extensions: { pgcrypto } });
const quizMigration = "20261016000000_protect_quiz_integrity.sql";
const dataResetMigration = "20261022000000_clear_school_operational_data.sql";
const accountImportMigration = "20261022000001_import_teachers_students.sql";
let beforeQuizMigration, afterQuizMigration;
async function databaseSnapshot() {
  const tables = [
    "profiles",
    "academic_years",
    "classes",
    "assignments",
    "quiz_questions",
    "quiz_options",
    "quiz_pairs",
    "quiz_steps",
    "submissions",
    "quiz_answers",
  ];
  const result = {};
  for (const table of tables)
    result[table] = (await db.query("select * from public." + table + " order by id")).rows;
  result.columns = (
    await db.query(
      "select table_name,column_name,data_type,column_default,is_nullable from information_schema.columns where table_schema='public' order by table_name,ordinal_position",
    )
  ).rows;
  return result;
}
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const users = {
  student: id(1),
  other: id(2),
  admin: id(3),
  teacher: id(4),
  unrelatedTeacher: id(5),
  principal: id(6),
  outsider: id(7),
};
const classroom = id(10);
const otherClassroom = id(11);
const task = id(50);
const gradedTask = id(51);
const quiz = id(52);
const otherQuiz = id(53);
const newTask = id(54);
const question = id(60);
const sequenceQuestion = id(61);
const otherQuestion = id(62);
const correctOption = id(70);
const submission = id(90);
const gradedSubmission = id(91);
const otherSubmission = id(92);
const rpcSql = "select public.save_scored_quiz($1, $2, $3, $4) as id";
const validAnswers = [
  { question_id: question, selected_option_id: correctOption, points_earned: 50 },
  { question_id: sequenceQuestion, sequence_answer: [id(80), id(81)], points_earned: 50 },
];
const rpcParams = (
  answers = validAnswers,
  score = 100,
  student = users.student,
  assignment = quiz,
) => [assignment, student, score, JSON.stringify(answers)];

async function asUser(userId, role = "authenticated") {
  assert.ok(["authenticated", "anon", "service_role"].includes(role));
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role }),
  ]);
}

async function row(submissionId = submission) {
  const { rows } = await db.query("select * from public.submissions where id = $1", [submissionId]);
  assert.equal(rows.length, 1);
  return rows[0];
}

async function rejects(sql, params, code = "42501") {
  await db.exec("savepoint denied_write");
  await assert.rejects(db.query(sql, params), { code });
  await db.exec("rollback to savepoint denied_write; release savepoint denied_write");
}

async function quizRows() {
  return (await db.query("select * from public.submissions where assignment_id = $1", [quiz])).rows;
}

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id int primary key, bucket_id text);
    alter table storage.objects enable row level security;
    create policy test_existing_storage_access on storage.objects for all using (true) with check (true);
    create table auth.users (
      id uuid primary key, email text,
      raw_user_meta_data jsonb not null default '{}',
      raw_app_meta_data jsonb not null default '{}'
    );
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
  `);
  const migrationDir = new URL("../../supabase/migrations/", import.meta.url);
  for (const filename of (await readdir(migrationDir))
    .filter(
      (name) =>
        name.endsWith(".sql") &&
        ![quizMigration, dataResetMigration, accountImportMigration].includes(name),
    )
    .sort()) {
    await db.exec(await readFile(new URL(filename, migrationDir), "utf8"));
  }
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on all tables in schema storage to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    insert into public.schools (id, name) values ('${id(20)}', 'Test school');
    insert into public.academic_years (id, school_id, year_label, semester, is_active)
      values ('${id(30)}', '${id(20)}', '2026/2027', 'ganjil', true);
    insert into public.classes (id, school_id, academic_year_id, name, grade_level) values
      ('${classroom}', '${id(20)}', '${id(30)}', '4A', 4),
      ('${otherClassroom}', '${id(20)}', '${id(30)}', '5A', 5);
    insert into public.subjects (id, school_id, code, name)
      values ('${id(40)}', '${id(20)}', 'MTK', 'Matematika');
  `);
  for (const [name, userId] of Object.entries(users)) {
    const role = ["other", "outsider"].includes(name)
      ? "student"
      : name === "unrelatedTeacher"
        ? "teacher"
        : name;
    await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [
      userId,
      `${name}@example.test`,
      JSON.stringify({
        lms_profile: {
          role,
          full_name: name,
          username: name,
          school_id: id(20),
          class_id: name === "outsider" ? otherClassroom : classroom,
        },
      }),
    ]);
  }
  await db.exec(`
    insert into public.class_teacher_subjects (class_id, subject_id, teacher_id)
      values ('${classroom}', '${id(40)}', '${users.teacher}');
    insert into public.assignments (id, class_id, subject_id, teacher_id, title, kind, is_published) values
      ('${task}', '${classroom}', '${id(40)}', '${users.teacher}', 'Task', 'text', true),
      ('${gradedTask}', '${classroom}', '${id(40)}', '${users.teacher}', 'Graded task', 'text', true),
      ('${quiz}', '${classroom}', '${id(40)}', '${users.teacher}', 'Quiz', 'quiz', false),
      ('${otherQuiz}', '${classroom}', '${id(40)}', '${users.teacher}', 'Other quiz', 'quiz', false),
      ('${newTask}', '${classroom}', '${id(40)}', '${users.teacher}', 'New task', 'text', true);
    insert into public.quiz_questions (id, assignment_id, question_text, question_type, points) values
      ('${question}', '${quiz}', 'MC', 'multiple_choice', 50),
      ('${sequenceQuestion}', '${quiz}', 'Sequence', 'sequence', 50),
      ('${otherQuestion}', '${otherQuiz}', 'Other MC', 'multiple_choice', 100);
    insert into public.quiz_options (id, question_id, option_text, is_correct) values
      ('${correctOption}', '${question}', 'Correct', true),
      ('${id(71)}', '${question}', 'Wrong', false),
      ('${id(72)}', '${otherQuestion}', 'Other answer', true),
      ('${id(73)}', '${otherQuestion}', 'Other wrong answer', false);
    insert into public.quiz_steps (id, question_id, step_text, correct_order) values
      ('${id(80)}', '${sequenceQuestion}', 'First', 1),
      ('${id(81)}', '${sequenceQuestion}', 'Second', 2);
    update public.assignments set due_at = now() + interval '1 day', is_published = true where kind = 'quiz';
    insert into public.submissions (id, assignment_id, student_id, status, content_url) values
      ('${submission}', '${task}', '${users.student}', 'submitted', 'Original answer'),
      ('${otherSubmission}', '${task}', '${users.other}', 'submitted', 'Other answer');
    insert into public.submissions (
      id, assignment_id, student_id, status, content_url, score, teacher_comment, graded_at, graded_by
    ) values (
      '${gradedSubmission}', '${gradedTask}', '${users.student}', 'graded', 'Graded answer',
      75, 'Teacher feedback', now(), '${users.teacher}'
    );
  `);
  beforeQuizMigration = await databaseSnapshot();
  await db.exec(await readFile(new URL(quizMigration, migrationDir), "utf8"));
  afterQuizMigration = await databaseSnapshot();
});

beforeEach(async () => db.exec("begin"));
afterEach(async () => db.exec("rollback"));
after(async () => db.close());

test("old submission RLS alone permits students to assign themselves grades", async () => {
  await db.exec("drop trigger submissions_guard_write on public.submissions");
  await db.exec("drop trigger submissions_guard_task_channel on public.submissions");
  await asUser(users.student);
  await db.query("update public.submissions set score = 100, status = 'graded' where id = $1", [
    submission,
  ]);
  assert.equal((await row()).score, "100.00");
});

test("the trusted task RPC inserts and revises ungraded answers", async () => {
  await asUser(users.student, "service_role");
  for (const assignmentId of [newTask, task]) {
    for (const content of ["First answer", "Revised answer"]) {
      await db.query(
        `select * from public.save_assignment_submission($1, $2, 'text', $3,
          (select updated_at from public.submissions where assignment_id = $1 and student_id = $2))`,
        [assignmentId, users.student, content],
      );
      const { rows } = await db.query(
        "select * from public.submissions where assignment_id = $1 and student_id = $2",
        [assignmentId, users.student],
      );
      assert.equal(rows[0].content_url, content);
      assert.equal(rows[0].status, "submitted");
      assert.equal(rows[0].score, null);
    }
  }
});

for (const [column, value] of [
  ["score", 100],
  ["status", "graded"],
  ["teacher_comment", "Forged feedback"],
  ["graded_at", "2026-09-27T00:00:00Z"],
  ["graded_by", users.teacher],
]) {
  test(`student cannot write ${column} through INSERT, UPDATE, or upsert`, async () => {
    await asUser(users.student);
    const original = await row();
    await rejects(
      `insert into public.submissions (assignment_id, student_id, ${column}) values ($1, $2, $3)`,
      [newTask, users.student, value],
    );
    await rejects(
      `update public.submissions set ${column} = $1, content_url = 'Changed' where id = $2`,
      [value, submission],
    );
    await rejects(
      `insert into public.submissions (assignment_id, student_id, ${column}) values ($1, $2, $3)
      on conflict (assignment_id, student_id) do update set ${column} = excluded.${column}`,
      [task, users.student, value],
    );
    // The INSERT trigger passes a harmless row, then the UPDATE branch must
    // still reject a grade injected only into ON CONFLICT.
    await rejects(
      `insert into public.submissions (assignment_id, student_id) values ($1, $2)
      on conflict (assignment_id, student_id) do update set ${column} = $3`,
      [task, users.student, value],
    );
    assert.deepEqual(await row(), original);
  });
}

test("a student cannot reassign a submission's ID, assignment, or owner", async () => {
  await asUser(users.student);
  for (const [column, value] of [
    ["id", id(999)],
    ["assignment_id", newTask],
    ["student_id", users.other],
  ]) {
    await rejects(`update public.submissions set ${column} = $1 where id = $2`, [
      value,
      submission,
    ]);
  }
});

test("a graded submission cannot be reset, rewritten, upserted, or deleted by its student", async () => {
  await asUser(users.student);
  const original = await row(gradedSubmission);
  for (const change of [
    "status = 'submitted', score = null, graded_at = null, graded_by = null, teacher_comment = null",
    "content_url = 'Replacement answer'",
    "submitted_at = now()",
  ]) {
    await rejects(`update public.submissions set ${change} where id = $1`, [gradedSubmission]);
  }
  await rejects(
    `insert into public.submissions (assignment_id, student_id, content_url)
    values ($1, $2, 'Replacement') on conflict (assignment_id, student_id)
    do update set content_url = excluded.content_url, status = 'submitted'`,
    [gradedTask, users.student],
  );
  assert.equal(
    (await db.query("delete from public.submissions where id = $1", [gradedSubmission]))
      .affectedRows,
    0,
  );
  assert.deepEqual(await row(gradedSubmission), original);
});

test("inconsistent legacy rows with grading data are protected even without graded status", async () => {
  for (const change of ["score = 70", "graded_at = now()", `graded_by = '${users.teacher}'`]) {
    await db.exec("savepoint legacy_row");
    await db.query(`update public.submissions set ${change} where id = $1`, [submission]);
    await asUser(users.student);
    await rejects("update public.submissions set content_url = 'Rewritten' where id = $1", [
      submission,
    ]);
    await db.exec("rollback to savepoint legacy_row; release savepoint legacy_row");
  }
});

test("students cannot create or update another student's work", async () => {
  await asUser(users.student);
  await rejects("insert into public.submissions (assignment_id, student_id) values ($1, $2)", [
    newTask,
    users.other,
  ]);
  assert.equal(
    (
      await db.query("update public.submissions set content_url = 'Forged' where id = $1", [
        otherSubmission,
      ])
    ).affectedRows,
    0,
  );
});

test("the assigned teacher can grade and correct grades but cannot move the submission", async () => {
  await asUser(users.teacher);
  for (const score of [70, 85]) {
    await db.query(
      `update public.submissions set score = $1, status = 'graded',
      teacher_comment = 'Reviewed', graded_at = now(), graded_by = $2 where id = $3`,
      [score, users.teacher, submission],
    );
    assert.equal(Number((await row()).score), score);
  }
  await rejects("update public.submissions set assignment_id = $1 where id = $2", [
    newTask,
    submission,
  ]);
});

for (const [name, userId] of [
  ["unassigned teacher", users.unrelatedTeacher],
  ["principal", users.principal],
  ["anonymous", null],
]) {
  test(`${name} cannot grade submissions`, async () => {
    await asUser(userId, userId ? "authenticated" : "anon");
    assert.equal(
      (await db.query("update public.submissions set score = 100 where id = $1", [submission]))
        .affectedRows,
      0,
    );
  });
}

test("an authenticated admin and the trusted backend retain grading access", async () => {
  for (const [userId, role] of [
    [users.admin, "authenticated"],
    [null, "service_role"],
  ]) {
    await asUser(userId, role);
    await db.query("update public.submissions set score = 90, status = 'graded' where id = $1", [
      submission,
    ]);
    assert.equal(Number((await row()).score), 90);
  }
});

test("removing a grader still clears the foreign key on existing grades", async () => {
  await db.query("delete from auth.users where id = $1", [users.teacher]);
  assert.equal((await row(gradedSubmission)).graded_by, null);
  assert.equal(Number((await row(gradedSubmission)).score), 75);
});

for (const name of ["student", "teacher", "principal", "admin", "anonymous"]) {
  test(`${name} cannot invoke the server-only scoring RPC`, async () => {
    await asUser(users[name] ?? null, name === "anonymous" ? "anon" : "authenticated");
    await rejects(rpcSql, rpcParams());
  });
}

test("the server saves a quiz grade and its answer details together; students and teachers can read it", async () => {
  await asUser(null, "service_role");
  const { rows } = await db.query(rpcSql, rpcParams());
  for (const userId of [users.student, users.teacher]) {
    await asUser(userId);
    const saved = await row(rows[0].id);
    assert.equal(Number(saved.score), 100);
    assert.equal(saved.status, "graded");
    assert.ok(saved.submitted_at && saved.graded_at);
    const answers = (
      await db.query("select * from public.quiz_answers where submission_id = $1", [saved.id])
    ).rows;
    assert.equal(answers.length, 2);
    assert.equal(
      answers.reduce((total, answer) => total + Number(answer.points_earned), 0),
      100,
    );
  }
});

test("a completed quiz cannot be overwritten by a repeat server request", async () => {
  await asUser(null, "service_role");
  const { rows } = await db.query(rpcSql, rpcParams());
  const original = await row(rows[0].id);
  await rejects(rpcSql, rpcParams([], 0), "55000");
  assert.deepEqual(await row(rows[0].id), original);
  assert.equal(
    (await db.query("select * from public.quiz_answers where submission_id = $1", [original.id]))
      .rows.length,
    2,
  );
});

test("an ungraded quiz placeholder can be finished, replacing its stale answer rows", async () => {
  await db.query(
    "insert into public.submissions (id, assignment_id, student_id, status) values ($1, $2, $3, 'dikerjakan')",
    [id(93), quiz, users.student],
  );
  await db.query(
    "insert into public.quiz_answers (submission_id, question_id, points_earned) values ($1, $2, 0)",
    [id(93), question],
  );
  await asUser(null, "service_role");
  const { rows } = await db.query(rpcSql, rpcParams());
  assert.equal(rows[0].id, id(93));
  assert.equal(
    (await db.query("select * from public.quiz_answers where submission_id = $1", [id(93)])).rows
      .length,
    2,
  );
});

test("students cannot forge per-question points or overwrite saved quiz answers", async () => {
  await asUser(null, "service_role");
  const { rows } = await db.query(rpcSql, rpcParams([], 0));
  const savedId = rows[0].id;
  await asUser(users.student);
  await rejects(
    "insert into public.quiz_answers (submission_id, question_id, points_earned) values ($1, $2, 50)",
    [savedId, question],
  );
  await db.exec("reset role");
  await db.query(
    "insert into public.quiz_answers (submission_id, question_id, points_earned) values ($1, $2, 0)",
    [savedId, question],
  );
  await asUser(users.student);
  await rejects(
    `insert into public.quiz_answers (submission_id, question_id, points_earned) values ($1, $2, 50)
    on conflict (submission_id, question_id) do update set points_earned = excluded.points_earned`,
    [savedId, question],
  );
  assert.equal(
    (
      await db.query("update public.quiz_answers set points_earned = 50 where submission_id = $1", [
        savedId,
      ])
    ).affectedRows,
    0,
  );
  assert.equal(
    (await db.query("delete from public.quiz_answers where submission_id = $1", [savedId]))
      .affectedRows,
    0,
  );
});

for (const [label, change] of [
  ["draft", "is_published = false"],
  ["inactive", "is_active = false"],
  ["expired", "due_at = now() - interval '1 minute'"],
  ["non-quiz", "kind = 'text'"],
  ["another class", `class_id = '${otherClassroom}'`],
]) {
  test(`the privileged write rejects a ${label} assignment`, async () => {
    // Simulate legacy state; normal writes are separately tested against the new guard.
    await db.exec("alter table public.assignments disable trigger assignments_guard_quiz");
    await db.query(`update public.assignments set ${change} where id = $1`, [quiz]);
    await db.exec("alter table public.assignments enable trigger assignments_guard_quiz");
    await asUser(null, "service_role");
    await rejects(rpcSql, rpcParams());
    assert.deepEqual(await quizRows(), []);
  });
}

test("the privileged write rejects a non-student or a student from another class", async () => {
  await asUser(null, "service_role");
  for (const userId of [users.teacher, users.outsider, id(999)]) {
    await rejects(rpcSql, rpcParams(validAnswers, 100, userId));
  }
  assert.deepEqual(await quizRows(), []);
});

for (const [label, answers, score] of [
  ["out-of-range total", validAnswers, 101],
  ["missing total", validAnswers, null],
  ["non-array answers", {}, 0],
  ["wrong total", validAnswers, 99],
  ["foreign question", [{ question_id: otherQuestion, points_earned: 100 }], 100],
  [
    "foreign option",
    [{ question_id: question, selected_option_id: id(72), points_earned: 50 }],
    50,
  ],
  ["excess question points", [{ question_id: question, points_earned: 51 }], 51],
  ["negative points", [{ question_id: question, points_earned: -1 }], 0],
  ["duplicate question", [validAnswers[0], validAnswers[0]], 100],
]) {
  test(`the scoring RPC rejects ${label} without leaving a grade`, async () => {
    await asUser(null, "service_role");
    await rejects(rpcSql, rpcParams(answers, score), "22023");
    assert.deepEqual(await quizRows(), []);
  });
}

for (const hasPlaceholder of [false, true]) {
  test(`answer-write failure rolls back the grade ${hasPlaceholder ? "and preserves a draft" : "without leaving a submission"}`, async () => {
    if (hasPlaceholder) {
      await db.query(
        "insert into public.submissions (id, assignment_id, student_id, status) values ($1, $2, $3, 'dikerjakan')",
        [id(93), quiz, users.student],
      );
      await db.query(
        "insert into public.quiz_answers (submission_id, question_id, points_earned) values ($1, $2, 0)",
        [id(93), question],
      );
    }
    // Force a failure after the submission upsert and stale-answer deletion.
    await db.exec(`
      create function public.fail_test_answer_write() returns trigger language plpgsql as $$
      begin raise exception 'simulated answer storage failure'; end; $$;
      create trigger fail_test_answer_write before insert on public.quiz_answers
        for each row execute function public.fail_test_answer_write();
    `);
    const original = await quizRows();
    await asUser(null, "service_role");
    await rejects(rpcSql, rpcParams(), "P0001");
    assert.deepEqual(await quizRows(), original);
    const answers = (await db.query("select * from public.quiz_answers")).rows;
    assert.equal(answers.length, hasPlaceholder ? 1 : 0);
    if (hasPlaceholder) assert.equal(Number(answers[0].points_earned), 0);
  });
}

const taskRpc = `select * from public.save_assignment_submission($1, $2, $3, $4,
  (select updated_at from public.submissions where assignment_id = $1 and student_id = $2))`;
const taskParams = (
  content = "Answer",
  assignment = newTask,
  method = "text",
  student = users.student,
) => [assignment, student, method, content];

test("direct student task insert/update is rejected even without grading fields", async () => {
  await asUser(users.student);
  await rejects(
    "insert into public.submissions (assignment_id, student_id, content_url) values ($1, $2, 'Bypass')",
    [newTask, users.student],
  );
  await rejects("update public.submissions set content_url = 'Bypass' where id = $1", [submission]);
  assert.equal((await row()).content_url, "Original answer");
});

for (const [name, actor] of Object.entries(users)) {
  test(`${name} cannot invoke the trusted task RPC directly`, async () => {
    await asUser(actor);
    await rejects(taskRpc, taskParams());
  });
}

for (const [name, change, params, code] of [
  [
    "expired deadline",
    "update public.assignments set due_at = now() - interval '1 second' where id = $1",
    [newTask],
    "55000",
  ],
  [
    "unpublished task",
    "update public.assignments set is_published = false where id = $1",
    [newTask],
    "42501",
  ],
  [
    "photo-only task with text",
    "update public.assignments set allowed_methods = array['photo'] where id = $1",
    [newTask],
    "22023",
  ],
  [
    "another class",
    "update public.assignments set class_id = $2 where id = $1",
    [newTask, otherClassroom],
    "42501",
  ],
  ["inactive academic period", "update public.academic_years set is_active = false", [], "42501"],
]) {
  test(`task RPC rejects ${name} without saving an answer`, async () => {
    await db.query(change, params);
    await asUser(users.student, "service_role");
    await rejects(taskRpc, taskParams(), code);
    assert.equal(
      (
        await db.query(
          "select count(*)::int as count from public.submissions where assignment_id = $1",
          [newTask],
        )
      ).rows[0].count,
      0,
    );
  });
}

test("task RPC rejects quizzes, graded answers, non-students and stale edits", async () => {
  await asUser(users.student, "service_role");
  await rejects(taskRpc, taskParams("Answer", quiz), "42501");
  await rejects(taskRpc, taskParams("Answer", newTask, "text", users.teacher), "42501");
  await rejects(taskRpc, taskParams("Replace grade", gradedTask), "55000");
  await rejects(
    "select * from public.save_assignment_submission($1, $2, 'text', 'Stale', '2000-01-01')",
    [task, users.student],
    "55000",
  );
  assert.equal((await row()).content_url, "Original answer");
});

test("extending a deadline reopens task submission without clearing existing grades", async () => {
  await db.query("update public.assignments set due_at = now() + interval '1 day' where id = $1", [
    newTask,
  ]);
  await asUser(users.student, "service_role");
  const result = await db.query(taskRpc, taskParams());
  assert.ok(result.rows[0].submitted_at);
  assert.equal((await row(gradedSubmission)).score, "75.00");
});

test("photo submissions require an owned storage path and an allowed method", async () => {
  await db.query(
    "update public.assignments set allowed_methods = array['text', 'photo'] where id = $1",
    [newTask],
  );
  await asUser(users.student, "service_role");
  for (const bad of [
    "https://example.com/image.png",
    `assignment-submissions/${newTask}/${users.other}/${id(99)}.jpg`,
    `assignment-submissions/${task}/${users.student}/${id(99)}.jpg`,
  ])
    await rejects(taskRpc, taskParams(bad, newTask, "photo"), "22023");
  const content = `assignment-submissions/${newTask}/${users.student}/${id(99)}.jpg`;
  await db.query(taskRpc, taskParams(content, newTask, "photo"));
  const saved = (
    await db.query("select content_url from public.submissions where assignment_id = $1", [newTask])
  ).rows[0];
  assert.equal(saved.content_url, content);
  await rejects(taskRpc, taskParams(content, newTask, "text"), "22023");
});

test("a used task cannot be deleted even by an administrator; answers and grades survive", async () => {
  await asUser(users.admin);
  await rejects("delete from public.assignments where id = $1", [task], "55000");
  await rejects("delete from public.assignments where id = $1", [gradedTask], "55000");
  assert.equal((await row()).content_url, "Original answer");
  assert.equal((await row(gradedSubmission)).score, "75.00");
  await db.query("delete from public.assignments where id = $1", [newTask]);
  assert.equal(
    (await db.query("select id from public.assignments where id = $1", [newTask])).rows.length,
    0,
  );
});

test("an answer changed after opening cannot receive a stale conditional grade", async () => {
  const previous = (
    await db.query("select updated_at::text as version from public.submissions where id = $1", [
      submission,
    ])
  ).rows[0].version;
  await asUser(users.student, "service_role");
  await db.query(taskRpc, taskParams("New answer", task));
  await asUser(users.teacher);
  const result = await db.query(
    "update public.submissions set score = 80, status = 'graded' where id = $1 and updated_at = $2 returning id",
    [submission, previous],
  );
  assert.equal(result.rows.length, 0);
  assert.equal((await row()).score, null);
});

test("student photos use a private size-limited bucket and deny direct client storage access", async () => {
  const bucket = (
    await db.query("select * from storage.buckets where id = 'assignment-submissions'")
  ).rows[0];
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 2 * 1024 * 1024);
  assert.deepEqual(bucket.allowed_mime_types, ["image/jpeg", "image/png", "image/webp"]);
  await db.exec(
    "insert into storage.objects (id, bucket_id) values (1, 'assignment-submissions'), (2, 'learning-materials')",
  );
  await asUser(users.student);
  assert.deepEqual(
    (await db.query("select id from storage.objects order by id")).rows.map((r) => r.id),
    [2],
  );
  await rejects(
    "insert into storage.objects (id, bucket_id) values (3, 'assignment-submissions')",
    [],
  );
});

test("a used task cannot be relabeled to bypass its deletion protection", async () => {
  await asUser(users.teacher);
  await rejects("update public.assignments set kind = 'quiz' where id = $1", [task], "55000");
  assert.equal((await row()).content_url, "Original answer");
});

test("a task with student work cannot be hidden; an unused task can be toggled with a future deadline", async () => {
  await asUser(users.teacher);
  await rejects(
    "update public.assignments set is_published = false where id = $1",
    [task],
    "55000",
  );
  await db.query(
    "update public.assignments set due_at = now() + interval '1 day', is_published = false where id = $1",
    [newTask],
  );
  await db.query("update public.assignments set is_published = true where id = $1", [newTask]);
  await db.query(
    "update public.assignments set due_at = now() - interval '1 minute', is_published = false where id = $1",
    [newTask],
  );
  await rejects(
    "update public.assignments set is_published = true where id = $1",
    [newTask],
    "22023",
  );
});

// Quiz integrity regression tests use the same disposable database and real migrations.
for (const table of ["quiz_questions", "quiz_options", "quiz_pairs", "quiz_steps"]) {
  test("student cannot select answer-bank rows from " + table, async () => {
    await asUser(users.student);
    assert.equal((await db.query("select * from public." + table)).rows.length, 0);
  });
}

test("published question and option writes cannot erase saved student answers", async () => {
  await asUser(null, "service_role");
  const saved = (await db.query(rpcSql, rpcParams())).rows[0].id;
  await asUser(users.teacher);
  for (const sql of [
    "delete from public.quiz_questions where id = $1",
    "update public.quiz_questions set question_text = 'Typo' where id = $1",
    "update public.quiz_questions set is_active = false where id = $1",
  ])
    await rejects(sql, [question], "55000");
  await rejects("delete from public.quiz_options where id = $1", [correctOption], "55000");
  await rejects(
    "update public.quiz_options set is_correct = false where id = $1",
    [correctOption],
    "55000",
  );
  const answers = (
    await db.query("select * from public.quiz_answers where submission_id = $1", [saved])
  ).rows;
  assert.equal(answers.length, 2);
  assert.equal(answers.find((a) => a.question_id === question).selected_option_id, correctOption);
  assert.equal(Number((await row(saved)).score), 100);
});

test("publication cannot be reversed or bypassed by relabeling/reassigning a quiz", async () => {
  await asUser(users.teacher);
  for (const change of [
    "is_published = false",
    "kind = 'text'",
    "passing_grade = 20",
    "timer_minutes = 90",
    "learning_objective_id = null, quiz_type = 'uas'",
    "class_id = '" + otherClassroom + "'",
  ])
    await rejects("update public.assignments set " + change + " where id = $1", [quiz], "55000");
  await db.query(
    "update public.assignments set title='Updated', description='Instructions', due_at=now()+interval '2 days', is_active=false where id=$1",
    [quiz],
  );
  await rejects("delete from public.quiz_questions where id=$1", [question], "55000");
  await db.query("update public.assignments set is_active=true where id=$1", [quiz]);
});

test("used quiz deletion is blocked for teacher and admin without losing answers", async () => {
  await asUser(null, "service_role");
  const saved = (await db.query(rpcSql, rpcParams())).rows[0].id;
  for (const person of [users.teacher, users.admin]) {
    await asUser(person);
    await rejects("delete from public.assignments where id=$1", [quiz], "55000");
    assert.equal((await row(saved)).status, "graded");
  }
});

test("a quiz with a saved grade cannot be deactivated", async () => {
  await asUser(null, "service_role");
  const saved = (await db.query(rpcSql, rpcParams())).rows[0].id;
  await asUser(users.teacher);
  await rejects("update public.assignments set is_active=false where id=$1", [quiz], "55000");
  assert.equal((await row(saved)).status, "graded");
  assert.equal(
    (await db.query("select is_active from public.assignments where id=$1", [quiz])).rows[0]
      .is_active,
    true,
  );
});

async function draftQuiz() {
  const draft = id(500);
  await db.query(
    "insert into public.assignments(id,class_id,subject_id,teacher_id,title,kind,is_published,due_at) values ($1,$2,$3,$4,'Draft','quiz',false,now()+interval '1 day')",
    [draft, classroom, id(40), users.teacher],
  );
  return draft;
}
const questionPayload = {
  questionText: "Question",
  questionType: "multiple_choice",
  points: 100,
  explanation: "Because",
  correctAnswerText: null,
  options: [
    { text: "A", isCorrect: true },
    { text: "B", isCorrect: false },
  ],
  pairs: [],
  steps: [],
};
const saveQuestionSql = "select public.save_quiz_question($1,$2,$3) as id";

test("draft saves atomically, changes question type, and publishes with complete keys", async () => {
  const draft = await draftQuiz();
  await asUser(users.teacher);
  const q = (await db.query(saveQuestionSql, [draft, null, JSON.stringify(questionPayload)]))
    .rows[0].id;
  const before = (
    await db.query("select id from public.quiz_options where question_id=$1 order by id", [q])
  ).rows;
  await rejects(
    saveQuestionSql,
    [
      draft,
      q,
      JSON.stringify({ ...questionPayload, options: [{ text: "Only", isCorrect: true }] }),
    ],
    "22023",
  );
  assert.deepEqual(
    (await db.query("select id from public.quiz_options where question_id=$1 order by id", [q]))
      .rows,
    before,
  );
  await db.query(saveQuestionSql, [
    draft,
    q,
    JSON.stringify({ ...questionPayload, questionType: "sequence", steps: ["First", "Second"] }),
  ]);
  assert.equal(
    (await db.query("select question_type from public.quiz_questions where id=$1", [q])).rows[0]
      .question_type,
    "sequence",
  );
  assert.equal(
    (await db.query("select id from public.quiz_options where question_id=$1", [q])).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select id from public.quiz_steps where question_id=$1", [q])).rows.length,
    2,
  );
  await db.query("update public.assignments set is_published=true where id=$1", [draft]);
  await rejects(saveQuestionSql, [draft, q, JSON.stringify(questionPayload)], "55000");
});

test("incomplete question creation rolls back all rows", async () => {
  const draft = await draftQuiz();
  await asUser(users.teacher);
  await rejects(
    saveQuestionSql,
    [draft, null, JSON.stringify({ ...questionPayload, options: [] })],
    "22023",
  );
  assert.equal(
    (await db.query("select id from public.quiz_questions where assignment_id=$1", [draft])).rows
      .length,
    0,
  );
  await rejects("update public.assignments set is_published=true where id=$1", [draft], "22023");
});

test("draft question can be edited, disabled, enabled and deleted without publication", async () => {
  const draft = await draftQuiz();
  await asUser(users.teacher);
  const q = (await db.query(saveQuestionSql, [draft, null, JSON.stringify(questionPayload)]))
    .rows[0].id;
  await db.query("update public.quiz_questions set is_active=false where id=$1", [q]);
  const second = (await db.query(saveQuestionSql, [draft, null, JSON.stringify(questionPayload)]))
    .rows[0].id;
  await rejects("update public.quiz_questions set is_active=true where id=$1", [q], "22023");
  await db.query("delete from public.quiz_questions where id=$1", [second]);
  await db.query("update public.quiz_questions set is_active=true where id=$1", [q]);
  await db.query("delete from public.assignments where id=$1", [draft]);
  assert.equal(
    (await db.query("select id from public.quiz_questions where id=$1", [q])).rows.length,
    0,
  );
});

test("question RPC denies unrelated teachers and students", async () => {
  const draft = await draftQuiz();
  for (const person of [users.student, users.unrelatedTeacher, users.principal, users.admin]) {
    await asUser(person);
    await rejects(saveQuestionSql, [draft, null, JSON.stringify(questionPayload)], "42501");
  }
});

test("publication and reactivation reject expired deadlines", async () => {
  const draft = await draftQuiz();
  await asUser(users.teacher);
  await db.query(saveQuestionSql, [draft, null, JSON.stringify(questionPayload)]);
  await db.query("update public.assignments set due_at=now()-interval '1 minute' where id=$1", [
    draft,
  ]);
  await rejects("update public.assignments set is_published=true where id=$1", [draft], "22023");
  await db.query(
    "update public.assignments set is_active=false, due_at=now()-interval '1 minute' where id=$1",
    [quiz],
  );
  await rejects("update public.assignments set is_active=true where id=$1", [quiz], "22023");
});

test("privileged quiz grading rejects a closed academic period", async () => {
  await db.query("update public.academic_years set is_active=false where id=$1", [id(30)]);
  await asUser(null, "service_role");
  await rejects(rpcSql, rpcParams(), "42501");
  assert.equal((await quizRows()).length, 0);
});

test("quiz migration preserves existing rows and all application table columns", () => {
  assert.deepEqual(afterQuizMigration, beforeQuizMigration);
});

test("100 points alone cannot publish a question without its key", async () => {
  const draft = await draftQuiz();
  await asUser(users.teacher);
  await db.query(
    "insert into public.quiz_questions (assignment_id,question_text,question_type,points) values ($1,'Incomplete','true_false',100)",
    [draft],
  );
  await rejects("update public.assignments set is_published=true where id=$1", [draft], "22023");
});
test("atomic question RPC supports matching and true/false with correct persisted keys", async () => {
  const draft = await draftQuiz();
  await asUser(users.teacher);
  const q = (
    await db.query(saveQuestionSql, [
      draft,
      null,
      JSON.stringify({
        ...questionPayload,
        questionType: "drag_and_drop",
        pairs: [
          { dragText: "A", targetText: "1" },
          { dragText: "B", targetText: "2" },
        ],
      }),
    ])
  ).rows[0].id;
  assert.equal(
    (await db.query("select * from public.quiz_pairs where question_id=$1", [q])).rows.length,
    2,
  );
  await db.query(saveQuestionSql, [
    draft,
    q,
    JSON.stringify({ ...questionPayload, questionType: "true_false", correctAnswerText: "salah" }),
  ]);
  assert.equal(
    (await db.query("select * from public.quiz_pairs where question_id=$1", [q])).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select correct_answer_text from public.quiz_questions where id=$1", [q]))
      .rows[0].correct_answer_text,
    "salah",
  );
  await db.query("update public.assignments set is_published=true where id=$1", [draft]);
});

async function setupGradebookScenario({ dueAt = "past", pending = false } = {}) {
  const planId = id(120);
  const objectiveId = id(121);
  const assignmentId = id(122);
  await db.query(
    "update public.assignments set is_active=false where class_id=$1 and subject_id=$2",
    [classroom, id(40)],
  );
  await db.query(
    "insert into public.curriculum_plans (id,class_id,subject_id,teacher_id,cp_text) values ($1,$2,$3,$4,'Plan')",
    [planId, classroom, id(40), users.teacher],
  );
  await db.query(
    "insert into public.learning_objectives (id,curriculum_plan_id,title,sort_order) values ($1,$2,'TP 1',1)",
    [objectiveId, planId],
  );
  await db.query(
    `insert into public.assignments
      (id,class_id,subject_id,teacher_id,title,kind,is_published,is_active,due_at,learning_objective_id)
     values ($1,$2,$3,$4,'Final task','text',true,true,
       now() + case when $5='future' then interval '1 day' else interval '-1 day' end,$6)`,
    [assignmentId, classroom, id(40), users.teacher, dueAt, objectiveId],
  );
  await db.query(
    `insert into public.submissions
      (assignment_id,student_id,status,content_url,score,graded_at,graded_by)
     values ($1,$2,'graded','Answer',80,now(),$3)`,
    [assignmentId, users.student, users.teacher],
  );
  if (pending) {
    await db.query(
      `insert into public.submissions (assignment_id,student_id,status,content_url,submitted_at)
       values ($1,$2,'submitted','Pending',now())`,
      [assignmentId, users.other],
    );
  }
  return { assignmentId, objectiveId };
}

test("gradebook readiness blocks open work and pending grading", async () => {
  const open = await setupGradebookScenario({ dueAt: "future" });
  await asUser(users.teacher);
  let readiness = (
    await db.query("select public.gradebook_readiness($1,$2) as value", [classroom, id(40)])
  ).rows[0].value;
  assert.equal(readiness.can_lock, false);
  assert.equal(readiness.open_activities[0].assignment_id, open.assignmentId);

  await asUser(null, "service_role");
  await db.query("update public.assignments set due_at=now()-interval '1 day' where id=$1", [
    open.assignmentId,
  ]);
  await db.query(
    `insert into public.submissions (assignment_id,student_id,status,content_url,submitted_at)
     values ($1,$2,'submitted','Pending',now())`,
    [open.assignmentId, users.other],
  );
  await asUser(users.teacher);
  readiness = (
    await db.query("select public.gradebook_readiness($1,$2) as value", [classroom, id(40)])
  ).rows[0].value;
  assert.equal(readiness.can_lock, false);
  assert.equal(readiness.ungraded_activities[0].submission_count, 1);
  await rejects("select public.lock_gradebook($1,$2)", [classroom, id(40)], "55000");
});

test("atomic gradebook lock counts missed closed work as zero and unlock preserves source grades", async () => {
  const scenario = await setupGradebookScenario();
  await asUser(users.teacher);
  const readiness = (
    await db.query("select public.gradebook_readiness($1,$2) as value", [classroom, id(40)])
  ).rows[0].value;
  assert.equal(readiness.can_lock, true);
  assert.deepEqual(readiness.missing_activities[0].student_names, ["other"]);

  await db.query("select public.lock_gradebook($1,$2)", [classroom, id(40)]);
  const grades = (
    await db.query(
      "select student_id,score from public.grades where class_id=$1 and subject_id=$2 order by student_id",
      [classroom, id(40)],
    )
  ).rows;
  assert.deepEqual(
    grades.map((grade) => [grade.student_id, Number(grade.score)]),
    [
      [users.student, 80],
      [users.other, 0],
    ],
  );
  assert.equal(
    (
      await db.query(
        "select period_month=((clock_timestamp() at time zone 'Asia/Makassar')::date) as wita from public.gradebook_locks where class_id=$1 and subject_id=$2",
        [classroom, id(40)],
      )
    ).rows[0].wita,
    true,
  );

  await rejects(
    "update public.submissions set score=90 where assignment_id=$1 and student_id=$2",
    [scenario.assignmentId, users.student],
    "55000",
  );
  await rejects(
    "update public.assignments set title='Changed' where id=$1",
    [scenario.assignmentId],
    "55000",
  );

  await db.query("select public.unlock_gradebook($1,$2)", [classroom, id(40)]);
  assert.equal(
    (
      await db.query("select id from public.gradebook_locks where class_id=$1 and subject_id=$2", [
        classroom,
        id(40),
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query("select id from public.grades where class_id=$1 and subject_id=$2", [
        classroom,
        id(40),
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select score from public.submissions where assignment_id=$1 and student_id=$2",
          [scenario.assignmentId, users.student],
        )
      ).rows[0].score,
    ),
    80,
  );
});

test("gradebook lock rolls back grade rows if creating the lock fails", async () => {
  await setupGradebookScenario();
  await db.exec(`
    create function public.test_reject_gradebook_lock() returns trigger language plpgsql as $$
    begin raise exception using errcode='55000', message='simulated lock failure'; end $$;
    create trigger test_reject_gradebook_lock before insert on public.gradebook_locks
      for each row execute function public.test_reject_gradebook_lock();
  `);
  await asUser(users.teacher);
  await rejects("select public.lock_gradebook($1,$2)", [classroom, id(40)], "55000");
  assert.equal(
    (
      await db.query("select id from public.grades where class_id=$1 and subject_id=$2", [
        classroom,
        id(40),
      ])
    ).rows.length,
    0,
  );
});

test("same-class teacher cannot inspect or finalize another subject's gradebook", async () => {
  await setupGradebookScenario();
  const otherSubject = id(123);
  await db.query(
    "insert into public.subjects (id,school_id,code,name) values ($1,$2,'IPA','Science')",
    [otherSubject, id(20)],
  );
  await db.query(
    "insert into public.class_teacher_subjects (class_id,subject_id,teacher_id) values ($1,$2,$3)",
    [classroom, otherSubject, users.unrelatedTeacher],
  );
  await asUser(users.unrelatedTeacher);
  await rejects("select public.gradebook_readiness($1,$2)", [classroom, id(40)], "42501");
  await rejects("select public.lock_gradebook($1,$2)", [classroom, id(40)], "42501");
  assert.equal(
    (await db.query("select id from public.quiz_questions where assignment_id=$1", [quiz])).rows
      .length,
    0,
  );
  assert.equal(
    (await db.query("select id from public.submissions where assignment_id=$1", [task])).rows
      .length,
    0,
  );
});

test("operational data reset only deletes data and preserves school, admins, and Storage", async () => {
  const migrationUrl = new URL(`../../supabase/migrations/${dataResetMigration}`, import.meta.url);
  const resetSql = await readFile(migrationUrl, "utf8");
  const statements = resetSql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  assert.ok(
    statements.every((statement) => /^(begin|commit|delete\s+from\s+)/i.test(statement)),
    "reset migration must contain only DELETE statements and transaction boundaries",
  );

  await db.query(
    "insert into storage.objects (id, bucket_id) values ($1, 'assignment-submissions')",
    [999],
  );

  const resetBody = resetSql.replace(/\bbegin\s*;/i, "").replace(/\bcommit\s*;\s*$/i, "");
  await db.exec(resetBody);

  for (const table of [
    "gradebook_locks",
    "grades",
    "quiz_answers",
    "submissions",
    "attendance_records",
    "material_views",
    "class_meetings",
    "materials",
    "assignments",
    "quiz_questions",
    "quiz_options",
    "quiz_pairs",
    "quiz_steps",
    "learning_objectives",
    "curriculum_plans",
    "class_teacher_subjects",
    "announcements",
    "classes",
    "academic_years",
    "subjects",
  ]) {
    assert.equal(
      (await db.query(`select count(*)::integer as total from public.${table}`)).rows[0].total,
      0,
    );
  }

  assert.deepEqual((await db.query("select id from public.profiles order by id")).rows, [
    { id: users.admin },
  ]);
  assert.deepEqual((await db.query("select id from auth.users order by id")).rows, [
    { id: users.admin },
  ]);
  assert.equal(
    (await db.query("select count(*)::integer as total from public.schools")).rows[0].total,
    1,
  );
  assert.equal(
    (await db.query("select count(*)::integer as total from storage.objects")).rows[0].total,
    1,
  );
});
