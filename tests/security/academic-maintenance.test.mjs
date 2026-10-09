import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const db = new PGlite({ extensions: { pgcrypto } });
const id = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const users = { admin: id(1), teacher: id(2), student: id(3), principal: id(4), outside: id(5) };
const school = id(20),
  oldYear = id(30),
  newYear = id(31),
  oldClass = id(40),
  newClass = id(41);
const subject = id(50),
  plan = id(60),
  objective = id(61),
  material = id(70),
  quiz = id(80),
  task = id(81),
  question = id(82);
const migrationName = "20261010000001_academic_maintenance.sql";
const dir = new URL("../../supabase/migrations/", import.meta.url);
let originalData, migratedData, originalColumns, migratedColumns;

async function asUser(userId, role = "authenticated") {
  assert.ok(["authenticated", "anon", "service_role"].includes(role));
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role }),
  ]);
}
async function rejects(sql, values, code = "42501") {
  await db.exec("savepoint rejected");
  await assert.rejects(db.query(sql, values), { code });
  await db.exec("rollback to savepoint rejected; release savepoint rejected");
}
async function open() {
  return (await db.query("select public.academic_access_open() as value")).rows[0].value;
}
async function closePeriod() {
  await asUser(users.admin);
  await db.query("select public.deactivate_academic_year($1)", [oldYear]);
}
async function snapshot() {
  const rows = {};
  for (const table of [
    "academic_years",
    "classes",
    "profiles",
    "class_teacher_subjects",
    "materials",
    "assignments",
    "submissions",
    "grades",
    "curriculum_plans",
    "learning_objectives",
    "class_meetings",
    "attendance_records",
    "quiz_questions",
    "quiz_answers",
    "material_views",
  ]) {
    rows[table] = (await db.query(`select * from public.${table} order by id`)).rows;
  }
  return rows;
}
async function columns() {
  return (
    await db.query(
      "select table_name, column_name, data_type, column_default, is_nullable from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position",
    )
  ).rows;
}

before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text,
      raw_user_meta_data jsonb not null default '{}', raw_app_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
  `);
  for (const filename of (await readdir(dir))
    .filter((name) => name.endsWith(".sql") && name < migrationName)
    .sort()) {
    await db.exec(await readFile(new URL(filename, dir), "utf8"));
  }
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    insert into public.schools (id, name) values ('${school}', 'Test school'), ('${id(21)}', 'Other school');
    insert into public.academic_years (id, school_id, year_label, semester, is_active) values
      ('${oldYear}', '${school}', '2025/2026', 'genap', true),
      ('${newYear}', '${school}', '2026/2027', 'ganjil', false),
      ('${id(32)}', '${id(21)}', '2026/2027', 'ganjil', true);
    insert into public.classes (id, school_id, academic_year_id, name, grade_level) values
      ('${oldClass}', '${school}', '${oldYear}', '4A', 4),
      ('${newClass}', '${school}', '${newYear}', '5A', 5);
    insert into public.subjects (id, school_id, code, name) values ('${subject}', '${school}', 'MTK', 'Matematika');
  `);
  for (const [role, userId] of Object.entries(users)) {
    await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [
      userId,
      `${role}@example.test`,
      JSON.stringify({
        lms_profile: {
          role: role === "outside" ? "teacher" : role,
          full_name: role,
          username: role,
          school_id: role === "outside" ? id(21) : school,
          class_id: role === "student" ? oldClass : null,
        },
      }),
    ]);
  }
  await db.exec(`
    insert into public.class_teacher_subjects (class_id, subject_id, teacher_id) values
      ('${oldClass}', '${subject}', '${users.teacher}'), ('${newClass}', '${subject}', '${users.teacher}');
    insert into public.curriculum_plans (id, class_id, subject_id, teacher_id, cp_text)
      values ('${plan}', '${oldClass}', '${subject}', '${users.teacher}', 'CP');
    insert into public.learning_objectives (id, curriculum_plan_id, title) values ('${objective}', '${plan}', 'TP');
    insert into public.materials (id, class_id, subject_id, teacher_id, title, kind, learning_objective_id)
      values ('${material}', '${oldClass}', '${subject}', '${users.teacher}', 'Materi', 'text', '${objective}');
    insert into public.assignments (id, class_id, subject_id, teacher_id, title, kind, is_published) values
      ('${quiz}', '${oldClass}', '${subject}', '${users.teacher}', 'Quiz', 'quiz', true),
      ('${task}', '${oldClass}', '${subject}', '${users.teacher}', 'Task', 'text', true);
    insert into public.quiz_questions (id, assignment_id, question_text, question_type, points) values ('${question}', '${quiz}', 'Question', 'true_false', 100);
    insert into public.submissions (id, assignment_id, student_id, status) values ('${id(90)}', '${task}', '${users.student}', 'submitted');
    insert into public.grades (student_id, subject_id, class_id, academic_year_id, period_month, score)
      values ('${users.student}', '${subject}', '${oldClass}', '${oldYear}', '2026-05-01', 80);
    insert into public.class_meetings (id, class_id, subject_id, teacher_id, meeting_number, meeting_date)
      values ('${id(91)}', '${oldClass}', '${subject}', '${users.teacher}', 1, '2026-05-01');
    insert into public.attendance_records (meeting_id, student_id, status) values ('${id(91)}', '${users.student}', 'hadir');
    insert into public.material_views (material_id, student_id) values ('${material}', '${users.student}');
  `);
  originalData = await snapshot();
  originalColumns = await columns();
  await db.exec(await readFile(new URL(migrationName, dir), "utf8"));
  migratedData = await snapshot();
  migratedColumns = await columns();
});
beforeEach(async () => db.exec("begin"));
afterEach(async () => db.exec("rollback"));
after(async () => db.close());

test("maintenance migration preserves every existing row and table/column definition", () => {
  assert.deepEqual(migratedData, originalData);
  assert.deepEqual(migratedColumns, originalColumns);
});

test("direct period switch is rejected until the current period is closed", async () => {
  await asUser(users.admin);
  await rejects("select public.set_active_academic_year($1)", [newYear], "55000");
  assert.equal(
    (await db.query("select is_active from public.academic_years where id = $1", [oldYear])).rows[0]
      .is_active,
    true,
  );
  await db.query("select public.set_active_academic_year($1)", [oldYear]); // idempotent
});

for (const role of ["teacher", "student", "principal"]) {
  test(`${role}: closing blocks direct reads/writes, but own identity remains available`, async () => {
    await asUser(users[role]);
    assert.equal(await open(), true);
    assert.equal((await db.query("select id from public.materials")).rows.length, 1);
    await closePeriod();
    await asUser(users[role]);
    assert.equal(await open(), false);
    for (const table of [
      "classes",
      "class_teacher_subjects",
      "materials",
      "assignments",
      "submissions",
      "grades",
      "curriculum_plans",
      "learning_objectives",
      "class_meetings",
      "attendance_records",
      "quiz_questions",
      "quiz_answers",
      "material_views",
    ]) {
      assert.deepEqual((await db.query(`select * from public.${table}`)).rows, [], table);
    }
    assert.deepEqual((await db.query("select id from public.profiles")).rows, [
      { id: users[role] },
    ]);
    assert.deepEqual(
      (await db.query("select * from public.learning_objective_usage($1)", [[objective]])).rows,
      [],
    );
    await rejects("select public.deactivate_academic_year($1)", [oldYear]);
    await rejects("select public.set_active_academic_year($1)", [newYear]);
    await rejects(
      "insert into public.materials(class_id, subject_id, teacher_id, title, kind) values ($1, $2, $3, 'Blocked', 'text')",
      [oldClass, subject, users[role]],
    );
    if (role === "student")
      await rejects(
        "insert into public.submissions(assignment_id,student_id,status) values ($1,$2,'submitted')",
        [quiz, users.student],
      );
  });
}

test("closing is school-specific and admins retain all administrative access", async () => {
  await closePeriod();
  assert.equal(await open(), true);
  assert.equal((await db.query("select id from public.classes")).rows.length, 2);
  await db.query(
    "insert into public.classes(school_id, academic_year_id, name, grade_level) values ($1,$2,'1A',1)",
    [school, newYear],
  );
  await asUser(users.outside);
  assert.equal(await open(), true);
  assert.deepEqual((await db.query("select id from public.classes")).rows, []);
});

test("admin can prepare placements while closed; opening reveals only the new operational classes", async () => {
  await closePeriod();
  await db.query("update public.profiles set class_id = $1 where id = $2", [
    newClass,
    users.student,
  ]);
  await db.query("select public.set_active_academic_year($1)", [newYear]);
  for (const role of ["student", "teacher"]) {
    await asUser(users[role]);
    assert.equal(await open(), true);
    assert.deepEqual((await db.query("select id from public.classes")).rows, [{ id: newClass }]);
    assert.deepEqual((await db.query("select class_id from public.class_teacher_subjects")).rows, [
      { class_id: newClass },
    ]);
    assert.deepEqual((await db.query("select id from public.materials")).rows, []);
  }
  await asUser(users.principal);
  assert.equal((await db.query("select id from public.classes")).rows.length, 2);
  assert.equal((await db.query("select id from public.materials")).rows.length, 1); // reports can read the old period
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int as n from public.submissions")).rows[0].n, 1);
  assert.equal(
    (await db.query("select count(*)::int as n from public.class_teacher_subjects")).rows[0].n,
    2,
  );
});

test("reopening the old period restores access without changing data", async () => {
  await closePeriod();
  await db.query("select public.set_active_academic_year($1)", [oldYear]);
  await db.exec("reset role");
  assert.deepEqual(await snapshot(), originalData);
});

test("stale deactivation cannot close a different newly opened period", async () => {
  await closePeriod();
  await db.query("select public.set_active_academic_year($1)", [newYear]);
  await rejects("select public.deactivate_academic_year($1)", [oldYear], "55000");
  assert.equal(
    (await db.query("select is_active from public.academic_years where id = $1", [newYear])).rows[0]
      .is_active,
    true,
  );
});

for (const action of ["deactivate_academic_year", "set_active_academic_year"]) {
  test(`${action}: failed update rolls back without changing data`, async () => {
    if (action === "set_active_academic_year") await closePeriod();
    await db.exec("reset role");
    const original = await snapshot();
    await db.exec(`create function public.fail_period_update() returns trigger language plpgsql as $$ begin raise exception 'Forced failure'; end; $$;
      create trigger fail_period_update before update on public.academic_years for each row execute function public.fail_period_update();`);
    await asUser(users.admin);
    await rejects(`select public.${action}($1)`, [oldYear], "P0001");
    await db.exec("reset role");
    assert.deepEqual(await snapshot(), original);
  });
}

test("a delayed service-role quiz save is rejected during administration", async () => {
  await closePeriod();
  await asUser(users.student, "service_role");
  await rejects("select public.save_scored_quiz($1,$2,100,$3)", [
    quiz,
    users.student,
    JSON.stringify([{ question_id: question, points_earned: 100 }]),
  ]);
  assert.deepEqual(
    (await db.query("select id from public.submissions where assignment_id = $1", [quiz])).rows,
    [],
  );
});

test("service-role quiz save still succeeds during an active period", async () => {
  await asUser(users.student, "service_role");
  await db.query("select public.save_scored_quiz($1,$2,100,$3)", [
    quiz,
    users.student,
    JSON.stringify([{ question_id: question, points_earned: 100 }]),
  ]);
  assert.equal(
    (await db.query("select score from public.submissions where assignment_id = $1", [quiz]))
      .rows[0].score,
    "100.00",
  );
});

test("anonymous users cannot open access or invoke activation/deactivation", async () => {
  await asUser(null, "anon");
  assert.equal(await open(), false);
  await rejects("select public.deactivate_academic_year($1)", [oldYear]);
  await rejects("select public.set_active_academic_year($1)", [newYear]);
});
