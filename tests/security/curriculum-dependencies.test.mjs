import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

// Exercise the real migrations with RLS enabled, without hosted credentials.
const db = new PGlite({ extensions: { pgcrypto } });
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const teacher = id(1);
const student = id(2);
const outsider = id(3);
const admin = id(4);
const plan = id(50);
const unusedPlan = id(51);
const objectives = [60, 61, 62, 63, 64].map(id);
const tables = [
  "curriculum_plans",
  "learning_objectives",
  "materials",
  "assignments",
  "class_meetings",
  "attendance_records",
  "submissions",
  "grades",
  "profiles",
];
let beforeMigration;
let afterMigration;

async function snapshot(names = tables) {
  const result = {};
  for (const table of names) {
    result[table] = (await db.query(`select * from public.${table} order by id`)).rows;
  }
  return result;
}

async function asUser(userId) {
  await db.exec("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

async function rejects(sql, params, code, message) {
  await db.exec("savepoint rejected");
  await assert.rejects(db.query(sql, params), { code, ...(message ? { message } : {}) });
  await db.exec("rollback to savepoint rejected; release savepoint rejected");
}

async function order() {
  return (
    await db.query(
      "select id, sort_order from public.learning_objectives where curriculum_plan_id = $1 order by sort_order, id",
      [plan],
    )
  ).rows;
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
  const newMigration = "20260930000000_curriculum_dependencies.sql";
  for (const filename of (await readdir(migrationDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    if (filename >= newMigration) continue;
    await db.exec(await readFile(new URL(filename, migrationDir), "utf8"));
  }
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    insert into public.schools (id, name) values ('${id(20)}', 'Test school');
    insert into public.academic_years (id, school_id, year_label, semester, is_active)
      values ('${id(30)}', '${id(20)}', '2026/2027', 'ganjil', true);
    insert into public.classes (id, school_id, academic_year_id, name, grade_level) values
      ('${id(10)}', '${id(20)}', '${id(30)}', '4A', 4),
      ('${id(11)}', '${id(20)}', '${id(30)}', '5A', 5);
    insert into public.subjects (id, school_id, code, name) values
      ('${id(40)}', '${id(20)}', 'MTK', 'Matematika'),
      ('${id(41)}', '${id(20)}', 'IPA', 'IPA'),
      ('${id(42)}', '${id(20)}', 'IPS', 'IPS');
  `);
  for (const [userId, role] of [
    [teacher, "teacher"],
    [student, "student"],
    [outsider, "teacher"],
    [admin, "admin"],
  ]) {
    await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [
      userId,
      `${userId}@example.test`,
      JSON.stringify({
        lms_profile: {
          role,
          full_name: role,
          username: userId,
          school_id: id(20),
          class_id: id(10),
        },
      }),
    ]);
  }
  await db.exec(`
    insert into public.class_teacher_subjects (class_id, subject_id, teacher_id) values
      ('${id(10)}', '${id(40)}', '${teacher}'),
      ('${id(10)}', '${id(41)}', '${teacher}'),
      ('${id(10)}', '${id(42)}', '${outsider}');
    insert into public.curriculum_plans (id, class_id, subject_id, teacher_id, cp_text) values
      ('${plan}', '${id(10)}', '${id(40)}', '${teacher}', 'CP original'),
      ('${unusedPlan}', '${id(10)}', '${id(41)}', '${teacher}', 'Unused CP');
  `);
  for (const [index, objective] of objectives.entries()) {
    await db.query(
      "insert into public.learning_objectives (id, curriculum_plan_id, title, sort_order) values ($1, $2, $3, $4)",
      [objective, plan, `TP ${index + 1}`, index],
    );
  }
  await db.exec(`
    insert into public.learning_objectives (id, curriculum_plan_id, title)
      values ('${id(65)}', '${unusedPlan}', 'Unused child');
    insert into public.materials (id, class_id, subject_id, teacher_id, title, kind, learning_objective_id, is_active) values
      ('${id(70)}', '${id(10)}', '${id(40)}', '${teacher}', 'Material', 'text', '${objectives[0]}', true),
      ('${id(71)}', '${id(10)}', '${id(40)}', '${teacher}', 'Inactive material', 'text', '${objectives[0]}', false);
    insert into public.assignments (id, class_id, subject_id, teacher_id, title, kind, learning_objective_id, is_published) values
      ('${id(80)}', '${id(10)}', '${id(40)}', '${teacher}', 'Task', 'essay', '${objectives[0]}', true),
      ('${id(81)}', '${id(10)}', '${id(40)}', '${teacher}', 'Draft quiz', 'quiz', '${objectives[0]}', false);
    insert into public.class_meetings (id, class_id, subject_id, teacher_id, meeting_number, learning_objective_id)
      values ('${id(90)}', '${id(10)}', '${id(40)}', '${teacher}', 1, '${objectives[1]}');
    insert into public.attendance_records (id, meeting_id, student_id)
      values ('${id(91)}', '${id(90)}', '${student}');
    insert into public.submissions (id, assignment_id, student_id, score, status)
      values ('${id(100)}', '${id(80)}', '${student}', 85, 'graded');
    insert into public.grades (id, student_id, subject_id, class_id, academic_year_id, period_month, score)
      values ('${id(101)}', '${student}', '${id(40)}', '${id(10)}', '${id(30)}', '2026-09-01', 85);
  `);
  beforeMigration = await snapshot();
  await db.exec(await readFile(new URL(newMigration, migrationDir), "utf8"));
  afterMigration = await snapshot();
  for (const filename of (await readdir(migrationDir))
    .filter((name) => name.endsWith(".sql") && name > newMigration)
    .sort()) {
    await db.exec(await readFile(new URL(filename, migrationDir), "utf8"));
  }
});

beforeEach(async () => db.exec("begin"));
afterEach(async () => db.exec("rollback"));
after(async () => db.close());

test("migration preserves all existing CP/TP, activities, links, submissions, grades and students", () => {
  assert.deepEqual(afterMigration, beforeMigration);
});

test("usage separates tasks from quizzes and counts inactive/draft activities and meeting-only dependencies", async () => {
  await asUser(teacher);
  const { rows } = await db.query("select * from public.learning_objective_usage($1) order by id", [
    objectives,
  ]);
  assert.deepEqual(rows, [
    { id: objectives[0], materials: 2, assignments: 1, quizzes: 1, meetings: 0 },
    { id: objectives[1], materials: 0, assignments: 0, quizzes: 0, meetings: 1 },
    ...objectives.slice(2).map((objective) => ({
      id: objective,
      materials: 0,
      assignments: 0,
      quizzes: 0,
      meetings: 0,
    })),
  ]);
});

for (const [name, user] of [
  ["student", student],
  ["teacher of a different subject", outsider],
]) {
  test(`${name} cannot access usage or the reorder RPC`, async () => {
    await asUser(user);
    assert.deepEqual(
      (await db.query("select * from public.learning_objective_usage($1)", [objectives])).rows,
      [],
    );
    await rejects("select public.move_learning_objective($1, 'down')", [objectives[2]], "42501");
    await rejects("select public.learning_objective_is_used($1)", [objectives[0]], "42501");
  });
}

test("anonymous cannot call usage or reorder RPCs", async () => {
  await db.exec("set local role anon");
  await rejects("select * from public.learning_objective_usage($1)", [objectives], "42501");
  await rejects("select public.move_learning_objective($1, 'down')", [objectives[2]], "42501");
});

for (const user of [teacher, admin]) {
  test(`used TP and its CP reject direct deletes for ${user === teacher ? "teacher" : "admin"}`, async () => {
    const original = await snapshot();
    await asUser(user);
    for (const objective of objectives.slice(0, 2)) {
      await rejects(
        "delete from public.learning_objectives where id = $1",
        [objective],
        "23503",
        "Tujuan Pembelajaran tidak dapat dihapus karena sudah digunakan dalam aktivitas pembelajaran.",
      );
    }
    await rejects(
      "delete from public.curriculum_plans where id = $1",
      [plan],
      "23503",
      "CP tidak dapat dihapus karena masih memiliki Tujuan Pembelajaran yang digunakan dalam aktivitas pembelajaran.",
    );
    await db.exec("reset role");
    assert.deepEqual(await snapshot(), original);
  });
}

test("RESTRICT foreign keys still block deletion if the friendly TP trigger is disabled", async () => {
  await db.exec("alter table public.learning_objectives disable trigger learning_objectives_guard");
  await asUser(teacher);
  for (const objective of objectives.slice(0, 2)) {
    await rejects("delete from public.learning_objectives where id = $1", [objective], "23001");
  }
  const { rows } = await db.query(`
    select confdeltype from pg_constraint
    where conname in ('materials_learning_objective_id_fkey', 'assignments_learning_objective_id_fkey', 'class_meetings_learning_objective_id_fkey')
  `);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.confdeltype === "r"));
});

test("unused TP and an unused CP with children can be deleted, then recreated", async () => {
  await asUser(teacher);
  await db.query("delete from public.learning_objectives where id = $1", [objectives[2]]);
  await db.query("delete from public.curriculum_plans where id = $1", [unusedPlan]);
  assert.equal(
    (await db.query("select id from public.learning_objectives where id = $1", [id(65)])).rows
      .length,
    0,
  );
  await db.query(
    "insert into public.curriculum_plans (id, class_id, subject_id, teacher_id, cp_text) values ($1, $2, $3, $4, 'New CP')",
    [unusedPlan, id(10), id(41), teacher],
  );
  const { rows } = await db.query(
    "insert into public.learning_objectives (curriculum_plan_id, title) values ($1, 'New TP') returning sort_order",
    [unusedPlan],
  );
  assert.equal(rows[0].sort_order, 0);
});

test("typo corrections preserve objective IDs/order and every activity link and student record", async () => {
  const protectedTables = tables.filter(
    (table) => !["curriculum_plans", "learning_objectives"].includes(table),
  );
  const original = await snapshot(protectedTables);
  await asUser(teacher);
  const originalOrder = await order();
  await db.query("update public.learning_objectives set title = 'Corrected TP' where id = $1", [
    objectives[0],
  ]);
  await db.query("update public.curriculum_plans set cp_text = 'Corrected CP' where id = $1", [
    plan,
  ]);
  assert.deepEqual(await order(), originalOrder);
  await db.exec("reset role");
  assert.deepEqual(await snapshot(protectedTables), original);
});

test("unused neighbors swap atomically without changing the positions of used TPs", async () => {
  await asUser(teacher);
  await db.query("select public.move_learning_objective($1, 'up')", [objectives[3]]);
  assert.deepEqual(
    await order(),
    [0, 1, 3, 2, 4].map((index, sort_order) => ({ id: objectives[index], sort_order })),
  );
  await db.query("select public.move_learning_objective($1, 'down')", [objectives[3]]);
  assert.deepEqual(
    await order(),
    objectives.map((objective, sort_order) => ({ id: objective, sort_order })),
  );
});

test("used TPs cannot move, and unused TPs cannot cross a locked neighbor through RPC or raw updates", async () => {
  await asUser(teacher);
  const originalOrder = await order();
  for (const [objective, direction] of [
    [objectives[1], "down"],
    [objectives[2], "up"],
  ]) {
    await rejects("select public.move_learning_objective($1, $2)", [objective, direction], "23514");
  }
  for (const objective of [objectives[0], objectives[1]]) {
    await rejects(
      "update public.learning_objectives set sort_order = 99 where id = $1",
      [objective],
      "23514",
    );
  }
  await rejects(
    "update public.learning_objectives set sort_order = 0 where id = $1",
    [objectives[4]],
    "23514",
  );
  await rejects("select public.move_learning_objective($1, 'sideways')", [objectives[2]], "22023");
  assert.deepEqual(await order(), originalOrder);
});

test("a failed second row in the swap rolls the whole reorder back", async () => {
  await db.exec(`
    create function public.fail_second_tp() returns trigger language plpgsql as $$
    declare updated_count integer;
    begin
      updated_count := coalesce(nullif(current_setting('test.reordered_count', true), '')::integer, 0) + 1;
      perform set_config('test.reordered_count', updated_count::text, true);
      if updated_count = 2 then
        raise exception 'Simulated second-row failure';
      end if;
      return new;
    end;
    $$;
    create trigger z_fail_second_tp before update of sort_order on public.learning_objectives
      for each row execute function public.fail_second_tp();
  `);
  await asUser(teacher);
  const originalOrder = await order();
  await rejects("select public.move_learning_objective($1, 'down')", [objectives[2]], "P0001");
  assert.deepEqual(await order(), originalOrder);
});

test("new TPs append after max order even after a deletion or an explicitly supplied earlier order", async () => {
  await asUser(teacher);
  await db.query("delete from public.learning_objectives where id = $1", [objectives[2]]);
  const { rows } = await db.query(
    "insert into public.learning_objectives (curriculum_plan_id, title, sort_order) values ($1, 'New TP', 0) returning sort_order",
    [plan],
  );
  assert.equal(rows[0].sort_order, 5);
  assert.deepEqual(
    (await order()).slice(0, 2),
    objectives.slice(0, 2).map((objective, sort_order) => ({ id: objective, sort_order })),
  );
});

test("existing TP IDs/parents and CP class/subject cannot be reassigned", async () => {
  await asUser(teacher);
  await rejects(
    "update public.learning_objectives set id = $1 where id = $2",
    [id(999), objectives[2]],
    "23514",
  );
  await rejects(
    "update public.learning_objectives set curriculum_plan_id = $1 where id = $2",
    [unusedPlan, objectives[2]],
    "23514",
  );
  await rejects(
    "update public.curriculum_plans set subject_id = $1 where id = $2",
    [id(42), plan],
    "23514",
  );
});

for (const table of ["materials", "assignments", "class_meetings"]) {
  const activity = table === "materials" ? id(70) : table === "assignments" ? id(80) : id(90);
  test(`${table} accepts a relevant TP but rejects a TP from a different subject or class`, async () => {
    await asUser(teacher);
    await rejects(
      `update public.${table} set learning_objective_id = $1 where id = $2`,
      [id(65), activity],
      "23514",
    );
    await rejects(
      `update public.${table} set class_id = $1 where id = $2`,
      [id(11), activity],
      "23514",
    );
    await db.query(`update public.${table} set learning_objective_id = $1 where id = $2`, [
      objectives[2],
      activity,
    ]);
    await rejects("delete from public.learning_objectives where id = $1", [objectives[2]], "23503");
  });
}
