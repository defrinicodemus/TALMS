import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

// Real migrations/RLS/triggers in disposable PostgreSQL. Auth's tables, JWT
// context, and API table grants are scaffolding; no hosted credentials are used.
const db = new PGlite({ extensions: { pgcrypto } });
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
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(await readFile(new URL(filename, migrationDir), "utf8"));
  }
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
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
    insert into public.assignments (id, class_id, subject_id, teacher_id, title, kind) values
      ('${task}', '${classroom}', '${id(40)}', '${users.teacher}', 'Task', 'text'),
      ('${gradedTask}', '${classroom}', '${id(40)}', '${users.teacher}', 'Graded task', 'text'),
      ('${quiz}', '${classroom}', '${id(40)}', '${users.teacher}', 'Quiz', 'quiz'),
      ('${otherQuiz}', '${classroom}', '${id(40)}', '${users.teacher}', 'Other quiz', 'quiz'),
      ('${newTask}', '${classroom}', '${id(40)}', '${users.teacher}', 'New task', 'text');
    insert into public.quiz_questions (id, assignment_id, question_text, question_type, points) values
      ('${question}', '${quiz}', 'MC', 'multiple_choice', 50),
      ('${sequenceQuestion}', '${quiz}', 'Sequence', 'sequence', 50),
      ('${otherQuestion}', '${otherQuiz}', 'Other MC', 'multiple_choice', 100);
    insert into public.quiz_options (id, question_id, option_text, is_correct) values
      ('${correctOption}', '${question}', 'Correct', true),
      ('${id(71)}', '${question}', 'Wrong', false),
      ('${id(72)}', '${otherQuestion}', 'Other answer', true);
    insert into public.quiz_steps (id, question_id, step_text, correct_order) values
      ('${id(80)}', '${sequenceQuestion}', 'First', 1),
      ('${id(81)}', '${sequenceQuestion}', 'Second', 2);
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
});

beforeEach(async () => db.exec("begin"));
afterEach(async () => db.exec("rollback"));
after(async () => db.close());

test("old submission RLS alone permits students to assign themselves grades", async () => {
  await db.exec("drop trigger submissions_guard_write on public.submissions");
  await asUser(users.student);
  await db.query("update public.submissions set score = 100, status = 'graded' where id = $1", [
    submission,
  ]);
  assert.equal((await row()).score, "100.00");
});

test("student assignment upserts still insert and revise ungraded answers", async () => {
  await asUser(users.student);
  for (const assignmentId of [newTask, task]) {
    for (const content of ["First answer", "Revised answer"]) {
      const { rows } = await db.query(
        `
        insert into public.submissions (assignment_id, student_id, content_url, status, submitted_at)
        values ($1, $2, $3, 'submitted', now())
        on conflict (assignment_id, student_id) do update
          set content_url = excluded.content_url, status = excluded.status, submitted_at = excluded.submitted_at
        returning *`,
        [assignmentId, users.student, content],
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
    await db.query(`update public.assignments set ${change} where id = $1`, [quiz]);
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
