import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

// Historical activation migration regression. The later maintenance workflow
// (which requires closing first) is tested in academic-maintenance.test.mjs.
const db = new PGlite({ extensions: { pgcrypto } });
const id = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migrationName = "20261010000000_atomic_academic_year_activation.sql";
const migrationDir = new URL("../../supabase/migrations/", import.meta.url);
const activationSql = await readFile(new URL(migrationName, migrationDir), "utf8");
const users = { admin: id(1), teacher: id(2), student: id(3), principal: id(4) };
const oldYear = id(30);
const newYear = id(31);
const nextSemester = id(32);
const otherSchoolYear = id(33);
const protectedTables = ["classes", "profiles", "class_teacher_subjects"];
let beforeMigration;
let afterMigration;

async function snapshot(tables = ["academic_years", ...protectedTables]) {
  const result = {};
  for (const table of tables) {
    result[table] = (await db.query(`select * from public.${table} order by id`)).rows;
  }
  return result;
}

async function statuses() {
  return (await db.query("select id, is_active from public.academic_years order by id")).rows;
}

async function asUser(userId) {
  await db.exec("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

async function rejects(sql, params, code) {
  await db.exec("savepoint rejected");
  await assert.rejects(db.query(sql, params), { code });
  await db.exec("rollback to savepoint rejected; release savepoint rejected");
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
  for (const filename of (await readdir(migrationDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    if (filename >= migrationName) continue;
    await db.exec(await readFile(new URL(filename, migrationDir), "utf8"));
  }
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    insert into public.schools (id, name) values
      ('${id(20)}', 'School A'), ('${id(21)}', 'School B');
    insert into public.academic_years (id, school_id, year_label, semester, is_active) values
      ('${oldYear}', '${id(20)}', '2025/2026', 'ganjil', true),
      ('${newYear}', '${id(20)}', '2026/2027', 'ganjil', false),
      ('${nextSemester}', '${id(20)}', '2026/2027', 'genap', false),
      ('${otherSchoolYear}', '${id(21)}', '2025/2026', 'ganjil', true);
    insert into public.classes (id, school_id, academic_year_id, name, grade_level) values
      ('${id(40)}', '${id(20)}', '${oldYear}', '4A', 4),
      ('${id(41)}', '${id(20)}', '${newYear}', '4A', 4);
    insert into public.subjects (id, school_id, code, name)
      values ('${id(50)}', '${id(20)}', 'MTK', 'Matematika');
  `);
  for (const [role, userId] of Object.entries(users)) {
    await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [
      userId,
      `${role}@example.test`,
      JSON.stringify({
        lms_profile: {
          role,
          full_name: role,
          username: role,
          school_id: id(20),
          class_id: role === "student" ? id(40) : null,
        },
      }),
    ]);
  }
  await db.exec(`
    insert into public.class_teacher_subjects (class_id, subject_id, teacher_id)
      values ('${id(40)}', '${id(50)}', '${users.teacher}');
  `);
  beforeMigration = await snapshot();
  await db.exec(activationSql);
  afterMigration = await snapshot();
});

beforeEach(async () => db.exec("begin"));
afterEach(async () => db.exec("rollback"));
after(async () => db.close());

test("migration leaves existing years, classes, student placements and teacher assignments untouched", () => {
  assert.deepEqual(afterMigration, beforeMigration);
});

test("new years default to inactive and can have classes before activation", async () => {
  await asUser(users.admin);
  const { rows } = await db.query(
    "insert into public.academic_years (school_id, year_label, semester) values ($1, '2027/2028', 'ganjil') returning id, is_active",
    [id(20)],
  );
  assert.equal(rows[0].is_active, false);
  await db.query(
    "insert into public.classes (school_id, academic_year_id, name, grade_level) values ($1, $2, '1A', 1)",
    [id(20), rows[0].id],
  );
  assert.equal((await statuses()).find((year) => year.id === oldYear).is_active, true);
});

test("activation changes only flags in the selected school and preserves all placement data", async () => {
  const original = await snapshot(protectedTables);
  await asUser(users.admin);
  await db.query("select public.set_active_academic_year($1)", [newYear]);
  assert.deepEqual(await statuses(), [
    { id: oldYear, is_active: false },
    { id: newYear, is_active: true },
    { id: nextSemester, is_active: false },
    { id: otherSchoolYear, is_active: true },
  ]);
  await db.exec("reset role");
  assert.deepEqual(await snapshot(protectedTables), original);
});

test("repeated activation and semester changes keep exactly one active period per school", async () => {
  await asUser(users.admin);
  for (const year of [newYear, newYear, nextSemester, oldYear]) {
    await db.query("select public.set_active_academic_year($1)", [year]);
    const { rows } = await db.query(
      "select id from public.academic_years where school_id = $1 and is_active",
      [id(20)],
    );
    assert.deepEqual(rows, [{ id: year }]);
  }
});

for (const [stage, target] of [
  ["deactivation", oldYear],
  ["activation", newYear],
]) {
  test(`failure during ${stage} rolls back the entire switch`, async () => {
    await db.exec(`
      create function public.fail_year_switch() returns trigger language plpgsql as $$
      begin
        if new.id = '${target}' then raise exception 'Simulated failure'; end if;
        return new;
      end;
      $$;
      create trigger fail_year_switch before update on public.academic_years
        for each row execute function public.fail_year_switch();
    `);
    const original = await statuses();
    await asUser(users.admin);
    await rejects("select public.set_active_academic_year($1)", [newYear], "P0001");
    assert.deepEqual(await statuses(), original);
  });
}

test("an unknown or missing target leaves the active year unchanged", async () => {
  const original = await statuses();
  await asUser(users.admin);
  await rejects("select public.set_active_academic_year($1)", [id(999)], "P0002");
  await rejects("select public.set_active_academic_year($1)", [null], "P0002");
  assert.deepEqual(await statuses(), original);
});

for (const role of ["teacher", "student", "principal"]) {
  test(`${role} cannot activate a year directly through the RPC`, async () => {
    const original = await statuses();
    await asUser(users[role]);
    await rejects("select public.set_active_academic_year($1)", [newYear], "42501");
    assert.deepEqual(await statuses(), original);
  });
}

test("anonymous users cannot execute the activation RPC", async () => {
  await db.exec("set local role anon");
  await rejects("select public.set_active_academic_year($1)", [newYear], "42501");
});

test("the unique index rejects a second active year even through direct admin writes", async () => {
  const original = await statuses();
  await asUser(users.admin);
  await rejects(
    "update public.academic_years set is_active = true where id = $1",
    [newYear],
    "23505",
  );
  assert.deepEqual(await statuses(), original);
});

test("migration refuses legacy duplicate active years without choosing or rewriting a year", async () => {
  await db.exec("drop index public.academic_years_one_active_per_school_idx");
  await db.query("update public.academic_years set is_active = true where id = $1", [newYear]);
  const original = await statuses();
  await db.exec("savepoint migration_check");
  await assert.rejects(db.exec(activationSql), { message: /lebih dari satu tahun ajaran aktif/ });
  await db.exec("rollback to savepoint migration_check");
  assert.deepEqual(await statuses(), original);
});
