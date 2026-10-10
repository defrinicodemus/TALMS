import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const db = new PGlite({ extensions: { pgcrypto } });
const id = (n) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dir = new URL("../../supabase/migrations/", import.meta.url);
const migrationName = "20261010000002_student_transfers.sql";
const rpc = "select public.transfer_academic_students($1, $2, $3, $4::jsonb) as moved";
const mapping = (source = 40, target = 50, students = [3]) => ({
  sourceClassId: id(source),
  targetClassId: id(target),
  studentIds: students.map(id),
});
const request = (mappings = [mapping()], kind = "promotion", source = 31, target = 32) => [
  kind,
  id(source),
  id(target),
  JSON.stringify(mappings),
];
const preservedTables = [
  "academic_years",
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
];
let originalData, migratedData, originalColumns, migratedColumns;

async function asUser(n = 1, role = "authenticated") {
  assert.ok(["authenticated", "anon"].includes(role));
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: id(n), role }),
  ]);
}
async function snapshot(tables = [...preservedTables, "profiles"]) {
  const result = {};
  for (const table of tables)
    result[table] = (await db.query(`select * from public.${table} order by id`)).rows;
  return result;
}
async function columns() {
  return (
    await db.query(
      "select table_name, column_name, data_type, column_default, is_nullable from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position",
    )
  ).rows;
}
async function rejected(params, code = "22023") {
  const initial = await snapshot();
  await db.exec("savepoint rejected");
  await assert.rejects(db.query(rpc, params), { code });
  await db.exec("rollback to savepoint rejected; release savepoint rejected");
  assert.deepEqual(await snapshot(), initial);
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
    insert into public.schools (id, name) values ('${id(20)}', 'School A'), ('${id(21)}', 'School B');
    insert into public.academic_years (id, school_id, year_label, semester, is_active) values
      ('${id(30)}', '${id(20)}', '2025/2026', 'ganjil', false),
      ('${id(31)}', '${id(20)}', '2025/2026', 'genap', false),
      ('${id(32)}', '${id(20)}', '2026/2027', 'ganjil', false),
      ('${id(33)}', '${id(20)}', '2026/2027', 'genap', false),
      ('${id(34)}', '${id(20)}', '2027/2028', 'ganjil', false),
      ('${id(35)}', '${id(21)}', '2026/2027', 'ganjil', true);
    insert into public.classes (id, school_id, academic_year_id, name, grade_level) values
      ('${id(40)}', '${id(20)}', '${id(31)}', '4A', 4),
      ('${id(41)}', '${id(20)}', '${id(31)}', '5A', 5),
      ('${id(42)}', '${id(20)}', '${id(31)}', '6A', 6),
      ('${id(50)}', '${id(20)}', '${id(32)}', '5A', 5),
      ('${id(51)}', '${id(20)}', '${id(32)}', '6A', 6),
      ('${id(52)}', '${id(20)}', '${id(32)}', '4A', 4),
      ('${id(60)}', '${id(20)}', '${id(30)}', '6A', 6),
      ('${id(70)}', '${id(21)}', '${id(35)}', '5A', 5);
    insert into public.subjects (id, school_id, code, name) values ('${id(80)}', '${id(20)}', 'MTK', 'Matematika');
  `);
  for (const [n, role, school, cls] of [
    [1, "admin", 20, null],
    [2, "teacher", 20, null],
    [3, "student", 20, 40],
    [4, "principal", 20, null],
    [5, "admin", 21, null],
    [6, "teacher", 20, null],
    [100, "student", 20, 40],
    [101, "student", 20, 41],
    [102, "student", 20, 42],
    [103, "student", 20, 60],
    [104, "student", 21, 70],
  ]) {
    await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [
      id(n),
      `user${n}@example.test`,
      JSON.stringify({
        lms_profile: {
          role,
          full_name: `User ${n}`,
          username: `user${n}`,
          school_id: id(school),
          class_id: cls ? id(cls) : null,
        },
      }),
    ]);
  }
  await db.exec(`
    update public.classes set homeroom_teacher_id = '${id(2)}' where id = '${id(40)}';
    update public.classes set homeroom_teacher_id = '${id(6)}' where id = '${id(50)}';
    insert into public.class_teacher_subjects (class_id, subject_id, teacher_id) values
      ('${id(40)}', '${id(80)}', '${id(2)}'), ('${id(50)}', '${id(80)}', '${id(6)}');
    insert into public.curriculum_plans (id, class_id, subject_id, teacher_id, cp_text)
      values ('${id(200)}', '${id(40)}', '${id(80)}', '${id(2)}', 'CP');
    insert into public.learning_objectives (id, curriculum_plan_id, title) values ('${id(201)}', '${id(200)}', 'TP');
    insert into public.materials (id, class_id, subject_id, teacher_id, title, kind, learning_objective_id)
      values ('${id(202)}', '${id(40)}', '${id(80)}', '${id(2)}', 'Material', 'text', '${id(201)}');
    insert into public.assignments (id, class_id, subject_id, teacher_id, title, kind, is_published) values
      ('${id(203)}', '${id(40)}', '${id(80)}', '${id(2)}', 'Task', 'text', true);
    insert into public.submissions (assignment_id, student_id, status) values ('${id(203)}', '${id(3)}', 'submitted');
    insert into public.grades (student_id, subject_id, class_id, academic_year_id, period_month, score)
      values ('${id(3)}', '${id(80)}', '${id(40)}', '${id(31)}', '2026-05-01', 80);
    insert into public.class_meetings (id, class_id, subject_id, teacher_id, meeting_number, meeting_date)
      values ('${id(204)}', '${id(40)}', '${id(80)}', '${id(2)}', 1, '2026-05-01');
    insert into public.attendance_records (meeting_id, student_id, status) values ('${id(204)}', '${id(3)}', 'hadir');
    insert into public.material_views (material_id, student_id) values ('${id(202)}', '${id(3)}');
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

test("migration preserves all data and table/column definitions", () => {
  assert.deepEqual(migratedData, originalData);
  assert.deepEqual(migratedColumns, originalColumns);
});

test("promotion moves only selected students; teacher assignments, homerooms, periods and learning data stay unchanged", async () => {
  const before = await snapshot();
  await asUser();
  assert.equal(
    (await db.query(rpc, request([mapping(), mapping(41, 51, [101])]))).rows[0].moved,
    2,
  );
  await db.exec("reset role");
  const after = await snapshot();
  for (const table of preservedTables) assert.deepEqual(after[table], before[table]);
  for (const profile of before.profiles) {
    const current = after.profiles.find((p) => p.id === profile.id);
    const target = profile.id === id(3) ? id(50) : profile.id === id(101) ? id(51) : null;
    if (target)
      assert.deepEqual(
        { ...current, updated_at: profile.updated_at },
        { ...profile, class_id: target },
      );
    else assert.deepEqual(current, profile);
  }
});

test("semester transfer includes grade 6 without increasing its grade", async () => {
  await asUser();
  assert.equal(
    (await db.query(rpc, request([mapping(60, 42, [103])], "semester", 30, 31))).rows[0].moved,
    1,
  );
  assert.equal(
    (await db.query("select class_id from public.profiles where id = $1", [id(103)])).rows[0]
      .class_id,
    id(42),
  );
});

test("an active period blocks transfers including a stale request after activation", async () => {
  await asUser();
  await db.query("select public.set_active_academic_year($1)", [id(31)]);
  await rejected(request(), "55000");
  await db.query("select public.deactivate_academic_year($1)", [id(31)]);
  await db.query("select public.set_active_academic_year($1)", [id(32)]);
  await rejected(request(), "55000");
});

for (const [label, user] of [
  ["teacher", 2],
  ["student", 3],
  ["principal", 4],
]) {
  test(`${label} cannot invoke the transfer RPC directly`, async () => {
    await asUser(user);
    await rejected(request(), "42501");
  });
}
test("anonymous calls are denied", async () => {
  await asUser(999, "anon");
  await rejected(request(), "42501");
});

for (const [label, params] of [
  ["same period", request([mapping()], "promotion", 31, 31)],
  ["backward period", request([mapping()], "promotion", 32, 31)],
  ["skipped year", request([mapping()], "promotion", 31, 34)],
  ["wrong semester", request([mapping()], "promotion", 30, 32)],
  ["invalid process", request([mapping()], "other")],
  ["unknown period", request([mapping()], "promotion", 999, 32)],
  ["other school's period", request([mapping()], "promotion", 31, 35)],
  ["wrong target grade", request([mapping(40, 52)])],
  ["grade 6 promotion", request([mapping(42, 51, [102])])],
  ["semester grade change", request([mapping(60, 41, [103])], "semester", 30, 31)],
  ["wrong source period", request([mapping(60, 51, [103])])],
  ["wrong target period", request([mapping(40, 41)])],
  ["foreign class", request([mapping(40, 70)])],
  ["student from another class", request([mapping(40, 50, [101])])],
  ["student from another school", request([mapping(40, 50, [104])])],
  ["teacher in student payload", request([mapping(40, 50, [2])])],
  ["nonexistent student", request([mapping(40, 50, [999])])],
  ["duplicate student", request([mapping(40, 50, [3, 3])])],
  ["duplicate source", request([mapping(), mapping(40, 51, [100])])],
  ["duplicate target", request([mapping(), mapping(41, 50, [101])])],
  ["empty selection", request([mapping(40, 50, [])])],
  ["empty mappings", request([])],
  ["malformed mappings", ["promotion", id(31), id(32), "{}"]],
  ["null mappings", ["promotion", id(31), id(32), null]],
  ["invalid second pair after valid pair", request([mapping(), mapping(41, 51, [999])])],
]) {
  test(`rejects ${label} without any partial changes`, async () => {
    await asUser();
    await rejected(params);
  });
}

test("foreign admin cannot move the school's students", async () => {
  await db.query("update public.academic_years set is_active = false where id = $1", [id(35)]);
  await asUser(5);
  await rejected(request());
});

test("malformed year labels fail closed without changing data", async () => {
  await db.query("update public.academic_years set year_label = '2026/2029' where id = $1", [
    id(32),
  ]);
  await asUser();
  await rejected(request());
});

test("a repeated request cannot move the same students again", async () => {
  await asUser();
  await db.query(rpc, request());
  await rejected(request());
});

test("failure during the second write rolls back the first write too", async () => {
  await db.exec(`
    create function public.fail_test_transfer() returns trigger language plpgsql as $$
    begin
      if new.id = '${id(101)}' then raise exception 'Simulated write failure'; end if;
      return new;
    end;
    $$;
    create trigger fail_test_transfer before update on public.profiles for each row execute function public.fail_test_transfer();
  `);
  await asUser();
  await rejected(request([mapping(), mapping(41, 51, [101])]), "P0001");
});

test("activation after a transfer opens the prepared period without further placement or teacher changes", async () => {
  await asUser();
  await db.query(rpc, request());
  const placement = await snapshot(["profiles", "classes", "class_teacher_subjects"]);
  await db.query("select public.set_active_academic_year($1)", [id(32)]);
  assert.deepEqual(await snapshot(["profiles", "classes", "class_teacher_subjects"]), placement);
  assert.deepEqual(
    (
      await db.query("select id from public.academic_years where school_id = $1 and is_active", [
        id(20),
      ])
    ).rows,
    [{ id: id(32) }],
  );
});
